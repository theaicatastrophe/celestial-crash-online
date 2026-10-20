'use strict';

const http = require('node:http');
const crypto = require('node:crypto');
const { WebSocketServer, WebSocket } = require('ws');

const PORT = Number(process.env.PORT || 10000);
const MAX_MESSAGE_BYTES = 8 * 1024;
const HEARTBEAT_MS = 25_000;
const FIGHTER_ID_RE = /^[a-zA-Z0-9_-]{1,80}$/;

const server = http.createServer((req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (url.pathname === '/' || url.pathname === '/health') {
    const body = JSON.stringify({
      ok: true,
      service: 'celestial-crash-online-mvp',
      stage: 'matchmaking-foundation',
      queuedPlayers: queue.length,
      activeRooms: rooms.size,
      note: 'This confirms the server is reachable; it is not yet the integrated game battle engine.'
    });
    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
    res.end(body);
    return;
  }
  res.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({ error: 'not_found' }));
});

const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_MESSAGE_BYTES });
const clients = new Map();
const queue = [];
const rooms = new Map();

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
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type, ...payload }));
}
function sendError(ws, code, message) { send(ws, 'error', { code, message }); }
function sendRoom(room, type, payload = {}) {
  for (const p of room.players) send(p.ws, type, payload);
}
function removeFromQueue(player) {
  const i = queue.indexOf(player);
  if (i >= 0) queue.splice(i, 1);
}
function leaveRoom(player, reason = 'opponent_disconnected') {
  const room = player.room;
  if (!room) return;
  rooms.delete(room.id);
  player.room = null;
  for (const other of room.players) {
    if (other !== player) {
      other.room = null;
      send(other.ws, 'opponent_left', { reason });
    }
  }
}
function makeRoom(a, b) {
  removeFromQueue(a);
  removeFromQueue(b);
  const room = {
    id: crypto.randomUUID(),
    seed: crypto.randomBytes(4).readUInt32BE(0),
    players: [a, b],
    createdAt: Date.now(),
    phase: 'selecting'
  };
  a.room = room;
  b.room = room;
  rooms.set(room.id, room);
  for (let i = 0; i < room.players.length; i++) {
    const self = room.players[i];
    const opponent = room.players[1 - i];
    send(self.ws, 'match_found', {
      roomId: room.id,
      playerId: self.id,
      opponentId: opponent.id,
      seed: room.seed,
      phase: room.phase
    });
  }
}
function enqueue(player) {
  if (player.room) {
    sendError(player.ws, 'already_in_room', 'Leave your current match before searching again.');
    return;
  }
  if (queue.includes(player)) {
    send(player.ws, 'queue_status', { queued: true, position: queue.indexOf(player) + 1 });
    return;
  }
  const opponentIndex = queue.findIndex((candidate) => candidate !== player && candidate.ws.readyState === WebSocket.OPEN);
  if (opponentIndex >= 0) {
    const opponent = queue[opponentIndex];
    makeRoom(opponent, player);
    return;
  }
  queue.push(player);
  send(player.ws, 'queue_status', { queued: true, position: queue.length });
}
function broadcastSelection(room, player) {
  for (const recipient of room.players) {
    const opponent = room.players.find((p) => p !== recipient);
    send(recipient.ws, 'fighter_selected', {
      playerId: player.id,
      fighterId: player.fighterId,
      opponentFighterId: opponent.fighterId || null
    });
  }
}
function maybeStart(room) {
  if (room.players.length !== 2 || !room.players.every((p) => p.ready && p.fighterId)) return;
  room.phase = 'ready_to_start';
  sendRoom(room, 'battle_ready', {
    roomId: room.id,
    seed: room.seed,
    fighters: room.players.map((p) => ({ playerId: p.id, fighterId: p.fighterId }))
  });
  // Deliberately does not award a winner or rank yet. The real game simulation must
  // be integrated and validated server-side before ranked results can be trusted.
}

wss.on('connection', (ws) => {
  const player = {
    id: crypto.randomUUID(), ws, room: null,
    fighterId: null, ready: false, alive: true
  };
  clients.set(ws, player);
  ws.isAlive = true;
  send(ws, 'connected', { playerId: player.id, protocolVersion: 1 });

  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', (raw) => {
    let message;
    try { message = JSON.parse(raw.toString()); }
    catch { sendError(ws, 'invalid_json', 'Send a valid JSON message.'); return; }
    if (!message || typeof message.type !== 'string') {
      sendError(ws, 'invalid_message', 'Every message must include a type.'); return;
    }
    switch (message.type) {
      case 'ping':
        send(ws, 'pong', { at: Date.now() });
        break;
      case 'find_match':
        enqueue(player);
        break;
      case 'cancel_queue':
        removeFromQueue(player);
        send(player.ws, 'queue_status', { queued: false });
        break;
      case 'select_fighter': {
        if (!player.room) { sendError(ws, 'not_in_room', 'Join a match before selecting a fighter.'); break; }
        if (player.room.phase !== 'selecting') { sendError(ws, 'selection_closed', 'Fighter selection is closed.'); break; }
        if (typeof message.fighterId !== 'string' || !FIGHTER_ID_RE.test(message.fighterId)) {
          sendError(ws, 'invalid_fighter_id', 'fighterId must be a short ID containing letters, numbers, _ or -.'); break;
        }
        // This only validates ID shape. Character unlock ownership must be checked
        // against authenticated account data before ranked mode is enabled.
        player.fighterId = message.fighterId;
        player.ready = false;
        broadcastSelection(player.room, player);
        break;
      }
      case 'set_ready': {
        if (!player.room) { sendError(ws, 'not_in_room', 'Join a match before readying up.'); break; }
        if (!player.fighterId) { sendError(ws, 'choose_fighter_first', 'Select a fighter first.'); break; }
        if (typeof message.ready !== 'boolean') { sendError(ws, 'invalid_ready', 'ready must be true or false.'); break; }
        player.ready = message.ready;
        sendRoom(player.room, 'player_ready', { playerId: player.id, ready: player.ready });
        maybeStart(player.room);
        break;
      }
      case 'leave_room':
        removeFromQueue(player);
        leaveRoom(player, 'player_left');
        player.fighterId = null;
        player.ready = false;
        send(ws, 'left_room', {});
        break;
      default:
        sendError(ws, 'unknown_message_type', `Unsupported message type: ${message.type}`);
    }
  });

  ws.on('close', () => {
    removeFromQueue(player);
    leaveRoom(player);
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
  console.log(`Celestial Crash online MVP listening on 0.0.0.0:${PORT}`);
});

function shutdown() {
  clearInterval(heartbeat);
  for (const ws of wss.clients) ws.close(1001, 'server_shutdown');
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5_000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
