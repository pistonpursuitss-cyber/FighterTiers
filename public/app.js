const playerBody = document.querySelector('#players');
const search = document.querySelector('#search');
const modeSelect = document.querySelector('#mode-filter');
const tierBoard = document.querySelector('#tier-board');
const error = document.querySelector('#error');
const tierOrder = ['HT1', 'LT1', 'HT2', 'LT2', 'HT3', 'LT3', 'HT4', 'LT4', 'HT5', 'LT5'];
let rankings = { players: [], modeRankings: {}, gameModes: [], regions: [], queues: {} };

function selectedPlayers() {
  const selectedMode = modeSelect.value;
  const source = selectedMode === 'overall' ? rankings.players : rankings.modeRankings[selectedMode] || [];
  const query = search.value.trim().toLocaleLowerCase();
  return source.filter(player => `${player.minecraftUsername} ${player.title} ${Object.values(player.tiers || {}).join(' ')}`.toLocaleLowerCase().includes(query));
}

function renderBoard() {
  const selectedMode = modeSelect.value;
  const players = selectedPlayers();
  tierBoard.replaceChildren();
  if (!players.length) {
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = rankings.players.length ? 'No ranked players match this filter yet.' : 'No players have been tier tested yet.';
    tierBoard.append(empty);
    return;
  }

  if (selectedMode === 'overall') {
    const lane = document.createElement('section');
    lane.className = 'tier-lane overall-lane';
    const heading = document.createElement('h3');
    heading.className = 'tier-heading overall-heading';
    heading.textContent = 'TOP';
    const cards = document.createElement('div');
    cards.className = 'tier-fighters';
    players.slice(0, 100).forEach((player, index) => {
      const card = document.createElement('article');
      card.className = 'tier-fighter';
      const name = document.createElement('strong');
      name.textContent = `${index + 1}. ${player.minecraftUsername}`;
      const meta = document.createElement('span');
      meta.textContent = `${player.points} pts · ${player.title}`;
      card.append(name, meta);
      cards.append(card);
    });
    lane.append(heading, cards);
    tierBoard.append(lane);
    return;
  }

  for (const tier of tierOrder) {
    const ranked = players.filter(player => player.tiers[selectedMode] === tier);
    if (!ranked.length) continue;
    const lane = document.createElement('section');
    lane.className = 'tier-lane';
    const heading = document.createElement('h3');
    heading.className = `tier-heading tier-${tier.toLowerCase()}`;
    heading.textContent = tier;
    const cards = document.createElement('div');
    cards.className = 'tier-fighters';
    for (const player of ranked) {
      const card = document.createElement('article');
      card.className = 'tier-fighter';
      const name = document.createElement('strong');
      name.textContent = player.minecraftUsername;
      const meta = document.createElement('span');
      meta.textContent = `${player.points} overall points`;
      card.append(name, meta);
      cards.append(card);
    }
    lane.append(heading, cards);
    tierBoard.append(lane);
  }
}

function renderList() {
  const players = selectedPlayers();
  playerBody.replaceChildren();
  if (!players.length) {
    const row = document.createElement('tr');
    const cell = document.createElement('td');
    cell.colSpan = 5;
    cell.className = 'empty';
    cell.textContent = rankings.players.length ? 'No ranked players match this filter yet.' : 'No players have been tier tested yet.';
    row.append(cell);
    playerBody.append(row);
    return;
  }
  players.forEach((player, index) => {
    const row = document.createElement('tr');
    const tiers = Object.entries(player.tiers || {}).map(([mode, tier]) => `${mode}: ${tier}`).join(' · ') || '—';
    const values = [String(index + 1).padStart(2, '0'), player.minecraftUsername, player.title, `${player.points} pts`, tiers];
    for (const [i, value] of values.entries()) {
      const cell = document.createElement('td');
      const span = document.createElement('span');
      span.className = ['rank', 'fighter-name', 'division-name', 'record', 'record'][i];
      span.textContent = value;
      cell.append(span);
      row.append(cell);
    }
    playerBody.append(row);
  });
}

function renderQueues() {
  const grid = document.querySelector('#queue-grid');
  grid.replaceChildren();
  for (const mode of rankings.gameModes) {
    const group = document.createElement('section');
    group.className = 'game-queue-group';
    const title = document.createElement('h3');
    title.className = 'game-queue-title';
    title.textContent = mode;
    const cards = document.createElement('div');
    cards.className = 'queue-grid';
    for (const [index, region] of rankings.regions.entries()) {
      const queue = rankings.queues[mode]?.[region] || { open: false, count: 0 };
      const card = document.createElement('article');
      card.className = 'queue-card';
      const top = document.createElement('div');
      top.className = 'queue-card-top';
      const number = document.createElement('span');
      number.className = 'queue-number';
      number.textContent = String(index + 1).padStart(2, '0');
      const status = document.createElement('span');
      status.className = `queue-status ${queue.open ? 'is-open' : ''}`;
      status.textContent = queue.open ? 'OPEN' : 'CLOSED';
      top.append(number, status);
      const name = document.createElement('h5');
      name.textContent = region;
      const count = document.createElement('div');
      count.className = 'queue-card-bottom';
      count.textContent = `${queue.count} WAITING`;
      card.append(top, name, count);
      cards.append(card);
    }
    group.append(title, cards);
    grid.append(group);
  }
  if (!rankings.gameModes.length) grid.textContent = 'No gamemodes configured.';
}

function render() {
  renderBoard();
  renderList();
}

function setView(view) {
  const showBoard = view === 'board';
  tierBoard.hidden = !showBoard;
  document.querySelector('#list-board').hidden = showBoard;
  document.querySelector('#board-view').classList.toggle('active', showBoard);
  document.querySelector('#list-view').classList.toggle('active', !showBoard);
  document.querySelector('#board-view').setAttribute('aria-pressed', String(showBoard));
  document.querySelector('#list-view').setAttribute('aria-pressed', String(!showBoard));
}

async function load() {
  try {
    const response = await fetch('/api/fighters');
    if (!response.ok) throw new Error('Rankings are temporarily unavailable. Refresh to try again.');
    const data = await response.json();
    rankings = data;
    const selected = modeSelect.value;
    modeSelect.replaceChildren(new Option('Overall leaderboard', 'overall'));
    for (const mode of rankings.gameModes) modeSelect.add(new Option(mode, mode));
    if (rankings.gameModes.includes(selected)) modeSelect.value = selected;
    document.querySelector('#fighter-count').textContent = String(rankings.players.length).padStart(2, '0');
    document.querySelector('#division-count').textContent = String(rankings.gameModes.length).padStart(2, '0');
    document.querySelector('#updated').textContent = rankings.updatedAt
      ? `UPDATED ${new Date(rankings.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }).toUpperCase()}`
      : 'AWAITING FIRST TIER TESTS';
    renderQueues();
    error.hidden = true;
    render();
  } catch (reason) {
    error.hidden = false;
    error.textContent = reason.message;
  }
}

search.addEventListener('input', render);
modeSelect.addEventListener('change', render);
document.querySelector('#board-view').addEventListener('click', () => setView('board'));
document.querySelector('#list-view').addEventListener('click', () => setView('list'));
load();
window.setInterval(load, 10000);
