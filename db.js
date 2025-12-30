import Database from 'better-sqlite3';
import crypto from 'crypto';

const db = new Database('assassin.db');

// Initialize database schema
db.exec(`
  CREATE TABLE IF NOT EXISTS games (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    status TEXT DEFAULT 'waiting',
    objective TEXT,
    admin_token TEXT NOT NULL UNIQUE,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS players (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    name TEXT NOT NULL,
    phone TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    target_id INTEGER,
    is_alive INTEGER DEFAULT 1,
    kills INTEGER DEFAULT 0,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (game_id) REFERENCES games(id),
    FOREIGN KEY (target_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS kill_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    killer_id INTEGER NOT NULL,
    victim_id INTEGER NOT NULL,
    status TEXT DEFAULT 'pending',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (killer_id) REFERENCES players(id),
    FOREIGN KEY (victim_id) REFERENCES players(id)
  );

  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    game_id TEXT NOT NULL,
    description TEXT NOT NULL,
    FOREIGN KEY (game_id) REFERENCES games(id)
  );
`);

// Add current_task_id column to players if it doesn't exist
try {
  db.exec(`ALTER TABLE players ADD COLUMN current_task_id INTEGER REFERENCES tasks(id)`);
} catch (e) {
  // Column already exists, ignore
}

// Helper to generate tokens
export function generateToken() {
  return crypto.randomBytes(16).toString('hex');
}

export function generateGameId() {
  return crypto.randomBytes(4).toString('hex');
}

// Game functions
export function createGame(name, objective) {
  const id = generateGameId();
  const adminToken = generateToken();
  db.prepare('INSERT INTO games (id, name, objective, admin_token) VALUES (?, ?, ?, ?)').run(id, name, objective, adminToken);
  return { id, adminToken };
}

export function getGameById(id) {
  return db.prepare('SELECT * FROM games WHERE id = ?').get(id);
}

export function getGameByAdminToken(token) {
  return db.prepare('SELECT * FROM games WHERE admin_token = ?').get(token);
}

export function updateGameStatus(id, status) {
  db.prepare('UPDATE games SET status = ? WHERE id = ?').run(status, id);
}

// Task functions
export function addTask(gameId, description) {
  const result = db.prepare('INSERT INTO tasks (game_id, description) VALUES (?, ?)').run(gameId, description);
  return { id: result.lastInsertRowid, game_id: gameId, description };
}

export function getTasksByGame(gameId) {
  return db.prepare('SELECT * FROM tasks WHERE game_id = ?').all(gameId);
}

export function getRandomTask(gameId) {
  const tasks = getTasksByGame(gameId);
  if (tasks.length === 0) return null;
  return tasks[Math.floor(Math.random() * tasks.length)];
}

export function setPlayerTask(playerId, taskId) {
  db.prepare('UPDATE players SET current_task_id = ? WHERE id = ?').run(taskId, playerId);
}

export function getPlayerTask(playerId) {
  return db.prepare(`
    SELECT t.* FROM tasks t
    JOIN players p ON p.current_task_id = t.id
    WHERE p.id = ?
  `).get(playerId);
}

// Player functions
export function addPlayer(gameId, name, phone) {
  const token = generateToken();
  const result = db.prepare('INSERT INTO players (game_id, name, phone, token) VALUES (?, ?, ?, ?)').run(gameId, name, phone, token);
  return { id: result.lastInsertRowid, token };
}

export function getPlayerByToken(token) {
  return db.prepare('SELECT * FROM players WHERE token = ?').get(token);
}

export function getPlayerById(id) {
  return db.prepare('SELECT * FROM players WHERE id = ?').get(id);
}

export function getPlayersByGame(gameId) {
  return db.prepare('SELECT * FROM players WHERE game_id = ? ORDER BY created_at').all(gameId);
}

export function getAlivePlayers(gameId) {
  return db.prepare('SELECT * FROM players WHERE game_id = ? AND is_alive = 1').all(gameId);
}

export function setPlayerTarget(playerId, targetId) {
  db.prepare('UPDATE players SET target_id = ? WHERE id = ?').run(targetId, playerId);
}

export function killPlayer(playerId) {
  db.prepare('UPDATE players SET is_alive = 0, target_id = NULL WHERE id = ?').run(playerId);
}

export function incrementKills(playerId) {
  db.prepare('UPDATE players SET kills = kills + 1 WHERE id = ?').run(playerId);
}

// Kill request functions
export function createKillRequest(killerId, victimId) {
  // Check if pending request already exists
  const existing = db.prepare('SELECT * FROM kill_requests WHERE killer_id = ? AND victim_id = ? AND status = ?').get(killerId, victimId, 'pending');
  if (existing) return existing;

  const result = db.prepare('INSERT INTO kill_requests (killer_id, victim_id) VALUES (?, ?)').run(killerId, victimId);
  return { id: result.lastInsertRowid, killer_id: killerId, victim_id: victimId, status: 'pending' };
}

export function getKillRequestById(id) {
  return db.prepare('SELECT * FROM kill_requests WHERE id = ?').get(id);
}

export function getPendingKillRequests(gameId) {
  return db.prepare(`
    SELECT kr.*,
           killer.name as killer_name,
           victim.name as victim_name
    FROM kill_requests kr
    JOIN players killer ON kr.killer_id = killer.id
    JOIN players victim ON kr.victim_id = victim.id
    WHERE killer.game_id = ? AND kr.status = 'pending'
    ORDER BY kr.created_at DESC
  `).all(gameId);
}

export function getPendingKillAgainstPlayer(playerId) {
  return db.prepare(`
    SELECT kr.*, killer.name as killer_name
    FROM kill_requests kr
    JOIN players killer ON kr.killer_id = killer.id
    WHERE kr.victim_id = ? AND kr.status = 'pending'
  `).get(playerId);
}

export function updateKillRequestStatus(id, status) {
  db.prepare('UPDATE kill_requests SET status = ? WHERE id = ?').run(status, id);
}

// Shuffle array using Fisher-Yates
function shuffleArray(array) {
  const shuffled = [...array];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  return shuffled;
}

// Assign circular targets: 1→2→3→...→n→1
// Also assigns a random task to each player
export function assignTargets(gameId) {
  const players = getPlayersByGame(gameId);
  if (players.length < 2) return false;

  const shuffled = shuffleArray(players);

  for (let i = 0; i < shuffled.length; i++) {
    const nextIndex = (i + 1) % shuffled.length;
    setPlayerTarget(shuffled[i].id, shuffled[nextIndex].id);
    
    // Assign a random task to each player
    const task = getRandomTask(gameId);
    if (task) {
      setPlayerTask(shuffled[i].id, task.id);
    }
  }

  return true;
}

// Process confirmed kill
export function processKill(killRequestId) {
  const request = getKillRequestById(killRequestId);
  if (!request || request.status !== 'pending') return null;

  const killer = getPlayerById(request.killer_id);
  const victim = getPlayerById(request.victim_id);

  if (!killer || !victim) return null;

  // Update kill request status
  updateKillRequestStatus(killRequestId, 'confirmed');

  // Killer gets victim's target
  setPlayerTarget(killer.id, victim.target_id);

  // Assign a new random task to the killer
  const newTask = getRandomTask(killer.game_id);
  if (newTask) {
    setPlayerTask(killer.id, newTask.id);
  }

  // Increment killer's kills
  incrementKills(killer.id);

  // Mark victim as dead
  killPlayer(victim.id);

  // Check if game is over
  const alive = getAlivePlayers(killer.game_id);
  if (alive.length === 1) {
    updateGameStatus(killer.game_id, 'finished');
  }

  return { killer, victim, newTarget: getPlayerById(victim.target_id), newTask };
}

export function getLeaderboard(gameId) {
  return db.prepare(`
    SELECT name, kills, is_alive
    FROM players
    WHERE game_id = ?
    ORDER BY kills DESC, is_alive DESC
  `).all(gameId);
}

export default db;
