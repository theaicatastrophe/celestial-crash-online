# Celestial Crash Online MVP — WebSocket protocol

Connect to `wss://YOUR-SERVICE.onrender.com/ws`.

## Server messages
- `connected`: server-assigned temporary player ID and protocol version.
- `queue_status`: `{ queued, position? }`.
- `match_found`: room ID, this player's ID, opponent ID, seed, and phase.
- `fighter_selected`: player ID, selected fighter ID, and opponent fighter ID (or null).
- `player_ready`: player ID and ready state.
- `battle_ready`: both fighter IDs and a shared seed. This is a lobby handshake only; it does not yet run or adjudicate the actual game battle.
- `opponent_left`, `left_room`, `pong`, `error`.

## Client messages
- `{ "type": "find_match" }`
- `{ "type": "cancel_queue" }`
- `{ "type": "select_fighter", "fighterId": "existing-game-character-id" }`
- `{ "type": "set_ready", "ready": true }`
- `{ "type": "leave_room" }`
- `{ "type": "ping" }`

Temporary player IDs reset when a connection ends. Do not use them as account identities or ranked identities. Character IDs are only shape-checked in this first step; account ownership enforcement is not implemented yet. Do not award rank from client-submitted results. Ranked play must wait until the existing battle simulation is integrated with trusted server-side result calculation and authenticated persistent accounts.
