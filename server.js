import 'dotenv/config';
import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import QRCode from 'qrcode';
import * as db from './db.js';
import * as sms from './sms.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Helper to get base URL from request
function getBaseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

// ============ SMS TEST ENDPOINT ============
app.get('/test-sms', (req, res) => {
  res.send(renderPage('Test SMS', `
    <h1>Test SMS Integration</h1>
    <div class="card">
      <form action="/test-sms" method="POST">
        <input type="tel" name="phone" placeholder="Phone number (e.g., 0412345678)" required>
        <input type="text" name="message" placeholder="Test message" value="Hello from Assassin Game!">
        <button type="submit">Send Test SMS</button>
      </form>
    </div>
    <div class="card">
      <h2>Environment Check</h2>
      <p>CLICKSEND_USERNAME: ${process.env.CLICKSEND_USERNAME ? '✅ Set' : '❌ Not set'}</p>
      <p>CLICKSEND_API_KEY: ${process.env.CLICKSEND_API_KEY ? '✅ Set' : '❌ Not set'}</p>
      <p>CLICKSEND_FROM: ${process.env.CLICKSEND_FROM || '(using default)'}</p>
    </div>
    <p class="small">Check server console for detailed logs after sending.</p>
  `));
});

app.post('/test-sms', async (req, res) => {
  const { phone, message } = req.body;
  
  console.log('\n========== SMS TEST ==========');
  const result = await sms.sendTestSMS(phone, message);
  console.log('========== END SMS TEST ==========\n');
  
  res.send(renderPage('Test SMS Result', `
    <h1>SMS Test Result</h1>
    <div class="card">
      <p>Phone: ${phone}</p>
      <p>Message: ${message}</p>
      <p>Result: ${result ? '✅ Sent (or logged)' : '❌ Failed'}</p>
    </div>
    <p>Check the server console for detailed logs.</p>
    <a href="/test-sms" class="btn">Try Again</a>
  `));
});

// ============ HOME PAGE ============
app.get('/', (req, res) => {
  res.send(renderPage('Assassin Game', `
    <h1>Assassin Game</h1>
    <p>A party game of stealth and deception</p>

    <div class="card">
      <h2>Create New Game</h2>
      <form action="/create-game" method="POST">
        <input type="text" name="name" placeholder="Game name (e.g., Birthday Party)" required>
        <textarea name="tasks" placeholder="Tasks (one per line)&#10;e.g., Touch their shoulder and say 'You're dead!'&#10;Get them to high-five you&#10;Take a selfie with them" rows="5"></textarea>
        <button type="submit">Create Game</button>
      </form>
    </div>
  `));
});

// ============ CREATE GAME ============
app.post('/create-game', (req, res) => {
  const { name, tasks } = req.body;
  const game = db.createGame(name, null); // No longer using single objective
  
  // Parse tasks from textarea (one per line)
  if (tasks) {
    const taskLines = tasks.split('\n')
      .map(t => t.trim())
      .filter(t => t.length > 0);
    
    for (const taskDescription of taskLines) {
      db.addTask(game.id, taskDescription);
    }
  }
  
  res.redirect(`/admin/${game.adminToken}`);
});

// ============ JOIN FLOW ============
app.get('/join/:gameId', (req, res) => {
  const game = db.getGameById(req.params.gameId);

  if (!game) {
    return res.status(404).send(renderPage('Not Found', '<h1>Game not found</h1><p><a href="/">Go home</a></p>'));
  }

  if (game.status !== 'waiting') {
    return res.send(renderPage('Game Started', `
      <h1>${game.name}</h1>
      <p>This game has already started. You can no longer join.</p>
    `));
  }

  res.send(renderPage(`Join ${game.name}`, `
    <h1>Join ${game.name}</h1>

    <div class="card">
      <form action="/join/${game.id}" method="POST">
        <input type="text" name="name" placeholder="Your name" required>
        <input type="tel" name="phone" placeholder="Phone number" required>
        <button type="submit">Join Game</button>
      </form>
    </div>
  `));
});

app.post('/join/:gameId', (req, res) => {
  const game = db.getGameById(req.params.gameId);

  if (!game || game.status !== 'waiting') {
    return res.status(400).send(renderPage('Error', '<h1>Cannot join this game</h1>'));
  }

  const { name, phone } = req.body;
  const player = db.addPlayer(game.id, name, phone);

  res.send(renderPage('Joined!', `
    <h1>You're in!</h1>
    <p>Welcome, ${name}! You've joined <strong>${game.name}</strong>.</p>
    <p>Wait for the game to start. You'll receive a text with your target!</p>
    <p class="small">Bookmark this link to check your status:</p>
    <a href="/play/${player.token}" class="btn">/play/${player.token}</a>
  `));
});

// ============ ADMIN PORTAL ============
app.get('/admin/:token', async (req, res) => {
  const game = db.getGameByAdminToken(req.params.token);

  if (!game) {
    return res.status(404).send(renderPage('Not Found', '<h1>Game not found</h1>'));
  }

  const players = db.getPlayersByGame(game.id);
  const pendingKills = db.getPendingKillRequests(game.id);
  const leaderboard = db.getLeaderboard(game.id);
  const tasks = db.getTasksByGame(game.id);
  const baseUrl = getBaseUrl(req);
  const joinUrl = `${baseUrl}/join/${game.id}`;

  // Generate QR code
  let qrCodeDataUrl = '';
  try {
    qrCodeDataUrl = await QRCode.toDataURL(joinUrl, { width: 200 });
  } catch (err) {
    console.error('QR code error:', err);
  }

  const statusBadge = game.status === 'waiting' ? '<span class="badge waiting">Waiting</span>' :
                      game.status === 'active' ? '<span class="badge active">Active</span>' :
                      '<span class="badge finished">Finished</span>';

  res.send(renderPage(`Admin: ${game.name}`, `
    <h1>${game.name} ${statusBadge}</h1>
    ${tasks.length > 0 ? `
      <div class="card">
        <h2>Tasks (${tasks.length})</h2>
        <ul class="task-list">
          ${tasks.map(t => `<li>${t.description}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    <div class="card">
      <h2>Join Link</h2>
      <p><a href="${joinUrl}">${joinUrl}</a></p>
      ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" class="qr-code">` : ''}
    </div>

    <div class="card">
      <h2>Players (${players.length})</h2>
      ${players.length === 0 ? '<p>No players yet</p>' : `
        <ul class="player-list">
          ${players.map(p => `
            <li class="${p.is_alive ? '' : 'dead'}">
              ${p.name} ${p.is_alive ? '' : '(eliminated)'}
              <span class="phone">${p.phone}</span>
            </li>
          `).join('')}
        </ul>
      `}
    </div>

    ${game.status === 'waiting' ? `
      <div class="card">
        <h2>Start Game</h2>
        ${players.length < 2 ? '<p>Need at least 2 players to start</p>' : `
          <form action="/admin/${game.admin_token}/start" method="POST">
            <button type="submit" class="btn-start">Start Game (${players.length} players)</button>
          </form>
        `}
      </div>
    ` : ''}

    ${pendingKills.length > 0 ? `
      <div class="card">
        <h2>Pending Kill Requests</h2>
        <ul class="kill-list">
          ${pendingKills.map(kr => `
            <li>
              <strong>${kr.killer_name}</strong> claims to have killed <strong>${kr.victim_name}</strong>
              <div class="actions">
                <form action="/admin/${game.admin_token}/approve/${kr.id}" method="POST" style="display:inline">
                  <button type="submit" class="btn-small btn-approve">Approve</button>
                </form>
                <form action="/admin/${game.admin_token}/reject/${kr.id}" method="POST" style="display:inline">
                  <button type="submit" class="btn-small btn-reject">Reject</button>
                </form>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''}

    ${game.status !== 'waiting' ? `
      <div class="card">
        <h2>Leaderboard</h2>
        <table class="leaderboard">
          <tr><th>#</th><th>Name</th><th>Kills</th><th>Status</th></tr>
          ${leaderboard.map((p, i) => `
            <tr class="${p.is_alive ? '' : 'dead'}">
              <td>${i + 1}</td>
              <td>${p.name}</td>
              <td>${p.kills}</td>
              <td>${p.is_alive ? 'Alive' : 'Eliminated'}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : ''}

    <p class="small">Bookmark this admin link - it's your only way back!</p>
  `));
});

app.post('/admin/:token/start', async (req, res) => {
  const game = db.getGameByAdminToken(req.params.token);

  if (!game || game.status !== 'waiting') {
    return res.status(400).send(renderPage('Error', '<h1>Cannot start this game</h1>'));
  }

  const players = db.getPlayersByGame(game.id);
  if (players.length < 2) {
    return res.status(400).send(renderPage('Error', '<h1>Need at least 2 players</h1>'));
  }

  // Assign circular targets (also assigns random tasks)
  db.assignTargets(game.id);
  db.updateGameStatus(game.id, 'active');

  // Send SMS to all players
  const updatedPlayers = db.getPlayersByGame(game.id);

  for (const player of updatedPlayers) {
    const target = db.getPlayerById(player.target_id);
    const playerTask = db.getPlayerTask(player.id);
    await sms.sendGameStartMessage(player, target, playerTask?.description);
  }

  res.redirect(`/admin/${game.admin_token}`);
});

app.post('/admin/:token/approve/:killId', async (req, res) => {
  const game = db.getGameByAdminToken(req.params.token);
  if (!game) return res.status(404).send('Not found');

  const result = db.processKill(parseInt(req.params.killId));

  if (result) {
    await sms.sendEliminatedMessage(result.victim, result.killer.name);

    if (result.newTarget) {
      await sms.sendNewTargetMessage(result.killer, result.newTarget, result.newTask?.description);
    } else {
      // Game over - this killer won
      await sms.sendWinnerMessage(result.killer);
    }
  }

  res.redirect(`/admin/${game.admin_token}`);
});

app.post('/admin/:token/reject/:killId', (req, res) => {
  const game = db.getGameByAdminToken(req.params.token);
  if (!game) return res.status(404).send('Not found');

  db.updateKillRequestStatus(parseInt(req.params.killId), 'rejected');
  res.redirect(`/admin/${game.admin_token}`);
});

// ============ PLAYER PAGE ============
app.get('/play/:token', (req, res) => {
  const player = db.getPlayerByToken(req.params.token);

  if (!player) {
    return res.status(404).send(renderPage('Not Found', '<h1>Player not found</h1>'));
  }

  const game = db.getGameById(player.game_id);
  const pendingKillAgainst = db.getPendingKillAgainstPlayer(player.id);
  const alivePlayers = db.getAlivePlayers(game.id);

  let content = `<h1>${game.name}</h1>`;

  if (game.status === 'waiting') {
    content += `
      <div class="card">
        <h2>Waiting for game to start...</h2>
        <p>You're in, ${player.name}! The game master will start the game soon.</p>
        <p>You'll receive a text when it begins.</p>
      </div>
    `;
  } else if (game.status === 'finished') {
    const winner = alivePlayers[0];
    content += `
      <div class="card">
        <h2>Game Over!</h2>
        <p>${winner.id === player.id ? "YOU WON!" : `${winner.name} won!`}</p>
        <p>Your final kills: ${player.kills}</p>
      </div>
    `;
  } else if (!player.is_alive) {
    content += `
      <div class="card dead-card">
        <h2>You're Out!</h2>
        <p>You've been eliminated from the game.</p>
        <p>Final kills: ${player.kills}</p>
      </div>
    `;
  } else {
    const target = db.getPlayerById(player.target_id);
    const playerTask = db.getPlayerTask(player.id);

    content += `
      <div class="card target-card">
        <h2>Your Target</h2>
        <p class="target-name">${target ? target.name : 'No target'}</p>
        ${playerTask ? `<p class="objective">Task: ${playerTask.description}</p>` : ''}
      </div>

      <div class="card">
        <h2>Got Them?</h2>
        <form action="/play/${player.token}/kill" method="POST">
          <button type="submit" class="btn-kill">I Got Them!</button>
        </form>
      </div>
    `;

    if (pendingKillAgainst) {
      content += `
        <div class="card warning-card">
          <h2>Confirm Your Death</h2>
          <p><strong>${pendingKillAgainst.killer_name}</strong> claims they got you!</p>
          <form action="/play/${player.token}/confirm-death/${pendingKillAgainst.id}" method="POST">
            <button type="submit" class="btn-confirm-death">Yes, They Got Me</button>
          </form>
        </div>
      `;
    }

    content += `
      <div class="stats">
        <p>Your kills: ${player.kills}</p>
        <p>Players remaining: ${alivePlayers.length}</p>
      </div>
    `;
  }

  res.send(renderPage(player.name, content));
});

app.post('/play/:token/kill', async (req, res) => {
  const player = db.getPlayerByToken(req.params.token);

  if (!player || !player.is_alive || !player.target_id) {
    return res.status(400).send(renderPage('Error', '<h1>Cannot submit kill</h1>'));
  }

  const victim = db.getPlayerById(player.target_id);
  const game = db.getGameById(player.game_id);

  if (game.status !== 'active') {
    return res.status(400).send(renderPage('Error', '<h1>Game is not active</h1>'));
  }

  db.createKillRequest(player.id, victim.id);

  // Notify victim
  await sms.sendKillRequestNotification(victim, player.name);

  res.send(renderPage('Kill Submitted', `
    <h1>Kill Request Submitted!</h1>
    <p>Waiting for ${victim.name} to confirm or admin to approve.</p>
    <a href="/play/${player.token}" class="btn">Back to Game</a>
  `));
});

app.post('/play/:token/confirm-death/:killId', async (req, res) => {
  const player = db.getPlayerByToken(req.params.token);
  const killRequest = db.getKillRequestById(parseInt(req.params.killId));

  if (!player || !killRequest || killRequest.victim_id !== player.id || killRequest.status !== 'pending') {
    return res.status(400).send(renderPage('Error', '<h1>Invalid request</h1>'));
  }

  const result = db.processKill(killRequest.id);

  if (result) {
    await sms.sendEliminatedMessage(result.victim, result.killer.name);

    if (result.newTarget) {
      await sms.sendNewTargetMessage(result.killer, result.newTarget, result.newTask?.description);
    } else {
      await sms.sendWinnerMessage(result.killer);
    }
  }

  res.redirect(`/play/${player.token}`);
});

// ============ HTML TEMPLATE ============
function renderPage(title, content) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | Assassin</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #1a1a2e;
      color: #eee;
      min-height: 100vh;
      padding: 20px;
    }
    h1 { margin-bottom: 10px; color: #e94560; }
    h2 { margin-bottom: 15px; color: #fff; font-size: 1.2em; }
    p { margin-bottom: 10px; line-height: 1.5; }
    a { color: #e94560; }
    .card {
      background: #16213e;
      padding: 20px;
      border-radius: 10px;
      margin: 20px 0;
      border: 1px solid #0f3460;
    }
    input, textarea {
      width: 100%;
      padding: 12px;
      margin-bottom: 10px;
      border: 1px solid #0f3460;
      border-radius: 5px;
      background: #1a1a2e;
      color: #fff;
      font-size: 16px;
    }
    button, .btn {
      display: inline-block;
      padding: 12px 24px;
      background: #e94560;
      color: #fff;
      border: none;
      border-radius: 5px;
      font-size: 16px;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
    }
    button:hover, .btn:hover { background: #ff6b6b; }
    .btn-start { background: #4caf50; width: 100%; }
    .btn-start:hover { background: #66bb6a; }
    .btn-kill { background: #e94560; width: 100%; font-size: 1.2em; padding: 15px; }
    .btn-confirm-death { background: #ff9800; width: 100%; }
    .btn-small { padding: 8px 16px; font-size: 14px; margin: 5px; }
    .btn-approve { background: #4caf50; }
    .btn-reject { background: #f44336; }
    .objective {
      background: #0f3460;
      padding: 10px;
      border-radius: 5px;
      font-style: italic;
      margin: 10px 0;
    }
    .target-name {
      font-size: 2em;
      color: #e94560;
      text-align: center;
      padding: 20px;
    }
    .target-card { border: 2px solid #e94560; }
    .warning-card { border: 2px solid #ff9800; background: #2d2200; }
    .dead-card { opacity: 0.7; }
    .player-list { list-style: none; }
    .player-list li {
      padding: 10px;
      border-bottom: 1px solid #0f3460;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .player-list li.dead { opacity: 0.5; text-decoration: line-through; }
    .phone { color: #888; font-size: 0.9em; }
    .kill-list { list-style: none; }
    .kill-list li {
      padding: 15px;
      border-bottom: 1px solid #0f3460;
    }
    .kill-list .actions { margin-top: 10px; }
    .task-list { list-style: decimal; margin-left: 20px; }
    .task-list li {
      padding: 8px 0;
      border-bottom: 1px solid #0f3460;
    }
    .task-list li:last-child { border-bottom: none; }
    .leaderboard { width: 100%; border-collapse: collapse; }
    .leaderboard th, .leaderboard td {
      padding: 10px;
      text-align: left;
      border-bottom: 1px solid #0f3460;
    }
    .leaderboard tr.dead { opacity: 0.5; }
    .badge {
      display: inline-block;
      padding: 4px 12px;
      border-radius: 20px;
      font-size: 0.8em;
      vertical-align: middle;
    }
    .badge.waiting { background: #ff9800; }
    .badge.active { background: #4caf50; }
    .badge.finished { background: #9e9e9e; }
    .stats {
      text-align: center;
      margin-top: 20px;
      color: #888;
    }
    .qr-code {
      display: block;
      margin: 10px auto;
      background: #fff;
      padding: 10px;
      border-radius: 5px;
    }
    .small { font-size: 0.85em; color: #888; margin-top: 20px; }
    @media (max-width: 600px) {
      body { padding: 10px; }
      .card { padding: 15px; }
    }
  </style>
</head>
<body>
  <main>${content}</main>
</body>
</html>`;
}

app.listen(PORT, () => {
  console.log(`Assassin game running at http://localhost:${PORT}`);
});
