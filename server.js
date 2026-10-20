'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const MAX_MESSAGE_BYTES = 64 * 1024;
const HEARTBEAT_MS = 25_000;
const SNAPSHOT_MIN_INTERVAL_MS = 40;
const FIGHTER_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

// Ranked modes are currently matchmaking previews. Results are intentionally
// unrated until the combat simulation and identity/anti-cheat checks are server-authoritative.
const MODES = Object.freeze({
  classic_1v1: { label: 'Classic 1v1', players: 2, teams: 'versus', ranked: false },
  classic_2v2: { label: 'Classic 2v2', players: 4, teams: 'duos', ranked: false },
  classic_ffa4: { label: 'Classic 1v1v1v1', players: 4, teams: 'free-for-all', ranked: false },
  ranked_1v1: { label: 'Ranked 1v1', players: 2, teams: 'versus', ranked: true },
  ranked_2v2: { label: 'Ranked 2v2', players: 4, teams: 'duos', ranked: true }
});

const queues = new Map(Object.keys(MODES).map((mode) => [mode, []]));
const rooms = new Map();
const clients = new Map();

function queuedCount() {
  let total = 0;
  for (const q of queues.values()) total += q.length;
  return total;
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'access-control-allow-origin': '*'
  });
  res.end(JSON.stringify(body));
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/' || url.pathname === '/health') {
    json(res, 200, {
      ok: true,
      service: 'celestial-crash-online',
      stage: 'online-battle-relay-preview',
      queuedPlayers: queuedCount(),
      activeRooms: rooms.size,
      connectedPlayers: clients.size,
      supportedModes: Object.keys(MODES),
      rankedRated: false,
      note: 'Automatic battles are simulated by the first player and relayed to the others. Ranked modes are currently unrated previews.'
    });
    return;
  }
  if (url.pathname === '/favicon.ico') {
    res.writeHead(204);
    res.end();
    return;
  }
  json(res, 404, { error: 'not_found' });
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws') {
    socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
});

function send(ws, type, payload = {}) {
  if (ws.readyState === WebSocket.OPEN) {
    try { ws.send(JSON.stringify({ type, ...payload })); }
    catch { /* A disconnected client is handled by its close event. */ }
  }
}
function sendError(ws, code, message) { send(ws, 'error', { code, message }); }
function sendRoom(room, type, payload = {}) {
  for (const p of room.players) send(p.ws, type, payload);
}
function sendRoomExcept(room, excluded, type, payload = {}) {
  for (const p of room.players) if (p !== excluded) send(p.ws, type, payload);
}
function removeFromQueues(player) {
  for (const queue of queues.values()) {
    const i = queue.indexOf(player);
    if (i >= 0) queue.splice(i, 1);
  }
  player.queuedMode = null;
}
function clearRoomPlayerState(player, room) {
  if (player.room !== room) return;
  player.room = null;
  player.fighterId = null;
  player.ready = false;
  player.team = null;
  player.playerIndex = null;
  player.mode = null;
}
function leaveRoom(player, reason = 'opponent_disconnected') {
  const room = player.room;
  if (!room) return;
  rooms.delete(room.id);
  for (const other of room.players) {
    if (other !== player) {
      send(other.ws, 'opponent_left', { reason, roomId: room.id, playerId: player.id });
      clearRoomPlayerState(other, room);
    }
  }
  clearRoomPlayerState(player, room);
}
function completeRoom(room, result) {
  if (room.ended) return;
  room.ended = true;
  room.phase = 'completed';
  const resultPayload = {
    roomId: room.id,
    mode: room.mode,
    label: MODES[room.mode].label,
    winnerPlayerId: result.winnerPlayerId || null,
    winnerTeam: Number.isInteger(result.winnerTeam) ? result.winnerTeam : null,
    duration: Number.isFinite(result.duration) ? Math.max(0, Math.min(result.duration, 86_400)) : 0,
    rated: false,
    note: MODES[room.mode].ranked
      ? 'Ranked matchmaking preview: rating points are not recorded yet.'
      : 'Classic result.'
  };
  sendRoom(room, 'match_result', resultPayload);
  rooms.delete(room.id);
  for (const player of room.players) clearRoomPlayerState(player, room);
}
function enqueue(player, mode, fighterId) {
  if (player.room) {
    sendError(player.ws, 'already_in_room', 'Leave your current match before searching again.');
    return;
  }
  if (!Object.hasOwn(MODES, mode)) {
    sendError(player.ws, 'invalid_mode', 'Choose one of the supported Celestial Crash online modes.');
    return;
  }
  if (typeof fighterId !== 'string' || !FIGHTER_ID_RE.test(fighterId)) {
    sendError(player.ws, 'invalid_fighter_id', 'Choose a valid character before searching.');
    return;
  }
  if (player.queuedMode) {
    if (player.queuedMode === mode && queues.get(mode).includes(player)) {
      send(player.ws, 'queue_status', { queued: true, mode, position: queues.get(mode).indexOf(player) + 1 });
      return;
    }
    removeFromQueues(player);
  }

  const modeInfo = MODES[mode];
  const queue = queues.get(mode);
  player.mode = mode;
  player.queuedMode = mode;
  player.fighterId = fighterId;
  player.ready = true;
  queue.push(player);
  send(player.ws, 'queue_status', { queued: true, mode, position: queue.length, neededPlayers: modeInfo.players });

  while (queue.length >= modeInfo.players) {
    const matched = [];
    while (matched.length < modeInfo.players && queue.length) {
      const candidate = queue.shift();
      if (candidate && candidate.ws.readyState === WebSocket.OPEN && candidate.queuedMode === mode && !candidate.room) {
        candidate.queuedMode = null;
        matched.push(candidate);
      }
    }
    if (matched.length === modeInfo.players) makeRoom(matched, mode);
    else break;
  }
}
function makeRoom(players, mode) {
  const room = {
    id: crypto.randomUUID(),
    seed: crypto.randomBytes(4).readUInt32BE(0),
    mode,
    label: MODES[mode].label,
    players,
    authorityId: players[0].id,
    createdAt: Date.now(),
    phase: 'battle',
    ended: false,
    lastSnapshotAt: 0
  };
  players.forEach((player, playerIndex) => {
    player.room = room;
    player.mode = mode;
    player.playerIndex = playerIndex;
    if (MODES[mode].teams === 'duos') player.team = playerIndex < 2 ? 0 : 1;
    else player.team = playerIndex;
  });
  rooms.set(room.id, room);

  for (const player of players) {
    send(player.ws, 'match_found', {
      roomId: room.id,
      playerId: player.id,
      playerIndex: player.playerIndex,
      playerCount: players.length,
      team: player.team,
      mode,
      label: room.label,
      seed: room.seed,
      authority: player.id === room.authorityId,
      phase: room.phase
    });
  }

  const roster = players.map((player) => ({
    playerId: player.id,
    playerIndex: player.playerIndex,
    team: player.team,
    fighterId: player.fighterId
  }));
  sendRoom(room, 'battle_ready', {
    roomId: room.id,
    mode,
    label: room.label,
    seed: room.seed,
    authorityId: room.authorityId,
    players: roster,
    playerCount: roster.length,
    rated: false
  });
}

wss.on('connection', (ws) => {
  const player = {
    id: crypto.randomUUID(),
    ws,
    room: null,
    fighterId: null,
    mode: null,
    queuedMode: null,
    team: null,
    playerIndex: null,
    ready: false
  };
  clients.set(ws, player);
  ws.isAlive = true;
  send(ws, 'connected', { playerId: player.id, protocolVersion: 2, modes: Object.keys(MODES) });

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { sendError(ws, 'invalid_json', 'Send a valid JSON message.'); return; }
    if (!message || typeof message.type !== 'string') {
      sendError(ws, 'invalid_message', 'Every message must include a type.');
      return;
    }

    switch (message.type) {
      case 'ping':
        send(ws, 'pong', { at: Date.now() });
        break;

      case 'find_match':
        enqueue(player, message.mode, message.fighterId);
        break;

      case 'cancel_queue':
        removeFromQueues(player);
        send(player.ws, 'queue_status', { queued: false });
        break;

      case 'leave_room':
        removeFromQueues(player);
        leaveRoom(player, 'player_left');
        send(ws, 'left_room', {});
        break;

      case 'battle_snapshot': {
        const room = player.room;
        if (!room || room.ended) { sendError(ws, 'not_in_room', 'There is no active match to update.'); break; }
        if (player.id !== room.authorityId) { sendError(ws, 'not_authority', 'Only the battle simulation host can relay snapshots.'); break; }
        if (!message.snapshot || typeof message.snapshot !== 'object' || Array.isArray(message.snapshot)) {
          sendError(ws, 'invalid_snapshot', 'Snapshot payload must be an object.'); break;
        }
        const now = Date.now();
        if (now - room.lastSnapshotAt < SNAPSHOT_MIN_INTERVAL_MS) break;
        room.lastSnapshotAt = now;
        // WebSocket's maxPayload caps the incoming frame. Snapshot rates and size are bounded.
        sendRoomExcept(room, player, 'battle_snapshot', { roomId: room.id, snapshot: message.snapshot });
        break;
      }

      case 'report_result': {
        const room = player.room;
        if (!room || room.ended) { sendError(ws, 'not_in_room', 'There is no active match to finish.'); break; }
        if (player.id !== room.authorityId) { sendError(ws, 'not_authority', 'Only the battle simulation host can report the result.'); break; }
        const data = message.result && typeof message.result === 'object' ? message.result : {};
        const winnerPlayerId = typeof data.winnerPlayerId === 'string' && room.players.some((p) => p.id === data.winnerPlayerId)
          ? data.winnerPlayerId : null;
        let winnerTeam = Number.isInteger(data.winnerTeam) && data.winnerTeam >= 0 && data.winnerTeam < room.players.length
          ? data.winnerTeam : null;
        if (MODES[room.mode].teams === 'duos' && winnerTeam !== 0 && winnerTeam !== 1) winnerTeam = null;
        completeRoom(room, {
          winnerPlayerId,
          winnerTeam,
          duration: Number(data.duration)
        });
        break;
      }

      default:
        sendError(ws, 'unknown_message_type', `Unsupported message type: ${message.type}`);
    }
  });

  ws.on('close', () => {
    removeFromQueues(player);
    leaveRoom(player, 'opponent_disconnected');
    clients.delete(ws);
  });
  ws.on('error', () => {});
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);
heartbeat.unref();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Celestial Crash Online relay listening on 0.0.0.0:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server_shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
  
