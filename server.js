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
    <h1>TEST SMS</h1>
    <div class="card">
      <form action="/test-sms" method="POST">
        <input type="tel" name="phone" placeholder="Phone (e.g., 0412345678)" required>
        <input type="text" name="message" placeholder="Message" value="Hello from Assassin!">
        <button type="submit">SEND TEST</button>
      </form>
    </div>
    <div class="card">
      <h2>CONFIG</h2>
      <p>${process.env.CLICKSEND_USERNAME ? '✅' : '❌'} CLICKSEND_USERNAME</p>
      <p>${process.env.CLICKSEND_API_KEY ? '✅' : '❌'} CLICKSEND_API_KEY</p>
      <p>📤 FROM: ${process.env.CLICKSEND_FROM || '(default)'}</p>
    </div>
  `));
});

app.post('/test-sms', async (req, res) => {
  const { phone, message } = req.body;
  
  console.log('\n========== SMS TEST ==========');
  const result = await sms.sendTestSMS(phone, message);
  console.log('========== END SMS TEST ==========\n');
  
  res.send(renderPage('Test SMS Result', `
    <h1>${result ? 'SENT!' : 'FAILED'}</h1>
    <div class="card" style="text-align: center;">
      <p style="font-size: 3rem; margin-bottom: 16px;">${result ? '✅' : '❌'}</p>
      <p><strong>To:</strong> ${phone}</p>
      <p><strong>Message:</strong> ${message}</p>
    </div>
    <a href="/test-sms" class="btn">TRY AGAIN</a>
  `));
});

// ============ HOME PAGE ============
app.get('/', (req, res) => {
  res.send(renderPage('Assassin Game', `
    <h1>ASSASSIN</h1>
    <p class="subtitle">Hunt. Eliminate. Survive.</p>

    <div class="card">
      <h2>NEW GAME</h2>
      <form action="/create-game" method="POST">
        <input type="text" name="name" placeholder="Party name" required autocomplete="off">
        <textarea name="tasks" placeholder="Kill tasks (one per line)&#10;&#10;e.g., High-five them&#10;Take a selfie together&#10;Get them to say 'banana'" rows="5"></textarea>
        <button type="submit">CREATE GAME</button>
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
    return res.status(404).send(renderPage('Not Found', `
      <h1>OOPS</h1>
      <div class="card" style="text-align: center;">
        <p style="font-size: 3rem; margin-bottom: 16px;">🤷</p>
        <p>Game not found</p>
        <a href="/" class="btn" style="margin-top: 16px;">GO HOME</a>
      </div>
    `));
  }

  if (game.status !== 'waiting') {
    return res.send(renderPage('Game Started', `
      <h1>TOO LATE</h1>
      <div class="card" style="text-align: center;">
        <p style="font-size: 3rem; margin-bottom: 16px;">😬</p>
        <p>This game already started!</p>
      </div>
    `));
  }

  res.send(renderPage(`Join ${game.name}`, `
    <h1>JOIN THE HUNT</h1>
    <p class="subtitle">${game.name}</p>

    <div class="card">
      <form action="/join/${game.id}" method="POST">
        <input type="text" name="name" placeholder="Your name" required autocomplete="off" autofocus>
        <input type="tel" name="phone" placeholder="Phone number" required autocomplete="tel">
        <button type="submit">I'M IN</button>
      </form>
    </div>
  `));
});

app.post('/join/:gameId', (req, res) => {
  const game = db.getGameById(req.params.gameId);

  if (!game || game.status !== 'waiting') {
    return res.status(400).send(renderPage('Error', `
      <h1>NOPE</h1>
      <div class="card" style="text-align: center;">
        <p>Can't join this game</p>
      </div>
    `));
  }

  const { name, phone } = req.body;
  const player = db.addPlayer(game.id, name, phone);

  res.send(renderPage('Joined!', `
    <h1>YOU'RE IN!</h1>
    <div class="card" style="text-align: center;">
      <p class="success-icon">🎯</p>
      <p style="font-size: 1.4rem; color: #fff; margin-bottom: 8px;">Welcome, <strong>${name}</strong></p>
      <p>Wait for game to start.<br>You'll get a text with your target!</p>
    </div>
    <a href="/play/${player.token}" class="btn">GET STARTED</a>
    <p class="small">Bookmark that link ☝️</p>
  `));
});

// ============ ADMIN PORTAL ============
app.get('/admin/:token', async (req, res) => {
  const game = db.getGameByAdminToken(req.params.token);

  if (!game) {
    return res.status(404).send(renderPage('Not Found', `
      <h1>NOPE</h1>
      <div class="card" style="text-align: center;">
        <p>Game not found</p>
      </div>
    `));
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
    qrCodeDataUrl = await QRCode.toDataURL(joinUrl, { width: 240 });
  } catch (err) {
    console.error('QR code error:', err);
  }

  const statusBadge = game.status === 'waiting' ? '<span class="badge waiting">WAITING</span>' :
                      game.status === 'active' ? '<span class="badge active">LIVE</span>' :
                      '<span class="badge finished">DONE</span>';

  res.send(renderPage(`Admin: ${game.name}`, `
    <h1>${game.name.toUpperCase()}</h1>
    <p class="subtitle">${statusBadge}</p>

    ${pendingKills.length > 0 ? `
      <div class="card warning-card">
        <h2>⚠️ PENDING KILLS</h2>
        <ul class="kill-list">
          ${pendingKills.map(kr => `
            <li>
              <p style="color: #fff; font-size: 1.1rem; margin: 0;">
                <strong>${kr.killer_name}</strong> → <strong>${kr.victim_name}</strong>
              </p>
              <div class="actions">
                <form action="/admin/${game.admin_token}/approve/${kr.id}" method="POST" style="display:inline">
                  <button type="submit" class="btn-small btn-approve">✓ YES</button>
                </form>
                <form action="/admin/${game.admin_token}/reject/${kr.id}" method="POST" style="display:inline">
                  <button type="submit" class="btn-small btn-reject">✗ NO</button>
                </form>
              </div>
            </li>
          `).join('')}
        </ul>
      </div>
    ` : ''}

    ${game.status === 'waiting' ? `
      <div class="card" style="text-align: center;">
        <h2>JOIN QR</h2>
        ${qrCodeDataUrl ? `<img src="${qrCodeDataUrl}" alt="QR Code" class="qr-code">` : ''}
        <p style="word-break: break-all; font-size: 0.9rem;"><a href="${joinUrl}">${joinUrl}</a></p>
      </div>
    ` : ''}

    <div class="card">
      <h2>PLAYERS ${players.length > 0 ? `(${players.length})` : ''}</h2>
      ${players.length === 0 ? '<p style="text-align: center;">No players yet 😴</p>' : `
        <ul class="player-list">
          ${players.map(p => `
            <li class="${p.is_alive ? '' : 'dead'}">
              <span>${p.name}</span>
              <span class="phone">${p.phone}</span>
            </li>
          `).join('')}
        </ul>
      `}
    </div>

    ${game.status === 'waiting' ? `
      ${players.length < 2 ? `
        <button disabled style="opacity: 0.5; cursor: not-allowed;">NEED 2+ PLAYERS</button>
      ` : `
        <form action="/admin/${game.admin_token}/start" method="POST">
          <button type="submit" class="btn-start">🚀 START GAME</button>
        </form>
      `}
    ` : ''}

    ${game.status !== 'waiting' ? `
      <div class="card">
        <h2>🏆 LEADERBOARD</h2>
        <table class="leaderboard">
          <tr><th>#</th><th>PLAYER</th><th>KILLS</th><th></th></tr>
          ${leaderboard.map((p, i) => `
            <tr class="${p.is_alive ? '' : 'dead'}">
              <td>${i + 1}</td>
              <td>${p.name}</td>
              <td>${p.kills}</td>
              <td>${p.is_alive ? '🟢' : '💀'}</td>
            </tr>
          `).join('')}
        </table>
      </div>
    ` : ''}

    ${tasks.length > 0 ? `
      <div class="card">
        <h2>TASKS</h2>
        <ul class="task-list">
          ${tasks.map(t => `<li>${t.description}</li>`).join('')}
        </ul>
      </div>
    ` : ''}

    <p class="small">🔖 Bookmark this page!</p>
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
    return res.status(404).send(renderPage('Not Found', `
      <h1>WHO?</h1>
      <div class="card" style="text-align: center;">
        <p style="font-size: 3rem; margin-bottom: 16px;">🤔</p>
        <p>Player not found</p>
      </div>
    `));
  }

  const game = db.getGameById(player.game_id);
  const pendingKillAgainst = db.getPendingKillAgainstPlayer(player.id);
  const alivePlayers = db.getAlivePlayers(game.id);

  let content = '';

  if (game.status === 'waiting') {
    content = `
      <h1>WAITING<span class="waiting-dots"></span></h1>
      <div class="card" style="text-align: center;">
        <p style="font-size: 3rem; margin-bottom: 16px;">⏳</p>
        <p style="font-size: 1.3rem; color: #fff;">Hey ${player.name}!</p>
        <p>Game starts soon.<br>You'll get a text!</p>
      </div>
    `;
  } else if (game.status === 'finished') {
    const winner = alivePlayers[0];
    const isWinner = winner && winner.id === player.id;
    content = `
      <h1>${isWinner ? 'YOU WON!' : 'GAME OVER'}</h1>
      <div class="card" style="text-align: center;">
        <p style="font-size: 4rem; margin-bottom: 16px;">${isWinner ? '👑' : '🏁'}</p>
        ${!isWinner && winner ? `<p style="font-size: 1.3rem; color: #fff;">${winner.name} wins!</p>` : ''}
        <p>Your kills: <strong style="color: var(--accent); font-size: 1.5rem;">${player.kills}</strong></p>
      </div>
    `;
  } else if (!player.is_alive) {
    content = `
      <h1>YOU'RE DEAD</h1>
      <div class="card dead-card" style="text-align: center;">
        <p style="font-size: 4rem; margin-bottom: 16px;">💀</p>
        <p style="font-size: 1.2rem;">Better luck next time</p>
        <p>Your kills: <strong style="color: var(--accent); font-size: 1.5rem;">${player.kills}</strong></p>
      </div>
    `;
  } else {
    const target = db.getPlayerById(player.target_id);
    const playerTask = db.getPlayerTask(player.id);

    // Warning card at top if someone claims to have killed them
    if (pendingKillAgainst) {
      content += `
        <div class="card warning-card" style="text-align: center;">
          <p style="font-size: 2.5rem; margin-bottom: 12px;">⚠️</p>
          <h2>DID THEY GET YOU?</h2>
          <p style="font-size: 1.3rem; color: #fff; margin-bottom: 16px;">${pendingKillAgainst.killer_name} says they killed you!</p>
          <form action="/play/${player.token}/confirm-death/${pendingKillAgainst.id}" method="POST">
            <button type="submit" class="btn-confirm-death">YEAH, I'M DEAD 💀</button>
          </form>
          <p style="font-size: 0.85rem; color: #aaa; margin-top: 16px;">Disagree? Speak to the game admin to resolve any disputes.</p>
        </div>
      `;
    }

    content += `
      <h1>YOUR TARGET</h1>
      <div class="card target-card">
        <p class="target-name">${target ? target.name : '???'}</p>
        ${playerTask ? `<div class="objective"><strong>TASK:</strong> ${playerTask.description}</div>` : ''}
      </div>

      <form action="/play/${player.token}/kill" method="POST">
        <button type="submit" class="btn btn-kill">GOT THEM! 🎯</button>
      </form>

      <div class="stats">
        <p><strong>${player.kills}</strong>Kills</p>
        <p><strong>${alivePlayers.length}</strong>Alive</p>
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
    <h1>PENDING...</h1>
    <div class="card" style="text-align: center;">
      <p style="font-size: 3rem; margin-bottom: 16px;">⏳</p>
      <p style="font-size: 1.2rem; color: #fff;">Waiting for <strong>${victim.name}</strong> to confirm</p>
    </div>
    <a href="/play/${player.token}" class="btn">BACK TO GAME</a>
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
  <meta name="viewport" content="width=device-width, initial-scale=1.0, user-scalable=no">
  <title>${title} | Assassin</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Outfit:wght@400;600;800&display=swap" rel="stylesheet">
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    
    :root {
      --bg-dark: #0d0d0d;
      --bg-card: #1a1a1a;
      --accent: #ff2d55;
      --accent-glow: rgba(255, 45, 85, 0.4);
      --success: #30d158;
      --warning: #ff9f0a;
      --text: #ffffff;
      --text-dim: #8e8e93;
      --border: #2c2c2e;
    }
    
    body {
      font-family: 'Outfit', -apple-system, sans-serif;
      background: var(--bg-dark);
      color: var(--text);
      min-height: 100vh;
      min-height: 100dvh;
      padding: 16px;
      padding-bottom: 40px;
      background-image: 
        radial-gradient(ellipse at top, rgba(255, 45, 85, 0.15) 0%, transparent 50%),
        radial-gradient(ellipse at bottom right, rgba(255, 159, 10, 0.1) 0%, transparent 40%);
    }
    
    main {
      max-width: 420px;
      margin: 0 auto;
    }
    
    /* Typography */
    h1 {
      font-family: 'Bebas Neue', Impact, sans-serif;
      font-size: 3rem;
      letter-spacing: 2px;
      text-align: center;
      margin-bottom: 8px;
      background: linear-gradient(135deg, #ff2d55, #ff6b8a);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      background-clip: text;
      text-shadow: 0 0 60px var(--accent-glow);
    }
    
    h2 {
      font-family: 'Bebas Neue', Impact, sans-serif;
      font-size: 1.5rem;
      letter-spacing: 1px;
      color: var(--text);
      margin-bottom: 16px;
    }
    
    p {
      font-size: 1.1rem;
      line-height: 1.5;
      margin-bottom: 12px;
      color: var(--text-dim);
    }
    
    p.subtitle {
      text-align: center;
      font-size: 1rem;
      margin-bottom: 24px;
    }
    
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }
    
    /* Cards */
    .card {
      background: var(--bg-card);
      padding: 24px;
      border-radius: 20px;
      margin: 16px 0;
      border: 1px solid var(--border);
      backdrop-filter: blur(10px);
    }
    
    /* Forms */
    input, textarea {
      width: 100%;
      padding: 18px 20px;
      margin-bottom: 12px;
      border: 2px solid var(--border);
      border-radius: 14px;
      background: var(--bg-dark);
      color: var(--text);
      font-family: 'Outfit', sans-serif;
      font-size: 1.1rem;
      transition: border-color 0.2s, box-shadow 0.2s;
    }
    
    input:focus, textarea:focus {
      outline: none;
      border-color: var(--accent);
      box-shadow: 0 0 0 4px var(--accent-glow);
    }
    
    input::placeholder, textarea::placeholder {
      color: var(--text-dim);
    }
    
    /* Buttons */
    button, .btn {
      display: block;
      width: 100%;
      padding: 20px 32px;
      background: linear-gradient(135deg, var(--accent), #ff6b8a);
      color: white;
      border: none;
      border-radius: 16px;
      font-family: 'Bebas Neue', Impact, sans-serif;
      font-size: 1.5rem;
      letter-spacing: 2px;
      cursor: pointer;
      text-decoration: none;
      text-align: center;
      transition: transform 0.15s, box-shadow 0.15s;
      box-shadow: 0 4px 20px var(--accent-glow);
      -webkit-tap-highlight-color: transparent;
    }
    
    button:hover, .btn:hover {
      transform: translateY(-2px);
      box-shadow: 0 8px 30px var(--accent-glow);
    }
    
    button:active, .btn:active {
      transform: scale(0.98);
    }
    
    .btn-start {
      background: linear-gradient(135deg, var(--success), #4ade80);
      box-shadow: 0 4px 20px rgba(48, 209, 88, 0.4);
    }
    
    .btn-kill {
      font-size: 2rem;
      padding: 28px;
      animation: pulse 2s infinite;
    }
    
    @keyframes pulse {
      0%, 100% { box-shadow: 0 4px 20px var(--accent-glow); }
      50% { box-shadow: 0 4px 40px var(--accent-glow), 0 0 60px var(--accent-glow); }
    }
    
    .btn-confirm-death {
      background: linear-gradient(135deg, var(--warning), #ffc107);
      box-shadow: 0 4px 20px rgba(255, 159, 10, 0.4);
    }
    
    .btn-small {
      display: inline-block;
      width: auto;
      padding: 14px 24px;
      font-size: 1.1rem;
      margin: 6px;
      border-radius: 12px;
    }
    
    .btn-approve {
      background: linear-gradient(135deg, var(--success), #4ade80);
      box-shadow: 0 4px 15px rgba(48, 209, 88, 0.4);
    }
    
    .btn-reject {
      background: linear-gradient(135deg, #ff3b30, #ff6b6b);
      box-shadow: 0 4px 15px rgba(255, 59, 48, 0.4);
    }
    
    /* Target Display */
    .target-card {
      border: 2px solid var(--accent);
      background: linear-gradient(180deg, rgba(255, 45, 85, 0.1) 0%, var(--bg-card) 100%);
      text-align: center;
    }
    
    .target-name {
      font-family: 'Bebas Neue', Impact, sans-serif;
      font-size: 3.5rem;
      letter-spacing: 3px;
      color: var(--text);
      padding: 20px 0;
      text-shadow: 0 0 40px var(--accent-glow);
    }
    
    .objective {
      background: rgba(255, 255, 255, 0.05);
      padding: 16px;
      border-radius: 12px;
      margin-top: 16px;
      font-size: 1rem;
      color: var(--text);
      border-left: 4px solid var(--warning);
    }
    
    /* Warning Card */
    .warning-card {
      border: 2px solid var(--warning);
      background: linear-gradient(180deg, rgba(255, 159, 10, 0.15) 0%, var(--bg-card) 100%);
      animation: shake 0.5s ease-in-out;
    }
    
    @keyframes shake {
      0%, 100% { transform: translateX(0); }
      25% { transform: translateX(-5px); }
      75% { transform: translateX(5px); }
    }
    
    /* Dead State */
    .dead-card {
      opacity: 0.6;
      filter: grayscale(0.5);
    }
    
    /* Lists */
    .player-list { list-style: none; }
    .player-list li {
      padding: 14px 0;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      font-size: 1.1rem;
    }
    .player-list li:last-child { border-bottom: none; }
    .player-list li.dead { 
      opacity: 0.4; 
      text-decoration: line-through;
    }
    .phone { 
      color: var(--text-dim); 
      font-size: 0.9rem;
      font-family: monospace;
    }
    
    .kill-list { list-style: none; }
    .kill-list li {
      padding: 20px 0;
      border-bottom: 1px solid var(--border);
    }
    .kill-list li:last-child { border-bottom: none; }
    .kill-list .actions { 
      margin-top: 16px;
      display: flex;
      gap: 8px;
    }
    
    .task-list { 
      list-style: none;
      counter-reset: task;
    }
    .task-list li {
      padding: 12px 0;
      border-bottom: 1px solid var(--border);
      counter-increment: task;
      display: flex;
      align-items: flex-start;
      gap: 12px;
      font-size: 1rem;
    }
    .task-list li::before {
      content: counter(task);
      background: var(--accent);
      color: white;
      width: 28px;
      height: 28px;
      border-radius: 50%;
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 600;
      flex-shrink: 0;
      font-size: 0.9rem;
    }
    .task-list li:last-child { border-bottom: none; }
    
    /* Leaderboard */
    .leaderboard { 
      width: 100%; 
      border-collapse: collapse;
    }
    .leaderboard th {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 1rem;
      letter-spacing: 1px;
      color: var(--text-dim);
      text-align: left;
      padding: 12px 8px;
      border-bottom: 2px solid var(--border);
    }
    .leaderboard td {
      padding: 14px 8px;
      border-bottom: 1px solid var(--border);
      font-size: 1.1rem;
    }
    .leaderboard tr.dead { opacity: 0.4; }
    .leaderboard td:first-child {
      font-family: 'Bebas Neue', sans-serif;
      font-size: 1.3rem;
      color: var(--warning);
    }
    
    /* Badges */
    .badge {
      display: inline-block;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 1px;
      text-transform: uppercase;
      vertical-align: middle;
    }
    .badge.waiting { background: var(--warning); color: #000; }
    .badge.active { background: var(--success); color: #000; }
    .badge.finished { background: var(--text-dim); }
    
    /* Stats */
    .stats {
      text-align: center;
      margin-top: 24px;
      padding: 20px;
      background: var(--bg-card);
      border-radius: 16px;
      display: flex;
      justify-content: space-around;
    }
    .stats p {
      margin: 0;
      color: var(--text);
    }
    .stats strong {
      display: block;
      font-family: 'Bebas Neue', sans-serif;
      font-size: 2rem;
      color: var(--accent);
    }
    
    /* QR Code */
    .qr-code {
      display: block;
      margin: 16px auto;
      background: #fff;
      padding: 16px;
      border-radius: 16px;
      max-width: 220px;
    }
    
    /* Helper text */
    .small { 
      font-size: 0.9rem; 
      color: var(--text-dim); 
      margin-top: 20px;
      text-align: center;
    }
    
    /* Success/joined state */
    .success-icon {
      font-size: 4rem;
      text-align: center;
      margin-bottom: 16px;
    }
    
    /* Waiting animation */
    .waiting-dots::after {
      content: '';
      animation: dots 1.5s steps(4, end) infinite;
    }
    @keyframes dots {
      0%, 20% { content: ''; }
      40% { content: '.'; }
      60% { content: '..'; }
      80%, 100% { content: '...'; }
    }
    
    /* Mobile optimizations */
    @media (max-width: 480px) {
      body { padding: 12px; }
      h1 { font-size: 2.5rem; }
      .card { padding: 20px; border-radius: 16px; }
      .target-name { font-size: 2.8rem; }
      .btn-kill { font-size: 1.6rem; padding: 24px; }
    }
    
    /* Prevent zoom on input focus (iOS) */
    @media (max-width: 600px) {
      input, textarea, select { font-size: 16px !important; }
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
