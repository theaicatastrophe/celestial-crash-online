# Celestial Crash Online — Protocol & Limits

The WebSocket protocol remains compatible with the existing online client: `connected`, `find_match`, `queue_status`, `match_found`, `battle_ready`, `battle_snapshot`, `match_result`, `leave_room`, `cancel_queue`, and `error` messages are preserved. Clients select characters and render snapshots; they cannot submit authoritative battle snapshots or results.

## Server simulation

The Node server runs movement, attack/skill cooldowns, source-defined V45 ability handlers, projectile collision/homing/piercing, delayed ability actions, persistent effects, summons, damage, shields, healing, knockout, and match results. Button continues to use its bespoke server-side implementation. The V45 source handler catalog maps 60 roster entries/variants and 252 unique skill handler names.

## Limits

- Ranked queues are not rated and do not persist MMR or leaderboard history.
- Verified user identities, reconnect recovery, and production-grade anti-cheat are not included.
- Visual and audio-only source functionality is adapted to server-safe events; it is not a complete browser-renderer port.
- Handler smoke tests cover every non-Button catalog tuple and five seconds of delayed/effect stepping per skill cast, but cannot prove full parity over every battle, map state, or rare interaction.
- Keep the existing working deployment commit so it can be restored if an integration issue appears.


The full-roster mechanics package adds `source_ability_engine.js`, `source_combat_hooks.js`, and `source_skill_catalog.json` as required server-root runtime files. Keep the existing WebSocket message schema unchanged when deploying.


## Snapshot additions (0.5.2)
- `snapshot.effects[]`: active skill effects. First appearance is full (`uid,type,x,y,owner,age,duration,r,level` plus `z,k,s,o` for zones); later entries are compact (`uid,x,y,age,duration,r,target` and `o` only when it changed). An effect missing from the list has ended.
- `snapshot.timeStop`, `snapshot.fourthWall`: global battle state.
- `fighters[].fx` / `fighters[].fxDel`: character state that changed since the last snapshot (full on the first snapshot) and keys removed.
- `projectiles[]` may carry small render hints (`oc, vol, vi, vn, lq, fk, fform, sv …`).
- New events: `sfx {name,args[]}` (play the original sound function), `skill`/`ultimate` with `cast:true` on the cast moment, `wall {side}`, `collision {hitSpeed}`, `source_particle`, `source_text`, `source_visual`, `source_card`, `summon`, `summon_end`, `form_change`.
