import { copyFile, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PermissionsBitField } from 'discord.js';

const seedDataPath = fileURLToPath(new URL('../data/fighters.json', import.meta.url));
const dataPath = process.env.FIGHTERS_DATA_PATH ? path.resolve(process.env.FIGHTERS_DATA_PATH) : seedDataPath;

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
