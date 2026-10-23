# Roadster (g002)

A 3D browser racing game starring an electric sports car, built with **three.js** and **Rapier** physics. This first version is a single-player driving prototype: one car on one circuit, with a chase camera and handling tuned to feel good on a keyboard or a gamepad.

It builds on [g001 (Grand Prix Racer)](https://github.com/l4mb0lion/g001-racing): the driving help, input handling, graphics presets, lighting, surface shaders, camera rig, crash recovery and synthesised audio all come from there, adapted for an EV and for Rapier.

## Play online

Once published (see [Publishing](#publishing)): **https://kovaforge.org/games/g002/** and **https://roadster.kovaforge.org**. The game needs WebGL 2 and runs in Chrome, Edge, Firefox and Safari.

## Play locally

```bash
npm install
npm run dev        # http://localhost:5173
```

**Showroom:** open `?showroom` (or use the link on the title screen) to see the car on a turntable in a studio. Drag to look around, scroll to zoom, and press P for paint, S for the spoiler, N for the lights and Enter to drive.

Useful URL options: `?quality=low|medium|high|ultra` overrides the automatic graphics preset, `?tod=morning|noon|sunset|night` picks the time of day, `?autodrive` lets the autopilot drive (a demo lap), and `?safe` starts in safe graphics.

## Controls

| Action | Keyboard | Gamepad |
|---|---|---|
| Accelerate / brake | W S or ↑ ↓ | RT / LT (or A / B) |
| Steer | A D or ← → | Left stick |
| Reverse | Hold brake when stopped | Hold LT when stopped |
| Handbrake | Space | RB |
| Look back | B | LB |
| Camera (chase, far, hood, bumper) | C | Y |
| Reset to the track | R | Back |
| Paint colour | P | X |
| Driving help: Easy / Medium / Off | 1 / 2 / 3 | |
| Time of day | T | |
| Mute | M | |
| Pause / help | Esc / H | Start |

## The car

A fictional electric sports coupe, inspired by modern EVs (no real brand names, logos or trademarks).

- **Powertrain:** dual motor, 42/58 front/rear, 560 kW, instant torque up to the grip limit, no gears. About 2.5 s to 100 km/h and 265 km/h flat out. Lifting off the throttle regenerates gently (the power gauge turns green).
- **Chassis:** 1,850 kg, low centre of mass, anti-roll bars, aero drag and downforce. Grass has less grip and much more drag.
- **Driving help** (from g001, default Easy) catches slides: it limits steering to what the tyres can hold and counter-steers when the rear steps out, and the physics damps excess yaw. It never steers you towards the line or brakes for you. Easy and Medium also keep traction control and ABS on; Off is fully raw.
- **Visuals:** a procedural body in the style of the 2026 electric roadster: a low wedge with a flat, faceted hood and V-shaped centre panel, fenders standing proud of the hood, a sharp beltline, a black lower body and a gold-tinted glass canopy. It has a light bar across the nose, hidden headlights, a full-width tail light, a carbon diffuser with suction fans, and an active rear wing. The wing lies flush on the tail until about 80 km/h, then pops up; it trims flat for low drag at very high speed and stands up as an airbrake under hard braking. Through the tinted glass you can see the cabin, with white seats, a dash and a yoke. On High and Ultra the paint and glass reflect the track and sky live. It rides on 20" front and 21" rear wheels with thin black spokes over white aero inserts, shows body roll, pitch and skid marks, and comes in six paint colours. No real brand names or logos.

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
| Renderer, presets, lighting, surfaces | `src/render/renderer.ts`, `graphics.ts`, `environment.ts`, `surfaces.ts` |
| Scenery, car body and model, live reflections, skid marks, cameras | `src/render/trackScene.ts`, `carBody.ts`, `carModel.ts`, `reflections.ts`, `skids.ts`, `cameras.ts` |
| Studio showroom | `src/showroom.ts` |
| Input, audio, crash recovery | `src/core/` |
| HUD and overlays | `src/ui/hud.ts` |
| Game loop (120 Hz physics, interpolated rendering), laps | `src/game.ts` |

Physics runs at a fixed 120 Hz and the renderer interpolates between steps, so the car looks smooth at any frame rate. There are no image or audio files: textures are drawn on canvases and every sound is synthesised with Web Audio.

## Development

```bash
npm run typecheck     # TypeScript
npm run sim-test      # headless handling test: 0-100, top speed, braking, grip, and laps
                      # with a line-following and a keyboard-style driver on each help level
npm run track-check   # circuit length, corner radii and clearances
npm run build         # production build in dist/
npm run browser-test  # (with `npm run dev` running) drives the real game in headless Chromium
                      # and saves screenshots to test-results/
```

## Publishing

The game is published the same way as g001: as its own Cloudflare Worker, `g002-roadster`, on the Delpach account. Static assets serve the game at **kovaforge.org/games/g002/** (a route that takes precedence over the `kovaforge-home` Worker for that path only) and at **roadster.kovaforge.org** (a custom domain). See `wrangler.jsonc` and `worker/index.ts`.

**Automatic deploys on every push to `main`:** add a repository secret named `CLOUDFLARE_API_TOKEN` (GitHub → Settings → Secrets and variables → Actions). The same kind of token as g001 works: the *Edit Cloudflare Workers* template scoped to the Delpach account and the kovaforge.org zone. The workflow in `.github/workflows/deploy.yml` type-checks, runs the handling test, builds and deploys, then checks both addresses. Pull requests run the checks without deploying. To pause deploys, set the repository variable `DEPLOY_DISABLED=true`.

**One-off deploy from your machine:**

```bash
npx wrangler login     # or export CLOUDFLARE_API_TOKEN=...
npm run deploy:kovaforge
```
