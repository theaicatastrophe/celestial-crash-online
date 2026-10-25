# Celestial Crash Online — Full Roster Source-Mechanics Upgrade

This package integrates the V45 source-defined ability-handler catalog into the existing server-authoritative online battle engine. It is designed as one combined update rather than a series of roster-group uploads. It keeps the existing WebSocket protocol, matchmaking modes, 20 Hz simulation, and Button's dedicated online pilot.

## What is included

- **Full catalog routing:** 60 source roster entries / variants and 252 distinct source skill handlers are available through the server-side source ability engine.
- **Source handler integration:** the actual V45 handler definitions are loaded in their original initialization order. The engine provides server-safe combat helpers and adapts browser-only visual/audio helpers so they don't require a DOM, canvas, or WebAudio context on the server.
- **Core combat timeline:** server-owned delayed actions, persistent area effects, summons, projectiles, status changes, source-defined skill cooldown timing, and per-character passive hooks run as part of server ticks. V45-derived Zodiac damage passives and on-hit burns/slows are handled in `source_combat_hooks.js`; selected special basic attacks have dedicated server routes.
- **Online roster:** the server accepts `odette` and `steve`; the included V48 client selector includes every fighter from the source roster, including them.
- **Unchanged foundation:** matchmaking remains Classic 1v1, Classic 2v2, Classic FFA4, Ranked 1v1, and Ranked 2v2. Combat state and results remain server-authoritative; ranked remains unrated.
- **Button preserved:** Button continues to use its separate, previously tested server-side pilot instead of passing through the general source skill runner.

## Update: original attack and effect visuals online (v2)

Online matches now show the original offline skill effects instead of a basic flash.

- **Effects are no longer lost.** The server used to clear its effect list every tick but only sent a snapshot when 50 ms had passed, so any skipped tick lost its effects. Events now wait until a snapshot is actually sent.
- **Real zones and named effects are sent.** Every V45 zone (beams, bursts, rings, tiles, domains) and named effect (horizon, supernova, maelstrom...) is sent with its real kind, size and timing. The V48 client draws them with the offline drawing code.
- **More events are drawn.** Floating text, particles, screen effects, summons, form changes and Odette's dance poses.
- **More character state reaches the client.** Focalors forms, Seraphim face/flight/ultimate, Manacle seals, Steve tool, summon twins, Lovers lead and others.
- **Odette's acts follow HP** like the offline game (Act I at 67% or more, Act II at 34% or more, otherwise Act III) with the 4.2 second performance cutscene. Her skills no longer cycle her act on every cast.
- **New test:** `test_visual_events.js` (all 248 skill casts send a visual, events serialise safely, Odette acts, event retention).

Not changed or not confirmed: Lovers' lead role does not swap on the server yet; the client changes were syntax-checked but not run in a browser. Deploy the server files and the V48 client together.

## Honest limitations

This is a substantial roster-wide integration, **not a guarantee of bit-for-bit parity with every offline animation and edge case**. Source handler functions are present and smoke-tested, but visual-only code has server-safe adapters; some highly specialized interactions may still need corrections from live match feedback. The browser client may not reproduce every offline-only effect. The package hasn't been deployed or tested against the live Render service from this workspace, so keep the existing working commit available until post-deploy tests pass.

Ranked modes are previews: ratings and leaderboards are not persistent; verified account identity, reconnect recovery, and production-grade anti-cheat are not included.

## Runtime files — all seven belong at the repository root

1. `server.js` — matchmaking, server simulation, snapshots, hit processing.
2. `source_mechanics.js` — source-derived shared HP/damage/shield/healing/cooldown rules.
3. `source_ability_engine.js` — roster-wide server source handlers and combat timeline.
4. `source_combat_hooks.js` — shared V45 defender and attacker passive hooks.
5. `source_skill_catalog.json` — runtime metadata used by the engine to map character/variant/skill slots.
6. `package.json` — Node scripts and `ws` dependency.
7. `render.yaml` — Render service settings.

Do not upload these into a nested folder. The server needs all seven files together.

## Client file

`CelestialCrash_Button_V48_Full_Roster.html` is the paired browser client. It includes the Odette and Steve options in the online character dropdown. Use this client when testing the upgrade. Keep the older V47 client until the new client is confirmed working; uploading an HTML file to the GitHub server repository does not automatically replace a copy embedded in another Android app/package.

## Audit and tests

- `test_source_rules.js` — source HP/damage/shield/heal/cooldown helpers.
- `test_button_pilot.js` — Button server pilot regression tests.
- `test_source_combat_hooks.js` — checks source-derived passives including Aries damage reduction while dashing, Taurus shield trigger, Libra damage cap, Gemini twin defense, Pisces dodge, Scorpio burn, Mars low-health bonus, and Saturn/Uranus/Cinder on-hit effects.
- `test_full_roster_abilities.js` — verifies all 252 handler keys are routed, exercises all 248 non-Button catalog skill tuples with five-second simulated timelines, and simulates basic attacks/passive ticks for all 59 non-Button roster entries. Button is verified separately by its dedicated pilot tests.
- `source_skill_catalog.json` — source names, handler keys, variants, and cooldown metadata.
- `skill_cooldowns_generated.json` — reference-only export; not needed by the server at runtime.
- `PROTOCOL.md` — existing online message protocol and safety limits.
- `START_HERE_ANDROID.txt` — update instructions for phone/tablet.

Run with Node 20+:

```sh
npm run check
npm test
```

A local WebSocket package installation is required to start the server (`npm install`), and a live server/device test is still required after deployment. Passing the handler tests demonstrates routing and tested simulated timelines; it does not prove every possible match interaction or visual is perfect.

## Deploy from Android — cautiously

1. Back up the current working GitHub commit before changing anything.
2. Open `https://github.com/theaicatastrophe/celestial-crash-online` in the Android browser.
3. At the repository root, upload/replace all seven runtime files listed above together. The engine, combat-hook module, and JSON catalog are required runtime files. Do not delete the original offline V45 HTML.
4. Commit. Render is expected to start a redeploy automatically, but verify the deploy status in `https://dashboard.render.com/`.
5. Check `https://celestial-crash-online.onrender.com/health`. The expected markers are `stage: "full-roster-source-engine-v2"` and `engineVersion: "server-source-ability-engine-v2"`.
6. Open the paired V48 client and test two-device Classic 1v1 first. Test Steve and Odette selection, basic attacks, multiple skills, ultimates, status effects, KO/results, then 2v2 and FFA4.
7. Keep Ranked as an unrated preview. If the server fails to start or combat regresses, revert the server commit so Render returns to the previous working version.

I have not pushed these files to GitHub or deployed them to Render from this workspace.
