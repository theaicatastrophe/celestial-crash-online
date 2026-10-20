# Celestial Crash Online — free-first foundation

This is the first backend milestone for the existing Celestial Crash HTML game: a small WebSocket service that pairs two connected players, lets them exchange fighter selections, and synchronizes a ready-to-start signal.

**Honest scope:** this is not yet the finished online game. The existing browser battle engine is not yet running on the server, and this starter does not implement accounts, saved ratings, character-unlock verification, or ranked result adjudication. Those must be added before calling matches competitive/ranked.

## What it uses
- Node.js + `ws` for HTTP health checks and WebSocket matchmaking.
- Render free web service for a first test. Free instances can sleep when idle and take roughly a minute to wake. See the official Render free-service limits: https://render.com/docs/free
- No secret keys are required for this first milestone.

## Deploy from a phone/tablet (no computer required)

1. Download and extract the ZIP on your device.
2. Open GitHub in your browser and create a new **public** repository named `celestial-crash-online`.
3. Use the repository's **Add file → Upload files** page to upload `server.js`, `package.json`, `render.yaml`, `README.md`, and `PROTOCOL.md` from this folder. If your mobile browser will not let you select several files, upload them one at a time. Keep the files at the repository root, not inside another folder.
4. Open Render in your browser and sign up/log in: https://render.com
5. In the Render dashboard choose **New → Web Service**, connect GitHub, and select `celestial-crash-online`.
6. Use these settings if Render does not detect `render.yaml` automatically:
   - Runtime: Node
   - Build command: `npm install`
   - Start command: `npm start`
   - Instance type: Free
7. Deploy. When it finishes, open `https://YOUR-SERVICE.onrender.com/health`. A JSON response with `"ok":true` means the service is reachable.
8. Keep the service URL. The game client will need its WebSocket address: `wss://YOUR-SERVICE.onrender.com/ws`.

You do **not** need to give anyone your GitHub or Render password. Do not paste private account tokens into chat.

## Local checks
- `npm install`
- `npm run check`
- `npm start`
- Open `http://localhost:10000/health`

## Next engineering milestone
Integrate this protocol with the existing HTML game's character selection and battle flow. Then move the actual battle outcome calculation to trusted server code, add authenticated accounts and persistent ratings, and only then enable ranked results. A client-supplied `winner` value must never change rank.
