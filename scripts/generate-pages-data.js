import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { getRankings, makePublicRankings } from '../src/data.js';

const outputPath = fileURLToPath(new URL('../public/data.json', import.meta.url));
const publicData = makePublicRankings(await getRankings());
await writeFile(outputPath, `${JSON.stringify(publicData, null, 2)}\n`, 'utf8');
console.log('Generated public/data.json without private Discord IDs or tester settings.');
