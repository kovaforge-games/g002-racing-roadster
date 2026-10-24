# Roadster (g002)

A 3D browser racing game starring an electric sports car, built with **three.js** and **Rapier** physics. Race five AI rivals over three laps of one circuit, with cold-gas thrusters for boosts, hops and flips, a chase camera, and handling tuned to feel good on a keyboard or a gamepad. Free practice lets you drive alone and chase your best lap. Party races pit you against up to seven friends: make a party, and they join by scanning its QR code or typing its 6-digit code.

It builds on [g001 (Grand Prix Racer)](https://github.com/l4mb0lion/g001-racing): the driving help, input handling, graphics presets, lighting, surface shaders, camera rig, crash recovery, synthesised audio and the AI drivers all come from there, adapted for an EV and for Rapier.

## Play online

Private, invite only. Friends get a personal invite link from Mike; without a valid invite every address returns a plain 404, and the game is never indexed (robots.txt disallows everything and every response sends `X-Robots-Tag: noindex, nofollow, noarchive`). The game needs WebGL 2 and runs in Chrome, Edge, Firefox and Safari.

## Play locally

```bash
npm install
npm run dev            # http://localhost:5173
npm run party-server   # in a second terminal, for party races (Vite passes /ws through to it)
```

**Showroom:** open `?showroom` or `#showroom` (or use the link on the title screen) to see the car on a turntable in a studio. Drag to look around, scroll to zoom, and press P for paint, S for the spoiler, N for the lights and Enter to drive.

Useful URL options: `?quality=low|medium|high|ultra` overrides the automatic graphics preset, `?tod=morning|noon|sunset|night` picks the time of day, `?autodrive` lets the autopilot drive (a demo lap), and `?safe` starts in safe graphics.

## Racing

Press any key on the title screen to race, or **F** for free practice. In a race you start fifth of six on a staggered grid; the standings panel (top right) shows your position, the lap and the gaps, and rivals appear as coloured dots on the map. After the flag the autopilot takes a cool-down lap while the results come in: **Enter** races again, **F** switches to free practice.

The rivals (Nova Reyes, Kai Lindqvist, Mara Okafor, Theo Brandt and Suki Tanaka, all fictional) are g001's bot drivers adapted for this car: they follow a racing line at a speed set by the corners ahead, pass and follow in traffic, learn where they can push harder each lap, make the odd mistake, and recover from spins. They use the thrusters too: boost on the straights, hop a slow car in their lane, and swing through the air canisters when their tank runs low. Rivals well behind you push a little harder and ones far ahead ease off slightly, so the racing stays close. Cars collide with each other, and tailgating a boosting car is a bad idea: its jet wash shoves you back. Name tags over the rivals show their position, and you hear their jets when they boost close by.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Accelerate / brake | W S or ↑ ↓ | RT / LT |
| Steer | A D or ← → | Left stick |
| Reverse | Hold brake when stopped | Hold LT when stopped |
| Boost (rear jets) | Shift | B |
| Hop (underbody jets) | E or Enter | A |
| In the air: pitch / yaw | W S / A D | Left stick |
| In the air: roll | Hold Space + A D | Hold RB + left stick |
| Handbrake | Space | RB |
| Look back | B | LB |
| Camera (chase, far, hood, bumper) | C | Y |
| Reset to the track | R | Back |
| Paint colour | P | X |
| Driving help: Easy / Medium / Off | 1 / 2 / 3 | |
| Time of day | T | |
| Mute | M | |
| Pause / help | Esc / H | Start |

## Party races

- **Create party** on the title screen (or in the Esc menu) makes a party straight away and shows a **QR code** and a **6-digit code**. Friends scan the QR code with a phone camera, which opens the game and joins the party, or pick **Join party** and type the code (`?code=123456` in the address does the same).
- Up to 8 drivers. The lobby lists everyone with their paint colour (each driver gets a different one), lets you change your name, and the host picks the number of laps (1 to 10) and presses **Start race**.
- The AI rivals step aside: everyone lines up on a staggered grid, the server runs the start lights so they go out together, and the friends' cars show up on track with name tags, on the minimap, and in the standings. Each race is timed from lights out; after the first driver finishes the others have 60 seconds. Results go back to the lobby, ready for the next race.
- In a race Esc opens a menu (the race keeps going) with **Leave party**; leaving brings the AI rivals back. A dropped connection rejoins by itself within 10 seconds. Friends who join during a race wait in the lobby for the next one. If the host leaves, the next driver becomes host.
- Each game simulates its own car and shares its position 20 times a second; the other cars are drawn 100 ms behind so their motion is smooth. They are ghosts for now: cars don't collide with each other.

## The car

A fictional electric sports coupe, inspired by modern EVs (no real brand names, logos or trademarks).

- **Powertrain:** dual motor, 42/58 front/rear, 560 kW, instant torque up to the grip limit, no gears. About 2.5 s to 100 km/h and 265 km/h flat out. Lifting off the throttle regenerates gently (the power gauge turns green).
- **Chassis:** 1,850 kg, low centre of mass, anti-roll bars, aero drag and downforce. Grass has less grip and much more drag.
- **Driving help** (from g001, default Easy) catches slides: it limits steering to what the tyres can hold and counter-steers when the rear steps out, and the physics damps excess yaw. It never steers you towards the line or brakes for you. Easy and Medium also keep traction control and ABS on; Off is fully raw.
- **Visuals:** a procedural body in the style of the 2026 electric roadster: a low wedge with a flat, faceted hood and V-shaped centre panel, fenders standing proud of the hood, a sharp beltline, a black lower body and a gold-tinted glass canopy. It has a light bar across the nose, hidden headlights, a full-width tail light, a carbon diffuser with suction fans, and an active rear wing. The wing lies flush on the tail until about 80 km/h, then pops up; it trims flat for low drag at very high speed and stands up as an airbrake under hard braking. Through the tinted glass you can see the cabin, with white seats, a dash and a yoke. On High and Ultra the paint and glass reflect the track and sky live. It rides on 20" front and 21" rear wheels with thin black spokes over white aero inserts, shows body roll, pitch and skid marks, and comes in six paint colours. No real brand names or logos.

## Thrusters and the air tank

The car carries cold-gas thrusters fed by one compressed-air tank (the HUD's AIR gauge). Nothing burns: the jets vent white vapour.

- **Boost:** rear jets add about 0.9 g of thrust (0-100 km/h drops from 2.5 s to 1.4 s) and push the car past its normal top speed, up to about 340 km/h. A full tank lasts about 4 seconds of boost. Hit boost within 0.3 s of the lights going out for a free **perfect launch**.
- **Hop:** a burst from the underbody jets lifts the car about 2.2 m for 1.3 s of air time. It costs a fifth of the tank and has a short cooldown (the dot under the gauge).
- **Air control:** in the air, throttle and brake (or the stick) pitch the car, steering yaws it, and holding the handbrake turns steering into roll. Inputs you were already holding at take-off are ignored until you let go, so a hop at full throttle stays level. Flips, barrel rolls and 360s get called out, and a wheels-down landing gives a small kick of speed. With driving help on, the car eases itself back to wheels-down when the sticks are centred.
- **Refilling:** the tank never refills by itself. Six rows of glowing air canisters sit off the racing line around the lap (cyan dots on the map); each one adds 12% and comes back 8 seconds after it is taken.
- The debris fence on the barriers is solid, so a hop can't clear the circuit.

## The circuit

Roadster Circuit is a 2.5 km loop with a 500 m main straight, hairpins, esses and fast sweepers, and gentle elevation changes (about ±6 m). Kerbs line every corner, concrete barriers and a debris fence run the whole lap, and the main straight has a grandstand, a start gantry with lights, and a charging pavilion. The landscape rolls into forested hills and snow-capped mountains.

## How it works

| Area | Files |
|---|---|
| Circuit centreline, elevation, kerbs | `src/sim/track.ts` |
| Terrain height grid (road kept flat across) | `src/sim/terrain.ts` |
| Rapier world: heightfield + barrier boxes | `src/sim/world.ts` |
| Car physics (ray-cast vehicle, EV powertrain, aero, assists) | `src/sim/car.ts` |
| Driving help (input side) | `src/sim/assist.ts` |
| Grass and kerbs | `src/sim/surface.ts` |
| Autopilot (tests and demo) | `src/sim/autopilot.ts` |
| Thrusters and air tank; air canisters | `src/sim/jets.ts`, `src/sim/canisters.ts` |
| Renderer, presets, lighting, surfaces | `src/render/renderer.ts`, `graphics.ts`, `environment.ts`, `surfaces.ts` |
| Scenery, car body and model, live reflections, skid marks, cameras | `src/render/trackScene.ts`, `carBody.ts`, `carModel.ts`, `reflections.ts`, `skids.ts`, `cameras.ts` |
| Vapour puffs and jet cones; canisters; fast copies of the car model for rivals; name tags | `src/render/vapour.ts`, `canisterScene.ts`, `cloneModel.ts`, `nameTag.ts` |
| Studio showroom | `src/showroom.ts` |
| Input, audio, crash recovery | `src/core/` |
| HUD and overlays | `src/ui/hud.ts` |
| Racing line and speed profile; AI rivals; the race (grid, laps, positions) | `src/sim/racingLine.ts`, `rival.ts`, `race.ts` |
| Game loop (120 Hz physics, interpolated rendering), laps, race flow, party races | `src/game.ts` |
| Party server: lobby, codes, start lights, state relay, results | `server/party-core.ts` (shared), `worker/index.ts` (Durable Object), `server/server.ts` (local) |
| Party client, screens with the QR code, the friends' cars | `src/net/party.ts`, `src/ui/partyUi.ts`, `src/render/remoteCars.ts` |

Physics runs at a fixed 120 Hz and the renderer interpolates between steps, so the car looks smooth at any frame rate. There are no image or audio files: textures are drawn on canvases and every sound is synthesised with Web Audio.

## Development

```bash
npm run typecheck     # TypeScript
npm run sim-test      # headless handling test: 0-100, top speed, braking, grip, boost, hops,
                      # air control, laps with a line-following and a keyboard-style driver,
                      # and a full 3-lap race against the rivals
npm run track-check   # circuit length, corner radii and clearances
npm run build         # production build in dist/
npm run browser-test  # (with `npm run dev` running) drives the real game in headless Chromium
                      # and saves screenshots to test-results/
npm run party-test    # party server: create, join by code, start lights, state relay, results
npm run party-browser-test   # (with dev + party-server running) three browsers: create a party,
                      # join by the QR link and by typing the code, race, results
```

## Publishing

The game is published the same way as g001: as its own Cloudflare Worker, `g002-roadster`, on the Delpach account. Static assets serve the game on its route (see `wrangler.jsonc`; it takes precedence over the `kovaforge-home` Worker for that path only). Each party runs in its own Durable Object (`PartyRoom`, SQLite-backed, which the Workers Free plan includes), reached over a WebSocket at `/games/g002/ws`; the Worker picks a random 6-digit code and tries another if that room is still in use. See `wrangler.jsonc` and `worker/index.ts`. `npx wrangler dev` runs the Worker and its Durable Objects locally (after `npm run build:kovaforge`), and `npm run party-test -- ws://localhost:8787/ws` tests it.

**Invite gate:** `worker/invite.ts` runs before anything else on every host and path, including the party WebSocket. Opening the game with `?invite=<code>` matching the `INVITE_CODE` Worker secret sets a 30 day HttpOnly cookie (an HMAC of the code, never the code itself) and redirects to the same address without the code. Set or rotate the code with `npx wrangler secret put INVITE_CODE`; rotating it signs everyone out. With no secret set, everything is a 404. Tests: `npm run worker-test`.

**Automatic deploys on every push to `main`:** add a repository secret named `CLOUDFLARE_API_TOKEN` (GitHub → Settings → Secrets and variables → Actions). The same kind of token as g001 works: the *Edit Cloudflare Workers* template scoped to the Delpach account and the kovaforge.org zone. The workflow in `.github/workflows/deploy.yml` type-checks, runs the handling test, builds and deploys. Pull requests run the checks without deploying. To pause deploys, set the repository variable `DEPLOY_DISABLED=true`.

**One-off deploy from your machine:**

```bash
npx wrangler login     # or export CLOUDFLARE_API_TOKEN=...
npm run deploy:kovaforge
```
