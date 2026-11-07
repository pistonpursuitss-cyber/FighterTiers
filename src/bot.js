import 'dotenv/config';
import './server.js';
import {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ChannelType, Client, EmbedBuilder,
  Events, GatewayIntentBits, ModalBuilder, PermissionFlagsBits, TextInputBuilder, TextInputStyle
} from 'discord.js';
import {
  GAME_MODES, REGIONS, TIERS, getPlayerPoints, getPlayerTitle, getRankings,
  isGuildOwner, isTester, modeKey, normalize, queueKey, saveRankings
} from './data.js';

const token = process.env.BOT_TOKEN;
if (!token) throw new Error('Set BOT_TOKEN in your environment before starting the bot.');
const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages] });
const siteUrl = (process.env.SITE_URL || (process.env.RENDER_EXTERNAL_HOSTNAME
  ? `https://${process.env.RENDER_EXTERNAL_HOSTNAME}`
  : 'http://localhost:3000')).replace(/\/$/, '');

function button(id, label, style = ButtonStyle.Secondary, emoji) {
  const item = new ButtonBuilder().setCustomId(id).setLabel(label).setStyle(style);
  if (emoji) item.setEmoji(emoji);
  return item;
}

function rows(buttons, width = 5) {
  const result = [];
  for (let i = 0; i < buttons.length; i += width) result.push(new ActionRowBuilder().addComponents(buttons.slice(i, i + width)));
  return result;
}

function modeButtons(prefix, backId) {
  return [
    ...rows(GAME_MODES.map(mode => button(`${prefix}:${modeKey(mode)}`, mode, ButtonStyle.Secondary, '⚔️'))),
    new ActionRowBuilder().addComponents(button(backId, 'Back', ButtonStyle.Secondary, '↩️'))
  ];
}

function regionButtons(prefix, backId) {
  return [
    ...rows(REGIONS.map(region => button(`${prefix}:${region.toLowerCase()}`, region, ButtonStyle.Secondary, '🌐'))),
    new ActionRowBuilder().addComponents(button(backId, 'Back', ButtonStyle.Secondary, '↩️'))
  ];
}

function panelPayload() {
  const embed = new EmbedBuilder().setColor(0xd6a84f)
    .setTitle('⚔ Fighter Tiers · Minecraft PvP')
    .setDescription('Link your Minecraft account, join a regional tier-test queue, browse the rankings, or open your player profile.\n\n**Gamemodes:** Vanilla · UHC · Pot · NethOP · SMP · Sword · Axe · Mace\n**Tier scale:** HT1 → LT5')
    .addFields({ name: 'START HERE', value: 'Use **Link Minecraft** once, then choose **Join a tier test**.' })
    .setURL(siteUrl).setFooter({ text: 'Fighter Tiers · Button controls' });
  return {
    embeds: [embed],
    components: [
      new ActionRowBuilder().addComponents(
        button('panel:link', 'Link Minecraft', ButtonStyle.Primary, '🔗'),
        button('panel:queue', 'Join a tier test', ButtonStyle.Success, '⚔️'),
        button('panel:tiers', 'Browse tiers', ButtonStyle.Secondary, '🏆'),
        button('panel:profile', 'My profile', ButtonStyle.Secondary, '👤'),
        button('panel:tester', 'Tester tools', ButtonStyle.Secondary, '🛠️')
      ),
      new ActionRowBuilder().addComponents(button('panel:manage-testers', 'Manage testers', ButtonStyle.Secondary, '🛡️'))
    ]
  };
}

function queueFor(data, mode, region) {
  data.queues ??= {};
  const key = queueKey(mode, region);
  data.queues[key] ??= { open: false, users: [] };
  data.queues[key].users ??= [];
  return data.queues[key];
}

function resultTierButtons() {
  return rows(TIERS.map(tier => button(`testresult:${tier}`, tier, ButtonStyle.Secondary, '🏅')));
}

function findActiveTest(data, channelId) {
  for (const mode of GAME_MODES) for (const region of REGIONS) {
    const queue = data.queues[queueKey(mode, region)];
    if (queue?.activeTest?.channelId === channelId) return { mode, region, queue, test: queue.activeTest };
  }
  return null;
}

async function ensureResultsChannels(guild) {
  const data = await getRankings();
  data.resultChannels ??= {};
  for (const mode of GAME_MODES) {
    const name = `results-${modeKey(mode)}`;
    let channel;
    const savedId = data.resultChannels[mode];
    if (savedId) channel = await guild.channels.fetch(savedId).catch(() => null);
    if (!channel) channel = guild.channels.cache.find(item => item.type === ChannelType.GuildText && item.name === name);
    if (!channel) {
      channel = await guild.channels.create({
        name,
        type: ChannelType.GuildText,
        topic: `Fighter Tiers ${mode} test results`,
        parent: process.env.RESULTS_CATEGORY_ID?.trim() || undefined,
        reason: 'Fighter Tiers per-gamemode test results'
      });
    }
    data.resultChannels[mode] = channel.id;
  }
  await saveRankings(data);
}

async function createTestRoom(guild, mode, region, playerId, testerId, username) {
  const safeName = `test-${modeKey(mode)}-${region.toLowerCase()}-${modeKey(username).slice(0, 16)}`.slice(0, 90);
  const access = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory];
  const room = await guild.channels.create({
    name: safeName,
    type: ChannelType.GuildText,
    topic: `${mode} ${region} tier test for Minecraft player ${username}`,
    parent: process.env.TEST_CHANNEL_CATEGORY_ID?.trim() || undefined,
    permissionOverwrites: [
      { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
      { id: testerId, allow: access },
      { id: playerId, allow: access },
      { id: client.user.id, allow: access }
    ],
    reason: `Private ${mode} tier test for ${username}`
  });
  const intro = new EmbedBuilder().setColor(0xd6a84f)
    .setTitle(`⚔ ${mode} · ${region} tier test`)
    .setDescription(`Tester <@${testerId}> and player <@${playerId}> can use this private room for the test.\n\nWhen the test is finished, the assigned tester chooses the result using the tier buttons below.`)
    .addFields({ name: 'MINECRAFT PLAYER', value: username, inline: true }, { name: 'REGION', value: region, inline: true });
  const message = await room.send({ content: `<@${testerId}> <@${playerId}>`, embeds: [intro], components: resultTierButtons(), allowedMentions: { users: [testerId, playerId] } });
  return { room, message };
}

async function recordTestResult(data, active, tier, guild) {
  if (!active || !TIERS.includes(tier)) throw new Error('No active tier test was found for this result.');
  const { mode, region, queue, test } = active;
  const player = data.players.find(entry => entry.discordId === test.playerId);
  if (!player) throw new Error('The queued player no longer has a linked Minecraft profile.');
  player.tiers ??= {};
  player.peakTiers ??= {};
  player.tiers[mode] = tier;
  const previousPeak = player.peakTiers[mode];
  if (!previousPeak || TIERS.indexOf(tier) < TIERS.indexOf(previousPeak)) player.peakTiers[mode] = tier;
  queue.currentPlayer = null;
  delete queue.activeTest;
  data.updatedAt = new Date().toISOString();
  await saveRankings(data);

  const points = getPlayerPoints(player);
  const resultEmbed = new EmbedBuilder().setColor(0xd6a84f)
    .setTitle(`${player.minecraftUsername} · ${mode} · ${tier}`)
    .setDescription(`**Region:** ${region}\n**Overall:** ${points} points · ${getPlayerTitle(points)}\n**Tester:** <@${test.testerId}>`)
    .setURL(siteUrl).setFooter({ text: 'Fighter Tiers test result' });
  const resultsChannelId = data.resultChannels?.[mode];
  if (resultsChannelId) {
    try {
      const resultsChannel = await guild.channels.fetch(resultsChannelId);
      await resultsChannel.send({ embeds: [resultEmbed] });
    } catch (error) {
      console.error(`Could not post the ${mode} result:`, error);
    }
  }
  return { player, mode, region, tier, points, title: getPlayerTitle(points), resultEmbed, queue, test };
}

function queueEmbed(data, mode, region) {
  const queue = queueFor(data, mode, region);
  const currentPlayer = data.players.find(player => player.discordId === queue.currentPlayer);
  const nextPlayer = data.players.find(player => player.discordId === queue.users[0]);
  return new EmbedBuilder().setColor(queue.open ? 0x58bd87 : 0xd6a84f)
    .setTitle(`⚔ ${mode} · ${region} tier-test queue`)
    .setDescription(queue.open ? 'This queue is open. Link your Minecraft account, then join below.' : 'This queue is closed right now. Check back when a tester opens it.')
    .addFields(
      { name: 'STATUS', value: queue.open ? '🟢 OPEN' : '🔒 CLOSED', inline: true },
      { name: 'WAITING', value: String(queue.users.length), inline: true },
      { name: 'IN TEST', value: currentPlayer?.minecraftUsername || '—', inline: true },
      { name: 'NEXT UP', value: nextPlayer?.minecraftUsername || (queue.users[0] ? 'Linked player' : '—'), inline: true }
    ).setFooter({ text: `Fighter Tiers · ${siteUrl}` });
}

async function syncPublicQueue(data, mode, region, fallbackChannelId) {
  const queue = queueFor(data, mode, region);
  const channelId = queue.panel?.channelId || process.env.PANEL_CHANNEL_ID?.trim() || fallbackChannelId;
  if (!channelId) return;
  let channel;
  try {
    channel = await client.channels.fetch(channelId);
  } catch (error) {
    if (error?.code === 50001) {
      throw new Error('Discord denied access to PANEL_CHANNEL_ID. Make sure the bot is in that server and has View Channel, Send Messages, and Embed Links permissions in the selected channel.');
    }
    throw error;
  }
  if (!channel?.isTextBased() || !channel.messages) throw new Error('The queue panel channel is not available to the bot.');
  let message;
  if (queue.panel?.messageId && queue.panel.channelId === channelId) {
    try { message = await channel.messages.fetch(queue.panel.messageId); } catch { /* Recreate a deleted queue card below. */ }
  }
  const payload = { embeds: [queueEmbed(data, mode, region)], components: queueActionButtons(mode, region) };
  if (message) await message.edit(payload);
  else message = await channel.send(payload);
  queue.panel = { channelId, messageId: message.id };
  await saveRankings(data);
}

function queueActionButtons(mode, region) {
  const key = queueKey(mode, region);
  return [new ActionRowBuilder().addComponents(
    button(`queue:join:${key}`, 'Join test queue', ButtonStyle.Success, '⚔️'),
    button(`queue:leave:${key}`, 'Leave queue', ButtonStyle.Secondary, '↩️'),
    button('flow:queue', 'Choose another', ButtonStyle.Secondary, '↩️')
  )];
}

function testerQueueButtons(mode, region, isOpen) {
  const key = queueKey(mode, region);
  return [new ActionRowBuilder().addComponents(
    button(`tester:toggle:${key}`, isOpen ? 'Close queue' : 'Open queue', isOpen ? ButtonStyle.Danger : ButtonStyle.Primary, isOpen ? '🔒' : '🚀'),
    button(`tester:next:${key}`, 'Next in queue', ButtonStyle.Success, '⏭️'),
    button(`tester:assign:${modeKey(mode)}`, 'Assign a tier', ButtonStyle.Secondary, '🏆'),
    button('flow:tester', 'Back to tester tools', ButtonStyle.Secondary, '↩️')
  )];
}

function tierChoiceButtons(mode) {
  return [
    ...rows(TIERS.map(tier => button(`tester:tier:${modeKey(mode)}:${tier}`, tier, ButtonStyle.Secondary, '🏅'))),
    new ActionRowBuilder().addComponents(button('flow:tester', 'Cancel', ButtonStyle.Secondary, '↩️'))
  ];
}

function linkModal() {
  return new ModalBuilder().setCustomId('modal:link').setTitle('Link Minecraft account')
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('username').setLabel('Minecraft Java username').setPlaceholder('Your in-game name')
        .setMinLength(3).setMaxLength(16).setStyle(TextInputStyle.Short).setRequired(true)
    ));
}

function usernameModal(mode, tier) {
  return new ModalBuilder().setCustomId(`modal:tier:${modeKey(mode)}:${tier}`).setTitle(`Assign ${tier} · ${mode}`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('username').setLabel('Minecraft username').setPlaceholder('Player to rank')
        .setMinLength(3).setMaxLength(16).setStyle(TextInputStyle.Short).setRequired(true)
    ));
}

function testerManageModal(action) {
  return new ModalBuilder().setCustomId(`modal:tester:${action}`).setTitle(`${action === 'add' ? 'Add' : 'Remove'} tester`)
    .addComponents(new ActionRowBuilder().addComponents(
      new TextInputBuilder().setCustomId('userId').setLabel('Discord user ID').setPlaceholder('Right-click user → Copy User ID')
        .setMinLength(17).setMaxLength(20).setStyle(TextInputStyle.Short).setRequired(true)
    ));
}

function profileEmbed(player) {
  const points = getPlayerPoints(player);
  const lines = GAME_MODES.map(mode => player.tiers?.[mode] ? `**${mode}:** ${player.tiers[mode]}` : null).filter(Boolean);
  return new EmbedBuilder().setColor(0xd6a84f).setTitle(`👤 ${player.minecraftUsername}`)
    .setDescription(lines.length ? lines.join('\n') : 'No tiers assigned yet.')
    .addFields({ name: 'OVERALL', value: `${points} points · ${getPlayerTitle(points)}` })
    .setURL(siteUrl);
}

function tierListEmbed(data, mode = null) {
  if (!mode) {
    const players = data.players.filter(player => getPlayerPoints(player) > 0)
      .sort((a, b) => getPlayerPoints(b) - getPlayerPoints(a) || a.minecraftUsername.localeCompare(b.minecraftUsername));
    const lines = players.slice(0, 20).map((player, i) => `**${i + 1}. ${player.minecraftUsername}** — ${getPlayerPoints(player)} pts · ${getPlayerTitle(getPlayerPoints(player))}`);
    return new EmbedBuilder().setColor(0xd6a84f).setTitle('Minecraft PvP · Overall Rankings')
      .setDescription(lines.length ? lines.join('\n') : 'No ranked players yet.')
      .setURL(siteUrl).setFooter({ text: 'Points use each player’s peak tier in each gamemode' });
  }
  const fields = TIERS.map(tier => {
    const names = data.players.filter(player => player.tiers?.[mode] === tier).map(player => player.minecraftUsername);
    return names.length ? { name: `${tier} · ${names.length}`, value: names.slice(0, 30).join('\n').slice(0, 1000) } : null;
  }).filter(Boolean);
  return new EmbedBuilder().setColor(0xd6a84f).setTitle(`${mode} · Tier List`)
    .setDescription(fields.length ? 'Tier order runs from HT1 at the top to LT5 at the bottom.' : 'No players are ranked in this gamemode yet.')
    .addFields(fields).setURL(siteUrl).setFooter({ text: 'Minecraft PvP · Fighter Tiers' });
}

async function showQueueRegion(interaction, mode, region) {
  const data = await getRankings();
  const queue = queueFor(data, mode, region);
  await interaction.update({ embeds: [queueEmbed(data, mode, region)], components: queueActionButtons(mode, region) });
}

async function handleButton(interaction) {
  const [scope, action, arg1, arg2] = interaction.customId.split(':');
  if (scope === 'testresult') {
    if (!await isTester(interaction)) return interaction.reply({ content: 'Only testers can record a result.', ephemeral: true });
    const data = await getRankings();
    const active = findActiveTest(data, interaction.channelId);
    if (!active) return interaction.reply({ content: 'There is no active test in this room.', ephemeral: true });
    if (active.test.testerId !== interaction.user.id) return interaction.reply({ content: 'Only the tester assigned to this room can record its result.', ephemeral: true });
    const result = await recordTestResult(data, active, action, interaction.guild);
    await interaction.update({ content: 'Test result recorded.', embeds: [result.resultEmbed], components: [] });
    await syncPublicQueue(data, result.mode, result.region, process.env.PANEL_CHANNEL_ID);
    // Keep the private room visible briefly so both participants can see confirmation.
    setTimeout(async () => {
      try {
        const testRoom = await interaction.guild.channels.fetch(result.test.channelId);
        if (testRoom) await testRoom.delete('Fighter Tiers test completed');
      } catch (error) {
        console.error('Could not delete the completed private test room:', error);
      }
    }, 10_000).unref?.();
    return;
  }
  if (scope === 'panel') {
    if (action === 'link') return interaction.showModal(linkModal());
    if (action === 'queue') return interaction.reply({ content: 'Choose a Minecraft PvP gamemode:', components: modeButtons('flow:queue-mode', 'panel:home'), ephemeral: true });
    if (action === 'tiers') return interaction.reply({ content: 'Choose a gamemode, or view the overall leaderboard:', components: [
      new ActionRowBuilder().addComponents(button('tiers:overall', 'Overall leaderboard', ButtonStyle.Primary, '🏆')),
      ...modeButtons('tiers:mode', 'panel:home')
    ], ephemeral: true });
    if (action === 'profile') return interaction.showModal(new ModalBuilder().setCustomId('modal:profile').setTitle('Find a player profile')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('username').setLabel('Minecraft username').setMinLength(3).setMaxLength(16).setStyle(TextInputStyle.Short).setRequired(true))));
    if (action === 'tester') {
      if (!await isTester(interaction)) return interaction.reply({ content: 'Tester tools are only available to configured testers.', ephemeral: true });
      return interaction.reply({ content: 'Choose a gamemode for tester controls:', components: modeButtons('flow:tester-mode', 'panel:home'), ephemeral: true });
    }
    if (action === 'manage-testers') {
      if (!isGuildOwner(interaction)) return interaction.reply({ content: 'Only the server owner or a member with Manage Server permission can manage testers.', ephemeral: true });
      return interaction.reply({ content: 'Manage this server’s tester access:', components: [new ActionRowBuilder().addComponents(
        button('tester-manage:add', 'Add tester', ButtonStyle.Success, '➕'),
        button('tester-manage:remove', 'Remove tester', ButtonStyle.Danger, '➖'),
        button('tester-manage:list', 'List testers', ButtonStyle.Secondary, '👥')
      )], ephemeral: true });
    }
    if (action === 'home') return interaction.reply({ content: 'Use the Fighter Tiers buttons below to continue.', ephemeral: true });
  }

  if (scope === 'flow' && action === 'queue-mode') {
    const mode = GAME_MODES.find(value => modeKey(value) === arg1);
    if (!mode) return interaction.reply({ content: 'Unknown gamemode.', ephemeral: true });
    return interaction.update({ content: `Choose your region for **${mode}**:`, components: regionButtons(`flow:queue-region:${modeKey(mode)}`, 'panel:queue') });
  }
  if (scope === 'flow' && action === 'queue-region') {
    const mode = GAME_MODES.find(value => modeKey(value) === arg1);
    const region = REGIONS.find(value => value.toLowerCase() === arg2);
    if (!mode || !region) return interaction.reply({ content: 'Unknown gamemode or region.', ephemeral: true });
    return showQueueRegion(interaction, mode, region);
  }
  if (scope === 'flow' && action === 'tester-mode') {
    if (!await isTester(interaction)) return interaction.reply({ content: 'Tester tools are only available to configured testers.', ephemeral: true });
    const mode = GAME_MODES.find(value => modeKey(value) === arg1);
    if (!mode) return interaction.reply({ content: 'Unknown gamemode.', ephemeral: true });
    return interaction.update({ content: `Choose the region for **${mode}**:`, components: regionButtons(`flow:tester-region:${modeKey(mode)}`, 'panel:tester') });
  }
  if (scope === 'flow' && action === 'tester-region') {
    if (!await isTester(interaction)) return interaction.reply({ content: 'Tester tools are only available to configured testers.', ephemeral: true });
    const mode = GAME_MODES.find(value => modeKey(value) === arg1);
    const region = REGIONS.find(value => value.toLowerCase() === arg2);
    if (!mode || !region) return interaction.reply({ content: 'Unknown gamemode or region.', ephemeral: true });
    const data = await getRankings();
    const queue = queueFor(data, mode, region);
    return interaction.update({ content: 'Tester queue controls:', embeds: [queueEmbed(data, mode, region)], components: testerQueueButtons(mode, region, queue.open) });
  }

  if (scope === 'tiers' && action === 'overall') return interaction.reply({ embeds: [tierListEmbed(await getRankings())], ephemeral: true });
  if (scope === 'tiers' && action === 'mode') {
    const mode = GAME_MODES.find(value => modeKey(value) === arg1);
    if (!mode) return interaction.reply({ content: 'Unknown gamemode.', ephemeral: true });
    return interaction.reply({ embeds: [tierListEmbed(await getRankings(), mode)], ephemeral: true });
  }

  if (scope === 'queue' && (action === 'join' || action === 'leave')) {
    const [modeSlug, regionSlug] = arg1.split('~');
    const mode = GAME_MODES.find(value => modeKey(value).slice(0, 35) === modeSlug);
    const region = REGIONS.find(value => value.toLowerCase() === regionSlug);
    if (!mode || !region) return interaction.reply({ content: 'That queue is no longer available.', ephemeral: true });
    const data = await getRankings();
    const queue = queueFor(data, mode, region);
    if (action === 'join') {
      if (!queue.open) return interaction.reply({ content: 'This queue is closed right now.', ephemeral: true });
      const player = data.players.find(entry => entry.discordId === interaction.user.id);
      if (!player) return interaction.reply({ content: 'Use **Link Minecraft** on the main panel first.', ephemeral: true });
      if (!queue.users.includes(interaction.user.id)) queue.users.push(interaction.user.id);
    } else queue.users = queue.users.filter(id => id !== interaction.user.id);
    data.updatedAt = new Date().toISOString();
    await saveRankings(data);
    await interaction.update({ embeds: [queueEmbed(data, mode, region)], components: queueActionButtons(mode, region) });
    await syncPublicQueue(data, mode, region, interaction.channelId);
    return;
  }

  if (scope === 'tester' && (action === 'toggle' || action === 'next')) {
    if (!await isTester(interaction)) return interaction.reply({ content: 'Only testers can manage the tier-test queue.', ephemeral: true });
    const [modeSlug, regionSlug] = arg1.split('~');
    const mode = GAME_MODES.find(value => modeKey(value).slice(0, 35) === modeSlug);
    const region = REGIONS.find(value => value.toLowerCase() === regionSlug);
    if (!mode || !region) return interaction.reply({ content: 'That queue is no longer available.', ephemeral: true });
    const data = await getRankings();
    const queue = queueFor(data, mode, region);
    if (action === 'toggle') queue.open = !queue.open;
    else {
      if (!queue.open) return interaction.reply({ content: 'Open this queue before calling the next player.', ephemeral: true });
      if (queue.activeTest) return interaction.reply({ content: `Finish the active test in <#${queue.activeTest.channelId}> before calling another player.`, ephemeral: true });
      const nextId = queue.users[0];
      if (!nextId) return interaction.reply({ content: 'Nobody is waiting in this queue yet.', ephemeral: true });
      const nextPlayer = data.players.find(entry => entry.discordId === nextId);
      if (!nextPlayer) return interaction.reply({ content: 'That queued user has no linked Minecraft profile. Remove them from the queue and ask them to link again.', ephemeral: true });
      const { room, message } = await createTestRoom(interaction.guild, mode, region, nextId, interaction.user.id, nextPlayer.minecraftUsername);
      queue.users.shift();
      queue.currentPlayer = nextId;
      queue.activeTest = { channelId: room.id, messageId: message.id, playerId: nextId, testerId: interaction.user.id, minecraftUsername: nextPlayer.minecraftUsername, startedAt: new Date().toISOString() };
    }
    data.updatedAt = new Date().toISOString();
    await saveRankings(data);
    await interaction.update({ content: action === 'toggle' ? 'Tester queue controls:' : 'Next player selected:', embeds: [queueEmbed(data, mode, region)], components: testerQueueButtons(mode, region, queue.open) });
    await syncPublicQueue(data, mode, region, interaction.channelId);
    if (action === 'next') {
      const player = data.players.find(entry => entry.discordId === queue.currentPlayer);
      await interaction.channel?.send({ content: `⚔️ <@${queue.currentPlayer}>${player?.minecraftUsername ? ` (**${player.minecraftUsername}**)` : ''} is next for **${mode} · ${region}**. Private test room: <#${queue.activeTest.channelId}>.`, allowedMentions: { users: [queue.currentPlayer] } });
    }
    return;
  }

  if (scope === 'tester' && action === 'assign') {
    if (!await isTester(interaction)) return interaction.reply({ content: 'Only testers can assign tiers.', ephemeral: true });
    const mode = GAME_MODES.find(value => modeKey(value) === arg1);
    if (!mode) return interaction.reply({ content: 'Unknown gamemode.', ephemeral: true });
    return interaction.update({ content: `Choose the test result for **${mode}**:`, components: tierChoiceButtons(mode) });
  }
  if (scope === 'tester' && action === 'tier') {
    if (!await isTester(interaction)) return interaction.reply({ content: 'Only testers can assign tiers.', ephemeral: true });
    const mode = GAME_MODES.find(value => modeKey(value) === arg1);
    const tier = arg2;
    if (!mode || !TIERS.includes(tier)) return interaction.reply({ content: 'Unknown gamemode or tier.', ephemeral: true });
    return interaction.showModal(usernameModal(mode, tier));
  }

  if (scope === 'tester-manage') {
    if (!isGuildOwner(interaction)) return interaction.reply({ content: 'Only the server owner or a member with Manage Server permission can manage testers.', ephemeral: true });
    if (action === 'list') {
      const data = await getRankings();
      const testers = data.testers?.[interaction.guildId] || [];
      return interaction.reply({ content: testers.length ? `**Testers**\n${testers.map(id => `<@${id}>`).join('\n')}` : 'No testers assigned yet.', ephemeral: true, allowedMentions: { parse: [] } });
    }
    return interaction.showModal(testerManageModal(action));
  }

  if (scope === 'flow' && action === 'tester') {
    if (!await isTester(interaction)) return interaction.reply({ content: 'Tester tools are only available to configured testers.', ephemeral: true });
    return interaction.update({ content: 'Choose a gamemode for tester controls:', components: modeButtons('flow:tester-mode', 'panel:home') });
  }
  if (scope === 'flow' && action === 'queue') {
    return interaction.update({ content: 'Choose a Minecraft PvP gamemode:', components: modeButtons('flow:queue-mode', 'panel:home') });
  }
  if (scope === 'panel' && action === 'home') return interaction.reply({ content: 'Use the Fighter Tiers buttons below to continue.', ephemeral: true });
}

async function handleModal(interaction) {
  const [scope, action, modeSlug, tier] = interaction.customId.split(':');
  const data = await getRankings();
  if (scope === 'modal' && action === 'link') {
    const username = interaction.fields.getTextInputValue('username').trim();
    if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) return interaction.reply({ content: 'Use a Minecraft Java username with 3–16 letters, numbers, or underscores.', ephemeral: true });
    const existing = data.players.find(player => normalize(player.minecraftUsername) === normalize(username) && player.discordId !== interaction.user.id);
    if (existing) return interaction.reply({ content: 'That Minecraft username is already linked to another Discord account.', ephemeral: true });
    let player = data.players.find(entry => entry.discordId === interaction.user.id)
      || data.players.find(entry => normalize(entry.minecraftUsername) === normalize(username));
    if (player) {
      player.discordId = interaction.user.id;
      player.minecraftUsername = username;
    } else data.players.push({ discordId: interaction.user.id, minecraftUsername: username, tiers: {}, peakTiers: {} });
    data.updatedAt = new Date().toISOString();
    await saveRankings(data);
    return interaction.reply({ content: `Linked your Minecraft account as **${username}**.`, ephemeral: true });
  }
  if (scope === 'modal' && action === 'profile') {
    const username = interaction.fields.getTextInputValue('username').trim();
    const player = data.players.find(entry => normalize(entry.minecraftUsername) === normalize(username));
    if (!player) return interaction.reply({ content: `No profile found for **${username}**.`, ephemeral: true });
    return interaction.reply({ embeds: [profileEmbed(player)], ephemeral: true });
  }
  if (scope === 'modal' && action === 'tier') {
    if (!await isTester(interaction)) return interaction.reply({ content: 'Only testers can assign tiers.', ephemeral: true });
    const mode = GAME_MODES.find(value => modeKey(value) === modeSlug);
    const username = interaction.fields.getTextInputValue('username').trim();
    if (!mode || !TIERS.includes(tier) || !/^[A-Za-z0-9_]{3,16}$/.test(username)) return interaction.reply({ content: 'Check the Minecraft name, gamemode, and tier.', ephemeral: true });
    let player = data.players.find(entry => normalize(entry.minecraftUsername) === normalize(username));
    if (!player) {
      player = { discordId: null, minecraftUsername: username, tiers: {}, peakTiers: {} };
      data.players.push(player);
    }
    player.tiers ??= {};
    player.peakTiers ??= {};
    player.tiers[mode] = tier;
    const previousPeak = player.peakTiers[mode];
    if (!previousPeak || TIERS.indexOf(tier) < TIERS.indexOf(previousPeak)) player.peakTiers[mode] = tier;
    data.updatedAt = new Date().toISOString();
    await saveRankings(data);
    const points = getPlayerPoints(player);
    return interaction.reply({ content: `Saved **${username} · ${mode} · ${tier}**. Overall: **${points} points · ${getPlayerTitle(points)}**.`, ephemeral: true });
  }
  if (scope === 'modal' && action === 'tester') {
    if (!isGuildOwner(interaction)) return interaction.reply({ content: 'Only the server owner or a member with Manage Server permission can manage testers.', ephemeral: true });
    const id = interaction.fields.getTextInputValue('userId').trim();
    if (!/^\d{17,20}$/.test(id)) return interaction.reply({ content: 'That does not look like a Discord user ID. Enable Developer Mode and use Copy User ID.', ephemeral: true });
    data.testers ??= {};
    const list = data.testers[interaction.guildId] ??= [];
    if (modeSlug === 'add') {
      if (!list.includes(id)) list.push(id);
      await saveRankings(data);
      return interaction.reply({ content: `Added <@${id}> as a tester.`, ephemeral: true });
    }
    if (!list.includes(id)) return interaction.reply({ content: 'That user is not on this server’s tester list.', ephemeral: true });
    data.testers[interaction.guildId] = list.filter(userId => userId !== id);
    await saveRankings(data);
    return interaction.reply({ content: `Removed <@${id}> from this server’s testers.`, ephemeral: true });
  }
}

async function publishPanel() {
  const channelId = process.env.PANEL_CHANNEL_ID?.trim();
  if (!channelId) {
    console.warn('Set PANEL_CHANNEL_ID in .env to choose where the Fighter Tiers button panel is posted.');
    return;
  }
  if (!/^\d{17,20}$/.test(channelId)) {
    throw new Error('PANEL_CHANNEL_ID must be the numeric ID copied from your Discord text channel (right-click the channel → Copy Channel ID).');
  }
  const channel = await client.channels.fetch(channelId);
  if (!channel?.isTextBased() || !channel.messages) throw new Error('PANEL_CHANNEL_ID must be a text channel the bot can access.');
  const data = await getRankings();
  data.panels ??= {};
  let message;
  const messageId = data.panels[channelId]?.messageId;
  if (messageId) {
    try { message = await channel.messages.fetch(messageId); } catch { /* Recreate a deleted panel below. */ }
  }
  if (message) await message.edit(panelPayload());
  else message = await channel.send(panelPayload());
  data.panels[channelId] = { messageId: message.id };
  await saveRankings(data);
  for (const mode of GAME_MODES) for (const region of REGIONS) {
    if (data.queues[queueKey(mode, region)]?.open) await syncPublicQueue(data, mode, region, channelId);
  }
  try {
    await ensureResultsChannels(channel.guild);
  } catch (error) {
    if (error.code === 50013 || error.code === 50001) {
      console.error('The panel is ready, but I could not create the per-mode results channels. Give the bot Manage Channels permission (and allow it in the target category), then restart.');
    } else {
      throw error;
    }
  }
  console.log(`Fighter Tiers button panel is available in channel ${channelId}.`);
}

client.once(Events.ClientReady, async readyClient => {
  console.log(`Fighter Tiers bot is online as ${readyClient.user.tag}`);
  console.log(`Fighter Tiers website is available on port ${Number(process.env.PORT) || 3000}`);
  try { await publishPanel(); } catch (error) { console.error('Could not publish button panel:', error); }
});

client.on(Events.InteractionCreate, async interaction => {
  try {
    if (interaction.isButton()) return await handleButton(interaction);
    if (interaction.isModalSubmit()) return await handleModal(interaction);
  } catch (error) {
    console.error('Button interaction failed:', error);
    const message = 'That action could not be completed. Please try again.';
    if (interaction.deferred || interaction.replied) await interaction.followUp({ content: message, ephemeral: true }).catch(() => {});
    else await interaction.reply({ content: message, ephemeral: true }).catch(() => {});
  }
});

client.login(token);
