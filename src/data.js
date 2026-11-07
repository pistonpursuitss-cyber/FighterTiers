import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PermissionsBitField } from 'discord.js';

const seedDataPath = fileURLToPath(new URL('../data/fighters.json', import.meta.url));
const dataPath = process.env.FIGHTERS_DATA_PATH ? path.resolve(process.env.FIGHTERS_DATA_PATH) : seedDataPath;
const publicDataPath = fileURLToPath(new URL('../public/data.json', import.meta.url));
let githubPublishQueue = Promise.resolve();

export const GAME_MODES = ['Vanilla', 'UHC', 'Pot', 'NethOP', 'SMP', 'Sword', 'Axe', 'Mace'];
export const REGIONS = ['NA', 'EU', 'SA', 'AU', 'ME', 'AS', 'AF'];
export const TIERS = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];
export const TIER_POINTS = { HT1: 60, LT1: 45, HT2: 30, LT2: 20, HT3: 10, LT3: 6, HT4: 4, LT4: 3, HT5: 2, LT5: 1 };

export function getPlayerPoints(player) {
  const modes = new Set([...Object.keys(player.tiers || {}), ...Object.keys(player.peakTiers || {})]);
  return [...modes].reduce((sum, mode) => {
    const tier = player.peakTiers?.[mode] || player.tiers?.[mode];
    return sum + (TIER_POINTS[tier] || 0);
  }, 0);
}

export function getPlayerTitle(points) {
  if (points >= 400) return 'Combat Grandmaster';
  if (points >= 250) return 'Combat Master';
  if (points >= 100) return 'Combat Ace';
  if (points >= 50) return 'Combat Specialist';
  if (points >= 20) return 'Combat Cadet';
  if (points >= 10) return 'Combat Novice';
  return 'Rookie';
}

export async function getRankings() {
  let contents;
  try {
    contents = await readFile(dataPath, 'utf8');
  } catch (error) {
    if (error.code !== 'ENOENT' || dataPath === seedDataPath) throw error;
    await copyFile(seedDataPath, dataPath);
    contents = await readFile(dataPath, 'utf8');
  }
  const data = JSON.parse(contents);
  return {
    updatedAt: data.updatedAt ?? null,
    fighters: Array.isArray(data.fighters) ? data.fighters : [],
    gameModes: GAME_MODES,
    regions: REGIONS,
    players: Array.isArray(data.players) ? data.players : [],
    queuesOpen: Boolean(data.queuesOpen),
    queues: data.queues && typeof data.queues === 'object' ? data.queues : {},
    testers: data.testers && typeof data.testers === 'object' ? data.testers : {},
    panels: data.panels && typeof data.panels === 'object' ? data.panels : {},
    resultChannels: data.resultChannels && typeof data.resultChannels === 'object' ? data.resultChannels : {}
  };
}

export function modeKey(label) {
  return normalize(label).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
}

export function queueKey(mode, region) {
  return `${modeKey(mode).slice(0, 35)}~${modeKey(region).slice(0, 10)}`;
}

export async function saveRankings(data) {
  const temporaryPath = `${dataPath}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await rename(temporaryPath, dataPath);

  const publicData = makePublicRankings(data);
  const publicJson = `${JSON.stringify(publicData, null, 2)}\n`;
  await writeFile(publicDataPath, publicJson, 'utf8');
  await queueGitHubPublish(publicJson);
}

export function makePublicRankings(data) {
  const players = (Array.isArray(data.players) ? data.players : []).map(player => {
    const points = getPlayerPoints(player);
    return {
      minecraftUsername: player.minecraftUsername,
      tiers: player.tiers || {},
      peakTiers: player.peakTiers || {},
      points,
      title: getPlayerTitle(points)
    };
  });
  const leaderboard = [...players].sort((a, b) => b.points - a.points || a.minecraftUsername.localeCompare(b.minecraftUsername));
  return {
    updatedAt: data.updatedAt ?? null,
    gameModes: GAME_MODES,
    regions: REGIONS,
    tiers: TIERS,
    players: leaderboard,
    modeRankings: Object.fromEntries(GAME_MODES.map(mode => [mode,
      [...players].filter(player => player.tiers[mode]).sort((a, b) => TIERS.indexOf(a.tiers[mode]) - TIERS.indexOf(b.tiers[mode]) || a.minecraftUsername.localeCompare(b.minecraftUsername))
    ])),
    queues: Object.fromEntries(GAME_MODES.map(mode => [mode, Object.fromEntries(REGIONS.map(region => {
      const queue = data.queues?.[queueKey(mode, region)] || {};
      return [region, { open: Boolean(queue.open), count: Array.isArray(queue.users) ? queue.users.length : 0 }];
    }))]))
  };
}

function queueGitHubPublish(content) {
  const token = process.env.GITHUB_TOKEN?.trim();
  const repository = process.env.GITHUB_REPOSITORY?.trim();
  if (!token || !repository) return Promise.resolve();

  const publish = githubPublishQueue.then(async () => {
    const branch = process.env.GITHUB_BRANCH?.trim() || 'main';
    const endpoint = `https://api.github.com/repos/${repository}/contents/public/data.json`;
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    const current = await fetch(`${endpoint}?ref=${encodeURIComponent(branch)}`, { headers });
    let sha;
    if (current.ok) sha = (await current.json()).sha;
    else if (current.status !== 404) throw new Error(`GitHub read returned HTTP ${current.status}`);

    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: 'Update public Fighter Tiers rankings',
        content: Buffer.from(content, 'utf8').toString('base64'),
        branch,
        ...(sha ? { sha } : {})
      })
    });
    if (!response.ok) throw new Error(`GitHub update returned HTTP ${response.status}: ${await response.text()}`);
  });
  githubPublishQueue = publish.catch(error => {
    console.error('Could not sync public rankings to GitHub; local bot data was saved:', error.message);
  });
  return githubPublishQueue;
}

export async function isTester(interaction) {
  if (isGuildOwner(interaction)) return true;
  const ids = (process.env.TESTER_IDS || '').split(',').map(id => id.trim()).filter(Boolean);
  const roleId = process.env.TESTER_ROLE_ID?.trim();
  const roles = interaction.member?.roles;
  const hasRole = roleId && (roles?.cache?.has(roleId) || (Array.isArray(roles) && roles.includes(roleId)));
  if (ids.includes(interaction.user.id) || hasRole) return true;
  if (!interaction.guildId) return false;
  const data = await getRankings();
  return Array.isArray(data.testers?.[interaction.guildId]) && data.testers[interaction.guildId].includes(interaction.user.id);
}

export function isGuildOwner(interaction) {
  if (!interaction.guildId) return false;
  if (interaction.guild?.ownerId === interaction.user.id) return true;
  return Boolean(interaction.memberPermissions?.has(PermissionsBitField.Flags.Administrator)
    || interaction.memberPermissions?.has(PermissionsBitField.Flags.ManageGuild));
}

export function normalize(value) {
  return String(value ?? '').trim().toLocaleLowerCase();
}
