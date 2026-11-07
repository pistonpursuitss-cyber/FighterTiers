import 'dotenv/config';
import { REST, Routes } from 'discord.js';

const { BOT_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!BOT_TOKEN || !CLIENT_ID) throw new Error('Set BOT_TOKEN and CLIENT_ID in your environment.');

const rest = new REST({ version: '10' }).setToken(BOT_TOKEN);
await rest.put(Routes.applicationCommands(CLIENT_ID), { body: [] });
if (GUILD_ID) await rest.put(Routes.applicationGuildCommands(CLIENT_ID, GUILD_ID), { body: [] });
console.log('Removed the old slash commands. Use the Fighter Tiers button panel instead.');
