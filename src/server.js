import express from 'express';
import { fileURLToPath } from 'node:url';
import { GAME_MODES, REGIONS, TIERS, getPlayerPoints, getPlayerTitle, getRankings, queueKey } from './data.js';

const app = express();
const publicDir = fileURLToPath(new URL('../public/', import.meta.url));
const port = Number(process.env.PORT) || 3000;

app.disable('x-powered-by');
app.use(express.static(publicDir));
app.get('/api/fighters', async (_request, response) => {
  try {
    response.set('Cache-Control', 'no-store');
    const data = await getRankings();
    const players = data.players.map(player => {
      const points = getPlayerPoints(player);
      return { minecraftUsername: player.minecraftUsername, tiers: player.tiers || {}, peakTiers: player.peakTiers || {}, points, title: getPlayerTitle(points) };
    });
    const leaderboard = [...players].sort((a, b) => b.points - a.points || a.minecraftUsername.localeCompare(b.minecraftUsername));
    response.json({
      updatedAt: data.updatedAt,
      gameModes: GAME_MODES,
      regions: REGIONS,
      tiers: TIERS,
      players: leaderboard,
      modeRankings: Object.fromEntries(GAME_MODES.map(mode => [mode,
        [...players].filter(player => player.tiers[mode]).sort((a, b) => TIERS.indexOf(a.tiers[mode]) - TIERS.indexOf(b.tiers[mode]) || a.minecraftUsername.localeCompare(b.minecraftUsername))
      ])),
      queues: Object.fromEntries(GAME_MODES.map(mode => [mode, Object.fromEntries(REGIONS.map(region => {
        const queue = data.queues[queueKey(mode, region)] || {};
        return [region, { open: Boolean(queue.open), count: Array.isArray(queue.users) ? queue.users.length : 0 }];
      }))]))
    });
  } catch (error) {
    console.error('Could not read fighter data:', error);
    response.status(500).json({ error: 'Rankings are temporarily unavailable.' });
  }
});
app.get('/health', (_request, response) => response.json({ ok: true, service: 'fighter-tiers' }));

app.listen(port, () => console.log(`Fighter Tiers website listening on port ${port}`));
