# Celestial Crash Online — Button pilot audit

## Source examined
- Offline reference: `CelestialCrash_Button_V45_Cute.html` supplied for this work.
- Server baseline: the existing general-profile authoritative battle server.
- Pilot client: `CelestialCrash_Button_V46_Online_Pilot.html`.

## Why Button was selected
The V45 HTML contains Button's offline combat implementation, but the online selector filters Button out and the earlier server allowlist did not include `button`. The first safe integration target was therefore one new character with identifiable, source-backed mechanics, rather than a speculative rewrite of every character.

## Source-derived Button mechanics observed in V45
- Base HP: 410.
- Passive loneliness resource: 14 gained after a hit attacker retreats at least 75 distance beyond the hit distance within a 2.4-second watch window; 0.8-second gain cooldown.
- Incoming damage reduction: 0.94 multiplier, and 0.4 multiplier during the ultimate.
- Basic attack: about 0.78-second cadence; close forward cone attack or ranged thread projectile.
- Skill 0, Thread Snare: about 3.4-second base cooldown; damage plus slow/root; power increases with stored loneliness.
- Skill 1, Sewn Together: about 6.2-second base cooldown; tether that snaps with damage/stun/pull when the target escapes.
- Skill 2, Spare Me a Moment: about 7.4-second base cooldown; decoy, dash/invulnerability, and an explosion with damage/knockback/stun/slow.
- Ultimate, YOU PROMISED YOU WOULDN'T LEAVE: about 6.6 seconds of ultimate state, delayed capture/tick damage, finishing burst, and self-heal/shield.

Values above describe the original offline reference. Timings and interactions can differ in the multiplayer pilot because they are being reimplemented in a separate server simulation.

## Pilot implementation
- Adds `button` to the server allowlist and the V46 online selector.
- Gives Button a dedicated 410 HP server state and Button-specific attack/skill routines.
- Runs skill damage, damage reduction, passive resource, slows/roots/stuns, tether snaps, decoy trigger, ultimate ticks/burst, healing and shield changes on the server.
- Sends compact event/state information so the V46 client can render Button's themed effects; the client visuals do not decide damage or wins.
- Keeps the existing match modes/protocol and leaves ranked unrated.

## Known limitations
- This is an original-inspired pilot, not proven frame-for-frame parity with the offline simulation.
- Button's ultimate finishing damage is simplified in the pilot and may not exactly match the original's spatial behavior in 2v2/FFA. This needs focused multiplayer balance verification.
- The rest of the characters still use generic server combat profiles; their bespoke offline ability parity has not been implemented by this pilot.
- Visual effects have static/code-path checks only; they have not been inspected in a live browser session.
- No live Render deployment or browser multiplayer test has been run as part of this package creation.
- Ranked modes remain unrated. This package does not add accounts, persistence, reconnect support, or rated matchmaking.

## Internal checks run while assembling this package
- `node --check server.js`.
- Syntax checks for both inline scripts extracted from the pilot HTML.
- Node VM test harness covering Button roster support/state, Thread Snare, Sewn Together, decoy explosion, incoming damage/passive watch, ultimate burst/heal/shield, projectile rendering metadata, and a four-fighter mixed simulation.
- Static integration checks for the V46 roster and event bridge.

These checks are not proof of browser rendering or deployed multiplayer behavior. Follow the README and test against your actual devices before treating this pilot as production-ready.
