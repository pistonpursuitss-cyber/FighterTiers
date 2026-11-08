# Fighter Tiers

Fighter Tiers is a Minecraft PvP tier-list website and button-driven Discord bot. Players use a persistent message panel for account linking, tier-test queues, leaderboards, and profiles. Testers get private queue and tier-assignment controls.

## Setup

1. Put `BOT_TOKEN`, `CLIENT_ID`, and `PANEL_CHANNEL_ID` in `.env` at the project root. To get the channel ID, enable Discord Developer Mode, right-click the channel where the panel should live, and choose **Copy Channel ID**.
2. Invite the bot with the `bot` scope and permissions to **View Channels**, **Send Messages**, **Embed Links**, and **Manage Channels**. Manage Channels lets it create private test rooms and per-gamemode result channels.
3. Run `npm install`.
4. Run `npm run commands` once to remove the old slash commands.
5. Run `npm start`. The bot posts or refreshes its persistent button panel in the configured channel and starts the website at `http://localhost:3000`.

## Button flows

- **Link Minecraft** — opens a username form.
- **Join a tier test** — choose Rocket Mace, Spear Mace, Diamond Pot, Netherite Pot, SMP, UHC, Axe, Crystal, Sword, or Mace, then a region. Join or leave the queue with buttons.
- **Browse tiers** — show a mode-specific tier board or the overall leaderboard.
- **My profile** — search a Minecraft username.
- **Tester tools** — opening a regional queue publishes a shared live queue card in the configured panel channel. Testers can close it, call the next player, and assign a result from HT1 to LT5.
- **Remove a tier** — testers can choose a gamemode and Minecraft username, review the current tier, and confirm removal. This clears that gamemode’s current and peak tier, updates overall points and the website, and logs the change in the gamemode results channel.
- **Private test rooms** — when a tester selects **Next in queue**, the bot creates a private channel for that player and the assigned tester. The assigned tester records the result using the tier buttons. The result updates the website and is posted in that gamemode’s `results-*` channel. The private test room is deleted 10 seconds after completion; results channels are kept.
- **Manage testers** — add, remove, or list testers using buttons; server owner or Manage Server permission required.

Players must link their Minecraft Java username before joining a queue. Regions are NA, EU, SA, AU, ME, AS, and AF. Tiers contribute peak-tier points to the overall leaderboard. The bot creates results channels automatically when it starts. Optional `TEST_CHANNEL_CATEGORY_ID` and `RESULTS_CATEGORY_ID` values in `.env` place the generated channels under existing categories.

No Message Content privileged intent is needed; test results are recorded through the buttons.
Everyone who should see queues needs **View Channel** access to the channel set by `PANEL_CHANNEL_ID`.

## Free website hosting

GitHub Pages hosts the public website for free. In the repository, open **Settings → Pages** and set **Build and deployment → Source** to **GitHub Actions**. The workflow publishes the `public/` folder at `https://pistonpursuitss-cyber.github.io/FighterTiers/`.

The Discord bot still runs on your computer with `npm start`, so queue and tester features are available while it is running. To sync website rankings from the bot, create a fine-grained GitHub token limited to this repository with **Contents: Read and write**, then put these values in your local `.env`:

```env
SITE_URL=https://pistonpursuitss-cyber.github.io/FighterTiers
GITHUB_REPOSITORY=pistonpursuitss-cyber/FighterTiers
GITHUB_BRANCH=main
GITHUB_TOKEN=your-token
```

Keep `.env` private; it is ignored by Git. The bot only uploads a public snapshot of usernames, tiers, points, and queue status. It does not upload Discord IDs, tester lists, or channel IDs. Each snapshot update triggers the Pages workflow. Never put a token in this repository.
