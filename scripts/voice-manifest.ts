// Lists every clip the recorded commentator needs (see scripts/gen-voice.py): the fixed phrases
// from the commentary lines, the bots' names, positions, numbers and the cars.
//   npx tsx scripts/voice-manifest.ts > /tmp/manifest.json
import { RIVALS } from '../src/sim/rival';
import { CARS_PLURAL, voicePhrases } from '../src/core/commentary';

const clips = new Set<string>(voicePhrases());
for (const b of RIVALS) clips.add(b.name);
for (let i = 1; i <= 12; i++) { clips.add(`P${i}`); clips.add(String(i)); }
for (const c of Object.values(CARS_PLURAL)) clips.add(c);
process.stdout.write(JSON.stringify([...clips], null, 1));
