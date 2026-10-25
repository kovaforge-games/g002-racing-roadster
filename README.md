# Roadster (g002)

A 3D browser racing game starring the Tesla Roadster and seven more Teslas, built with **three.js** and **Rapier** physics. Race up to 11 AI bots at five difficulty levels, with cold-gas thrusters for boosts, hops and flips, real pit stops, a race commentator, a chase camera, and handling tuned to feel good on a keyboard or a gamepad. Time trial and practice let you drive alone and chase your best lap. Party races pit you against up to seven friends: make a party, and they join by scanning its QR code or typing its 6-digit code.

It builds on [g001 (Grand Prix Racer)](https://github.com/l4mb0lion/g001-racing): the driving help, input handling, graphics presets, lighting, surface shaders, camera rig, crash recovery, synthesised audio and the AI drivers all come from there, adapted for an EV and for Rapier.

## Play online

Private, invite only. Friends get a personal invite link from Mike; without a valid invite every address returns a plain 404, and the game is never indexed (robots.txt disallows everything and every response sends `X-Robots-Tag: noindex, nofollow, noarchive`). The game needs WebGL 2 and runs in Chrome, Edge, Firefox and Safari.

## Play locally

```bash
npm install
npm run dev            # http://localhost:5173
npm run party-server   # in a second terminal, for party races (Vite passes /ws through to it)
```

**Showroom:** open `?showroom` or `#showroom` (or use the link on the home screen) to see the car on a turntable in a studio. Drag to look around, scroll to zoom, and press P for paint, S for the spoiler, N for the lights and Enter to drive. `?showroom&car=cybertruck` shows another car (`roadster`, `model3`, `modelx`, `models`, `modely`, `cybertruck`, `cybercab` or `semi`).

Useful URL options: `?quality=low|medium|high|ultra` overrides the automatic graphics preset, `?tod=morning|noon|sunset|night` picks the time of day, `?autodrive` lets the autopilot drive (a demo lap), and `?safe` starts in safe graphics.

## Racing

The home screen lists every mode: **Quick Race**, **Race Weekend**, **Fun Mode**, **Championship**, **Licenses**, **Time Trial**, **Practice**, **Garage**, **Replays** and **Settings**, with **Make party** and **Join party** below. Replays is still being built and says what's coming. Arrow keys move between the buttons and Esc goes back.

- **Quick Race:** pick the car, the time of day (morning, noon, sunset or night), the difficulty (Newbie, Beginner, Club, Expert or Pro), how many opponents (1 to 11) and how many laps (1 to 10), then press Start. You start towards the back of a staggered grid (fifth of six with 5 opponents). The standings panel (top right) shows your position, the lap and the gaps, and the bots appear as coloured dots on the map. The race setup is remembered.
- **Race Weekend:** the same setup, then free practice (drive as long as you like, then pause and pick **Go to qualifying**), qualifying (your best of 2 laps sets your grid slot against the bots' times) and the race from that grid.
- **Fun Mode:** a race on a course full of stunts, like g001's Fun Mode. See [Fun Mode](#fun-mode).
- **Pit stops:** see [Pit stops](#pit-stops). **Commentary:** see [The commentator](#the-commentator).
- **Championship** and **Licenses:** see [Classes and career](#classes-and-career).
- **Time Trial:** alone from a standing start for the laps you pick; the results show every lap and your record for that car and number of laps.
- **Practice:** drive alone with no countdown, as many laps as you like.

Races and time trials start with a **5 second countdown**: a red light comes on each second as the number counts down from 5 to 1, then the lights go out. In a session the **pause button** (top centre, or Esc) opens the pause menu: **Resume**, **Restart**, **Finish session** (ends it now; drivers still racing get an estimated time from their pace), **Settings** and **Quit to menu**. After the flag the autopilot takes a cool-down lap while the results come in, with **Race again** and **Menu**.

**Settings** (from the home screen or the pause menu, saved in the browser): driving help, camera, graphics preset (applies on reload) and sound.

The bots are Lionelinni Bannanini, Gunvini Uvinini, Ramanini Banannini, Arvinini Chegenini, Jakobini Chananini, Joaquinini Borquezini, Orionini Siuinini, Jakeinnini Bananinni, Asherinini Basketballini, Danielini Caperrinini and Nico the Bird (bots 1 to 11; a race with fewer opponents takes the first ones). Each has their own pace, aggression and consistency, and the difficulty scales all three: Newbie bots are about 15% slower than Pro bots and make far more mistakes. They are g001's bot drivers adapted for this car: they follow a racing line at a speed set by the corners ahead, pass and follow in traffic, learn where they can push harder each lap, make the odd mistake, and recover from spins. They use the thrusters too: boost on the straights, hop a slow car in their lane, and swing through the air canisters when their tank runs low. Bots well behind you push a little harder and ones far ahead ease off (more on the easier levels), so the racing stays close. Cars collide with each other, and tailgating a boosting car is a bad idea: its jet wash shoves you back. Name tags over the bots show their position, and you hear their jets when they boost close by.

**Slipstream:** two car lengths or more behind another car you get a tow (up to about a quarter less drag, so you close in on the straights and the HUD says so), but its dirty air also takes some downforce away in the corners.

## Fun Mode

Fun Mode is a race on Roadster Circuit with stunts built in, after g001's Fun Mode. Every car is open to try, and the setup has on/off switches for the rings of fire, the ramps and pads, and the item boxes.

- **Red ramps:** seven of them round the lap: a full-width kicker on the main straight that throws you about 4 to 5 m up for over a second and a half, more full-width and half-width ramps after the corners, and rings of fire hanging on the flight line of three of them. Each ramp's height is worked out from your car's speed, so every car (even the Semi) lands back on the road. The deck is red with chevrons, the sides are neon pink and the lip glows cyan.
- **Rings of fire:** eleven on the road to drive through, and four raised ones hanging from gantries that you jump through with the underbody jets. Many of them sway from side to side or pulse smaller and bigger, so you have to time them. Through the middle scores 100 (road), 150 (raised) or 250 (the ramp ring) points, plus a quick boost; rings in a row are worth 25% more each. Brush the flames and the car catches fire: it slows, the streak ends, flames lick off the bodywork for three seconds and the paint is left sooty. Every burn damages the car, and three burns wreck it (the tow comes). Driving under a raised ring singes the car too.
- **Neon borders:** rainbow strips flow along both edges of the road and along the barriers all the way round.
- **Boost pads** on the exits of the five slowest corners, on the racing line.
- **Item boxes:** four rows of spinning rainbow boxes. Drive through one for an item, then press **F** (or **ITEM** on a touch screen, or d-pad up) to use it: **Turbo**, **Triple Turbo** (three shorter boosts), **Oil Slick** (dropped behind you; a car that hits it spins) and **Mega Jump**.
- **Stunt points:** big air, flips, barrel rolls and 360s, and slide boosts (hold a slide for a burst of speed). The panel on the left shows your item, stunt points and rings; the results show everyone's points, and your best for each car is saved.

The bots join in: they decide which rings to go for, jump the raised ones, pick up boxes and use their items where it suits them (turbos on straights, oil when someone is close behind).

## Garage

The **Garage** tile opens the garage with your car beside it. Every change shows on the car straight away and is saved in the browser:

- **Paint:** the twelve colours or any colour you pick, and the finish: factory, gloss, metallic, matte, pearl or chrome.
- **Livery:** solid, racing stripes, a side stripe, two-tone or hot-rod flames, with a second colour; your race number (1 to 99) in a roundel on the doors and bonnet, or no number.
- **Rims:** aero, open spoke or painted, in any colour (black, silver, gold, white, red, neon blue, neon green, neon pink or your own).
- **Rear wing:** active (the standard one), a fixed high wing (more downforce, more drag) or a ducktail (less drag, less grip at speed).
- **Tyres:** road, sport (5% more grip, but they heat up faster) or drift (less rear grip, easy slides).
- **Glass tint** and **underglow** (cyan, pink, lime, purple or orange; brightest at night).

The wing and tyres change the handling. The other Teslas wear your paint, livery and rim colour but have no rear wing. The bots have liveries and parts of their own.

## Classes and career

There are eight Teslas. Pick one in the **Car** row before a race; a locked one says how to earn it. Every car has its own 3D body, size, weight and handling, and the bots in a race drive the same car as you.

| Car | What it is | How you get it |
|---|---|---|
| **Roadster** | Where everyone starts: forgiving, with an active wing that brakes for you. 290 kW, 215 km/h. | Yours from the start |
| **Model 3** | Light, low and sharp on turn-in. 390 kW, 262 km/h. | Earn the National B license |
| **Model X** | A heavy SUV with three motors that pulls like nothing else off the line. 750 kW, 262 km/h. | Top 3 in the Model 3 Championship |
| **Model S** | The fastest car in the game, with the grip to use it. 760 kW, 322 km/h. | Top 3 in the Model X Championship |
| **Model Y** | The family crossover: taller and softer than the 3 but still quick. 340 kW, 250 km/h. | Free from the start |
| **Cybertruck** | Three tonnes of stainless steel: brake early and lean on it. 630 kW, 209 km/h. | Free from the start |
| **Cybercab** | The two-seat robotaxi with a steering wheel put back in: small, light and nimble. 200 kW, 190 km/h. | Free from the start |
| **Semi** | The tractor unit, no trailer: eight tonnes, slow to stop and slow to turn, and nothing pushes it about. 800 kW, 150 km/h. | Free from the start |

**What they look like:** every car is modelled on the real one, to its published length, width, height and wheelbase. The Roadster, Model 3, Y, S and X, the Cybercab and the Semi's cab share one smooth body builder: sections with flat floors, sides that bulge and lean in to a rounded shoulder, and a crowned top, lofted along side and plan profiles, with round wheel openings cut out of the sides and a glasshouse lofted on the shoulders. Each gets the real car's signature details: the Roadster's raised front wings, black glass canopy and wide haunches; the 3's slim swept headlamps and C-shaped tail lamps; the Y's light bars across the nose and tail with headlamps low in the bumper; the S's bright window trim and painted roof; the X's panoramic windscreen and the seam between its falcon-wing doors; the Cybercab's light bars, painted fastback and covered wheels; and the Semi's bullet-train windscreen, nose light bar, cab extenders, battery skirts and tandem drive axles. The Cybertruck is built from flat-sided sections and flat shaded like its stainless panels: one straight line from the nose to the apex and down to the bed, light bars along the nose and tailgate, and square-cut arches with dark flares. No grilles, badges or logos.

Each car carries a race number: the bots carry their own (bot 1 to bot 11), you are number 12. Every rival is a copy of your car's model in its own paint and number. Old saves move to the new cars (the Rental becomes the Roadster, the 0x1.5 the Model 3, the 0x2.5 the Model X and the 0x3.5 the Model S).

**Licenses:** National B (in the Model 3), National A (in the Model X) and International A (in the Model S). Each has five tests: drive from gate **A** to gate **B** from a standing start inside the target times. The briefing gives a tip and the gold, silver and bronze times, and a panel shows the clock as you drive. Leaving the road, going the wrong way or resetting fails the test, and the thrusters are off. Silver or better in all five earns the license and opens the next one; National B also gives you the Model 3. The targets come from a reference driver (the bots' line and braking at full pace, without mistakes): gold is 2% slower than it, silver 7% and bronze 15%.

**Championship:** the Model 3 Championship (3 races) and the Model X Championship (4 races), each against 7 bots at the difficulty you pick. Points go 25, 18, 15, 12, 10, 8, 6, 4, 2, 1; ties go to more wins. After each race, **Standings** shows the table; a championship in progress is saved, so you can **Continue** it later. Finish in the top 3 overall to earn the next car.

Progress (cars, medals, licenses, championships) is saved in the browser. Add `?unlock` to the address to open everything for testing.

## Controls

The thruster controls follow [Road Thruster](https://roadthruster.versezero.com/)'s "jump, hover and flip with side thrusters": Space jumps and holding it hovers, and Q and E fire the side thrusters.

| Action | Keyboard | Gamepad |
|---|---|---|
| Accelerate / brake | W S or ↑ ↓ | RT / LT |
| Steer | A D or ← → | Left stick |
| Reverse | Hold brake when stopped | Hold LT when stopped |
| Boost (rear jets) | Shift | B |
| Jump (underbody jets); hold to hover | Space or Enter | A |
| Side thrusters: dodge sideways on the road, flip in the air | Q / E | LB / RB |
| In the air: pitch / yaw | W S / A D | Left stick |
| In the air: roll with the steering | Hold X + A D | Hold X + left stick |
| Handbrake | X or Ctrl | X |
| Look back | B | Left stick click |
| Camera (chase, far, hood, bumper) | C | Y |
| Call the tow (back to the track) | R | Back |
| Use item (Fun Mode) | F | D-pad up |
| Paint colour | P | |
| Driving help: Easy / Medium / Off | 1 / 2 / 3 | |
| Time of day | T | |
| Mute | M | |
| Pause menu / help | Esc (or the pause button) / H | Start |

## iPad and phones

On a touch screen the game shows touch controls by itself (Settings → Touch controls can force them on or off):

- **Right side:** a tall **gas** pedal and a **brake** pedal (hold brake when stopped to reverse). Above them, the **gear, RPM and km/h**. Beside them, the **four tyres** in their places on the car, each showing its temperature: **blue** when cold, **yellow** when warm and **red** when hot. Above them, the thruster buttons: **◀◀ ▶▶** (side thrusters), **JUMP** (hold to hover) and **BOOST**.
- **Left side:** steering, picked in Settings → Steering:
  - **Slider** (the default): put your thumb anywhere on the bar and slide; let go and the wheels straighten.
  - **Buttons:** hold left or right; steering ramps in like the keyboard.
  - **Tilt:** tilt the iPad like a steering wheel. However you hold it when the countdown starts is straight ahead. iPad asks for motion access the first time you pick it.

## Steering wheel and tyres

The steering wheel at the bottom of the screen turns with your steering, and its screen shows the **gear** (D, or R when backing up: the car has one gear), the **motor RPM** and **km/h**. On a laptop the tyre panel above the dash shows the four tyre temperatures.

Each tyre has its own temperature. Tyres leave the blankets at 45 °C (blue). Rolling under load, sliding, braking and accelerating warm them, and the air cools them, faster at speed and much faster once they are very hot. The air temperature follows the time of day. A normal lap brings them into the yellow (55-100 °C). Because the outside tyres in a corner and the fronts under braking work hardest, every tyre runs at a different temperature, and pushing hard or sliding turns some of them red. Overheated tyres (above 105 °C) lose a little grip.

## Party races

- **Make party** on the home screen makes a party straight away and shows a **QR code** and a **6-digit code**. Friends scan the QR code with a phone camera, which opens the game and joins the party, or pick **Join party** and type the code (`?code=123456` in the address does the same).
- Up to 8 drivers. The lobby lists everyone with their paint colour (each driver gets a different one), lets you change your name, and the host picks the number of laps (1 to 10) and presses **Start race**.
- The AI rivals step aside: everyone lines up on a staggered grid, the server runs the 5 second countdown so the lights go out together, and the friends' cars show up on track with name tags, on the minimap, and in the standings. Each race is timed from lights out; after the first driver finishes the others have 60 seconds. Results go back to the lobby, ready for the next race.
- In a race Esc or the pause button opens a menu (the race keeps going) with **Settings** and **Leave party**; leaving brings the AI rivals back. A dropped connection rejoins by itself within 10 seconds. Friends who join during a race wait in the lobby for the next one. If the host leaves, the next driver becomes host.
- Each game simulates its own car and shares its position 20 times a second; the other cars are drawn 100 ms behind so their motion is smooth. They are ghosts for now: cars don't collide with each other.

## The car

A fictional electric sports coupe, inspired by modern EVs (no real brand names, logos or trademarks).

- **Powertrain:** dual motor, 42/58 front/rear, 560 kW, instant torque up to the grip limit, no gears. About 2.5 s to 100 km/h and 265 km/h flat out. Lifting off the throttle regenerates gently (the power gauge turns green).
- **Chassis:** 1,850 kg, low centre of mass, anti-roll bars, aero drag and downforce. Grass has less grip and much more drag.
- **Driving help** (from g001, default Easy) catches slides: it limits steering to what the tyres can hold and counter-steers when the rear steps out, and the physics damps excess yaw. It never steers you towards the line or brakes for you. Easy and Medium also keep traction control and ABS on; Off is fully raw.
- **Visuals:** the second-generation Tesla Roadster: a low 2+2 with a long nose, front wings standing proud of the bonnet, slim swept headlamps, a black glass canopy (windscreen, targa roof and rear window) with sail panels sweeping down into wide rear haunches, swept tail lamps and a ducktail. The active rear wing lies flush on the ducktail until about 80 km/h, then pops up; it trims flat for low drag at very high speed and stands up as an airbrake under hard braking. On High and Ultra the paint and glass reflect the track and sky live. It rides on 20" front and 21" rear wheels with thin black spokes over white aero inserts, shows body roll, pitch and skid marks, and comes in twelve paint colours (or any colour, finish and livery in the [Garage](#garage)). No real brand names or logos.

## Thrusters and the air tank

The car carries cold-gas thrusters fed by one compressed-air tank (the HUD's AIR gauge). Nothing burns: the jets vent white vapour.

- **Boost:** rear jets add about 0.9 g of thrust (0-100 km/h drops from 2.5 s to 1.4 s) and push the car past its normal top speed, up to about 340 km/h. A full tank lasts about 4 seconds of boost. Hit boost within 0.3 s of the lights going out for a free **perfect launch**.
- **Jump:** a burst from the underbody jets lifts the car about 2.2 m for 1.3 s of air time. It costs a fifth of the tank and has a short cooldown (the dot under the gauge).
- **Hover:** keep holding jump and, near the top of the jump, the underbody jets take most of the car's weight and soak up the fall, so it floats down slowly. Hovering drains the tank (a full tank lasts about 3 seconds).
- **Side thrusters:** on the road, a quick sideways dodge (about 4.5 m/s, a small part of the tank, short cooldown). In the air, holding one rolls the car that way: a flip.
- **Air control:** in the air, throttle and brake (or the stick) pitch the car, steering yaws it, the side thrusters roll it, and holding the handbrake turns steering into roll too. Inputs you were already holding at take-off are ignored until you let go, so a hop at full throttle stays level. Flips, barrel rolls and 360s get called out, and a wheels-down landing gives a small kick of speed. With driving help on, the car eases itself back to wheels-down when the sticks are centred.
- **Refilling:** the tank never refills by itself. Six rows of glowing air canisters sit off the racing line around the lap (cyan dots on the map); each one adds 12% and comes back 8 seconds after it is taken.
- The debris fence on the barriers is solid, so a hop can't clear the circuit.

## Pit stops

The pit lane runs along the right of the main straight, behind a pit wall, with a garage and a painted box for every car. Turn right at the **PIT IN** board just after the line, keep to the 80 km/h limit (the limiter holds you to it and the HUD shows **PIT LIMITER**), and stop in your box, which is in front of your grid slot's garage. The crew run out with wheel guns, jacks and a lollipop: they fit fresh tyres, fix the bodywork and top up the air tank. The panel on the left shows the stop's progress and what's being done. A tyre change takes about 2.4 s and repairs add up to 4.5 s more. When the lollipop lifts, drive down the lane and rejoin at **PIT OUT**.

Tyres wear as you race, faster when you slide, brake hard or spin the wheels. The tread bar under the tyre panel shows what's left. Fresh tyres have full grip for the first fifth of their life, then lose grip steadily (up to a fifth of it when they are finished), so a race of five laps or more is quicker with a stop. In races of four laps or more every bot plans one stop, and a badly damaged bot comes in for repairs.

## The commentator

A British commentator calls your races: the start, overtakes (yours and others'), the lead changing hands, crashes, the tow, big air and stunts, rings of fire, catching fire, items, pit stops (and when the crew want you in for tyres), the fastest lap, the final lap and the finish. He fills the quiet stretches with how the race is going. Every line shows as a caption above the steering wheel, the car sounds drop a little while he talks, and the crowd cheers the big moments (you can see the grandstand jump). Settings → **Commentary** picks **Voice**, **Captions** (no voice) or **Off**.

The voice is recorded ahead of time: every fixed phrase, bot name, position and car name is its own small clip in `public/voice` (about 1.6 MB), and a line is played as clips back to back. `scripts/voice-manifest.ts` lists what's needed and `scripts/gen-voice.py` records it with the open [Kokoro](https://github.com/hexgrad/kokoro) TTS model (voice `bm_george`). If a clip is missing the browser's own speech voice reads the line.

## Crashes and the flying tow

The bodywork takes damage in four zones: front, rear, left and right. A hit is the sudden change in the car's speed when it strikes the barrier or another car. Kerbs, landings, gentle nudges and scrapes along the wall leave no mark. A head-on hit at about 50 km/h dents the front badly, and one at about 90 km/h wrecks it. The panels crumple in where the car was hit, and shards of paint, trim and lens fly off with a shower of sparks. A badly damaged car smokes, loses up to 40% of its power, and a bent front corner pulls the steering towards it. The CAR meter next to the air gauge shows each zone going from green through yellow to red.

When the car is wrecked, on its roof, lost far off the circuit, or when you press reset, a **flying tow Roadster** comes for it, fast: it dives in, hooks on and has you back on the road in a few seconds, leaving a contrail. The tow car is recovery orange, with its wheels folded flat into hover pods, blue jets, and amber beacons. It swoops down from the sky, hovers over the wreck, lowers a cable and hooks the car. Then it carries the car back over the circuit and sets it down on the road facing the right way, repaired and ready to drive. As you pull away, it flies on ahead through three rings of fire above the track and climbs back into the sky. The rivals' cars dent too, and the race fixes them up when it puts them back on the road.

**Realism:** tyres smoke when they slide or spin, grass and dirt fly up when you run wide, sparks come off a hard landing or a scrape along the wall, and the circuit has braking boards (300, 200 and 100 m) before the five heaviest braking zones, marshal posts with orange flags around the lap, advertising boards along the barriers and flags on the grandstand roof.

## The circuit

Roadster Circuit is a 2.5 km loop with a 500 m main straight, hairpins, esses and fast sweepers, and gentle elevation changes (about ±6 m). Kerbs line every corner, concrete barriers and a debris fence run the whole lap, and the main straight has a grandstand, a start gantry with lights, a charging pavilion and the pit lane. The landscape rolls into forested hills and snow-capped mountains.

## How it works

| Area | Files |
|---|---|
| Circuit centreline, elevation, kerbs | `src/sim/track.ts` |
| Terrain height grid (road kept flat across) | `src/sim/terrain.ts` |
| Rapier world: heightfield + barrier boxes | `src/sim/world.ts` |
| Car physics (ray-cast vehicle, EV powertrain, aero, assists, tyre temperatures) | `src/sim/car.ts` |
| Driving help (input side) | `src/sim/assist.ts` |
| Grass and kerbs | `src/sim/surface.ts` |
| Autopilot (tests and demo) | `src/sim/autopilot.ts` |
| Thrusters and air tank; air canisters | `src/sim/jets.ts`, `src/sim/canisters.ts` |
| Renderer, presets, lighting, surfaces | `src/render/renderer.ts`, `graphics.ts`, `environment.ts`, `surfaces.ts` |
| Scenery, the Roadster's model (wheels, wing) and the shared body tools, live reflections, skid marks, cameras | `src/render/trackScene.ts`, `carModel.ts`, `carBody.ts`, `reflections.ts`, `skids.ts`, `cameras.ts` |
| Vapour puffs and jet cones; canisters; fast copies of the car model for rivals; name tags | `src/render/vapour.ts`, `canisterScene.ts`, `cloneModel.ts`, `nameTag.ts` |
| Fun Mode course (ramps, rings of fire, pads, boxes), scoring, items and the bots' choices | `src/sim/fun.ts` |
| Fun Mode on screen: red ramps, flames and smoke, gantries, neon borders, boxes and pads; a stand-alone `FireRing` | `src/render/funScene.ts` |
| Garage: saved choices, the wing and tyres on the physics car; the garage screen | `src/core/garage.ts`, `src/ui/garage.ts` |
| Liveries and paint finishes (drawn in the paint shader, no UVs) | `src/render/livery.ts` |
| Tyre smoke, dust and sparks; braking boards and marshal posts | `src/render/effects.ts`, `trackside.ts` |
| Studio showroom | `src/showroom.ts` |
| Input, audio, crash recovery | `src/core/` |
| HUD and overlays | `src/ui/hud.ts` |
| Home screen, race setup, settings, pause menu; saved settings | `src/ui/menu.ts`, `src/core/settings.ts` |
| Touch controls: pedals, slider/buttons/tilt steering, readout and tyres | `src/ui/touch.ts` |
| Racing line and speed profile; AI rivals; the race (grid, laps, positions) | `src/sim/racingLine.ts`, `rival.ts`, `race.ts` |
| Race classes; championships; licenses and their targets; race weekend qualifying | `src/sim/classes.ts`, `championship.ts`, `licenses.ts`, `weekend.ts` |
| The Tesla bodies (the shared lofted body and glasshouse builder, every car's shape, the Cybertruck's flat panels, the Semi's chassis); the model for each car; license gates | `src/render/teslaModel.ts`, `models.ts`, `gates.ts` |
| Pit lane, limiter, stops and tyre wear; the pit lane, garages and crews on screen | `src/sim/pits.ts`, `src/sim/car.ts`, `src/render/pitScene.ts` |
| The commentator's lines and when he says them; the recorded clips | `src/core/commentary.ts`, `src/core/audio.ts`, `public/voice/`, `scripts/voice-manifest.ts`, `scripts/gen-voice.py` |
| Saved career progress (cars, medals, licenses, championships) | `src/core/progress.ts` |
| Reference times for the license targets and the bots' qualifying laps | `scripts/license-times.ts` |
| Crash damage zones; the tow's flight | `src/sim/damage.ts`, `tow.ts` |
| Dents; debris, sparks and smoke; the tow car, its cable and the rescue camera; rings of fire; the damage meter | `src/render/damage.ts`, `damageFx.ts`, `towScene.ts`, `fireRing.ts`, `src/ui/damageHud.ts` |
| Game loop (120 Hz physics, interpolated rendering), sessions, countdown, laps, party races | `src/game.ts` |
| Party server: lobby, codes, start lights, state relay, results | `server/party-core.ts` (shared), `worker/index.ts` (Durable Object), `server/server.ts` (local) |
| Party client, screens with the QR code, the friends' cars | `src/net/party.ts`, `src/ui/partyUi.ts`, `src/render/remoteCars.ts` |

Physics runs at a fixed 120 Hz and the renderer interpolates between steps, so the car looks smooth at any frame rate. There are no image files: textures are drawn on canvases. Every sound is synthesised with Web Audio except the commentator's voice clips.

## Development

```bash
npm run typecheck     # TypeScript
npm run sim-test      # headless handling test: 0-100, top speed, braking, grip, boost, hops,
                      # air control, laps with a line-following and a keyboard-style driver,
                      # a full 3-lap race against 5 bots, 11 bots at Newbie and at Pro,
                      # crash damage from barrier hits, the tow's whole flight, and Fun Mode
                      # (every ramp jump for every class, rings, items, slipstream, a fun race)
npm run track-check   # circuit length, corner radii and clearances
npm run build         # production build in dist/
npm run browser-test  # (with `npm run dev` running) drives the real game in headless Chromium,
                      # keyboard and iPad controls, the Garage and Fun Mode, and saves
                      # screenshots to test-results/
npm run crash-shots   # (with `npm run dev` running) a crash into the barrier and the tow, in
                      # screenshots saved to test-results/
npm run party-test    # party server: create, join by code, start lights, state relay, results
npm run party-browser-test   # (with dev + party-server running) three browsers: create a party,
                      # join by the QR link and by typing the code, race, results
```

## Publishing

The game is published the same way as g001: as its own Cloudflare Worker, `g002-roadster`, on the Delpach account. Static assets serve the game on its route (see `wrangler.jsonc`; it takes precedence over the `kovaforge-home` Worker for that path only). Each party runs in its own Durable Object (`PartyRoom`, SQLite-backed, which the Workers Free plan includes), reached over a WebSocket at `/games/g002/ws`; the Worker picks a random 6-digit code and tries another if that room is still in use. See `wrangler.jsonc` and `worker/index.ts`. `npx wrangler dev` runs the Worker and its Durable Objects locally (after `npm run build:kovaforge`), and `npm run party-test -- ws://localhost:8787/ws` tests it.

**Invite gate:** `worker/invite.ts` runs before anything else on every host and path, including the party WebSocket. Opening the game with `?invite=<code>` matching the `INVITE_CODE` Worker secret sets a 30 day HttpOnly cookie (an HMAC of the code, never the code itself) and redirects to the same address without the code. Set or rotate the code with `npx wrangler secret put INVITE_CODE`; rotating it signs everyone out. With no secret set, everything is a 404. Tests: `npm run worker-test`.

**Party passes:** a phone that scans a party QR code has no invite yet, so the QR link also carries `&pass=`, a pass for that one party signed with `INVITE_CODE` (the game asks the Worker for it at `party-pass?code=`). Opening it sets a guest cookie that lasts as long as the pass (12 hours) and keeps `?code=`, so the phone goes straight into the party. A guest's own party QR codes carry passes that end when theirs does, so nobody stays in longer than the first pass; rotating `INVITE_CODE` ends every pass and guest cookie. To try the whole flow through the real Worker, put a test code in `.dev.vars` (`INVITE_CODE=...`, git-ignored), run `npm run build:kovaforge` and `npx wrangler dev --port 8790`, then `npm run qr-join-test`.

**Automatic deploys on every push to `main`:** add a repository secret named `CLOUDFLARE_API_TOKEN` (GitHub → Settings → Secrets and variables → Actions). The same kind of token as g001 works: the *Edit Cloudflare Workers* template scoped to the Delpach account and the kovaforge.org zone. The workflow in `.github/workflows/deploy.yml` type-checks, runs the handling test, builds and deploys. Pull requests run the checks without deploying. To pause deploys, set the repository variable `DEPLOY_DISABLED=true`.

**One-off deploy from your machine:**

```bash
npx wrangler login     # or export CLOUDFLARE_API_TOKEN=...
npm run deploy:kovaforge
```
