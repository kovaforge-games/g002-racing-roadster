// The race commentator: turns what happens in a race into short lines, shown as captions and
// spoken by a pre-recorded British voice (public/voice: every fixed phrase, bot name, position
// and car name is its own small clip, played back to back), or by the browser's speech voice
// when a clip is missing. The game reports one-off events with say() and feeds the running order
// every frame with update(), from which overtakes and lead changes are found. The player is
// "you": the lines talk to you.

export type CommentEvent =
  | 'intro' | 'funIntro' | 'start' | 'overtake' | 'lost' | 'lead' | 'leaderChange' | 'fastest' | 'final' | 'win' | 'podium' | 'finish'
  | 'crash' | 'wrecked' | 'tow' | 'towDone' | 'bigAir' | 'stunt' | 'ring' | 'onFire' | 'mega' | 'turbo' | 'oil'
  | 'boxbox' | 'pitIn' | 'pitStop' | 'pitOut' | 'botPit' | 'status' | 'leading';

export const TRACK = 'Roadster Circuit';

export const LINES: Record<CommentEvent, string[]> = {
  intro: [`Welcome to ${TRACK}! {n} {cars} on the grid, and the crowd is ready.`, `Good afternoon from ${TRACK}, where {n} {cars} are lined up for this one!`],
  funIntro: [`Welcome to Fun Mode at ${TRACK}! Ramps, rings of fire and item boxes everywhere!`, 'It’s Fun Mode! Big jumps, rings of fire and plenty of chaos to come!'],
  start: ['And it’s lights out and away we go!', `Lights out! They’re racing at ${TRACK}!`, 'Go go go! A clean getaway for the whole field!'],
  overtake: ['What a move! You’re past {o} and up to P{pos}!', 'Brilliant! You go round the outside of {o}! P{pos} now!', 'You make it stick on {o}! Up to P{pos}!', 'Past {o}! You’re into P{pos}!'],
  lost: ['{o} gets by you. Down to P{pos}.', 'You lose a place to {o}. P{pos} now.'],
  lead: ['You take the lead! The crowd is on its feet!', `And you are leading the race at ${TRACK}!`],
  leaderChange: ['A new leader! {o} is in front now.', '{o} hits the front of the race!'],
  fastest: ['That’s the fastest lap of the race!', 'Purple sectors everywhere! Fastest lap of the race!'],
  final: ['The white flag is out. Final lap!', `One lap to go here at ${TRACK}!`],
  win: ['You win the race! What a drive!', 'Chequered flag! Victory is yours!', `It’s a win! What a drive at ${TRACK}!`],
  podium: ['P{pos} at the flag. A podium finish!', 'You bring it home in P{pos}. On the podium today!'],
  finish: ['You take the chequered flag in P{pos}.', 'Across the line in P{pos}.'],
  crash: ['Ooh, a big moment there! Into the barrier!', 'Contact with the wall! That will leave a mark.', 'That’s a heavy hit!'],
  wrecked: ['That car is wrecked! Call the tow Roadster!', 'Big crash! That’s the end of the bodywork!'],
  tow: ['Look up! The tow Roadster is on its way, flat out!', 'Here comes the tow Roadster, through the rings of fire!', 'The tow Roadster swoops in to the rescue!'],
  towDone: ['Back on the track! Thank you, tow Roadster!', 'Set down on the road, and off you go again!'],
  bigAir: ['Look at that! You’re flying!', 'Huge air! The crowd loves it!', 'Wheels up! What a jump!'],
  stunt: ['A flip in mid-air! What a stunt!', 'A barrel roll! Incredible!', 'Spinning through the air! The crowd goes wild!'],
  ring: ['Straight through the ring of fire!', 'Through the flames! Brilliant!', 'A perfect line through the ring of fire!'],
  onFire: ['Oh no, you’ve caught fire! Keep out of those flames!', 'The car is on fire! That will hurt the bodywork!', 'Too close to the flames! You’re burning!'],
  mega: ['Mega jump! Up, up and away!', 'A mega jump! Look how high that is!'],
  turbo: ['Turbo! Look at it go!', 'Turbo on! Hold on tight!'],
  oil: ['Oil on the track! Watch out behind!', 'An oil slick! That’s sneaky!'],
  boxbox: ['Box, box! Your tyres are worn out. Pit this lap!', 'The crew are calling you in. Box this lap for fresh tyres!'],
  pitIn: ['Into the pit lane you come! Watch that speed limit.', 'You dive into the pits!'],
  pitStop: ['The crew are all over the car! Fresh tyres going on.', 'Wheel guns screaming! New tyres for you.'],
  pitOut: ['Great stop! Away you go!', 'Lightning fast from the crew! Back out you go!'],
  botPit: ['{o} comes into the pits.', 'Pit stop for {o}! New tyres going on.', 'Into the pit lane comes {o}.'],
  status: ['You’re running in P{pos}, with {o} just ahead.', 'P{pos} at the moment. Can you catch {o}?', `{l} leads the way here at ${TRACK}. You’re P{pos}.`, `What a crowd here today at ${TRACK}!`],
  leading: ['You still lead. Can anyone catch you?', 'A great drive so far, out in front.', 'You’re controlling this race from the front.'],
};

/** a line as pre-recorded voice pieces: fixed phrases and the {slots} between them */
export type VoicePart = { text: string } | { slot: string };
export function voiceParts(raw: string): VoicePart[] {
  const out: VoicePart[] = [];
  for (const piece of raw.split(/(P\{pos\}|\{\w+\})/)) {
    if (!piece) continue;
    const m = /^P?\{(\w+)\}$/.exec(piece);
    if (m) out.push({ slot: piece.startsWith('P') ? 'Ppos' : m[1] });
    else if (/[\p{L}\p{N}]/u.test(piece)) out.push({ text: piece.trim() });
  }
  return out;
}

/** every fixed phrase the recorded commentator needs (scripts/voice-manifest.ts adds the names) */
export function voicePhrases() {
  const set = new Set<string>();
  for (const raw of Object.values(LINES).flat()) for (const p of voiceParts(raw)) if ('text' in p) set.add(p.text);
  return [...set];
}

/** the cars, plural, as the intro says them */
export const CARS_PLURAL: Record<string, string> = {
  roadster: 'Roadsters', model3: 'Model 3s', modelx: 'Model Xs', models: 'Model Ss', modely: 'Model Ys', cybertruck: 'Cybertrucks', cybercab: 'Cybercabs', semi: 'Semis',
};

/** most important first: a high-priority line may cut in on a lower one */
const PRIORITY: Record<CommentEvent, number> = {
  status: 1, leading: 1, lost: 3, botPit: 3, ring: 3, turbo: 3, oil: 3, overtake: 4, bigAir: 4, stunt: 4, mega: 4, onFire: 5, crash: 5, pitIn: 5, pitStop: 5, pitOut: 5, towDone: 5, fastest: 5,
  leaderChange: 6, final: 6, tow: 6, wrecked: 6, lead: 7, intro: 7, funIntro: 7, start: 8, finish: 8, podium: 8, boxbox: 8, win: 9,
};

/** how many seconds of crowd cheering each line adds */
const CHEER: Partial<Record<CommentEvent, number>> = { start: 4, lead: 4, win: 5, podium: 4, overtake: 2.5, bigAir: 3, stunt: 3, ring: 1.5, leaderChange: 2, fastest: 2, finish: 3, tow: 2 };

export interface CommentaryOut {
  caption(text: string): void;
  /** say a line from recorded pieces; resolves false if a piece is missing */
  speakClips(texts: string[], excite: number): Promise<boolean>;
  /** the browser's speech voice */
  speak(text: string, excite: number): void;
  cheer(seconds: number): void;
}

export interface Runner { name: string; pos: number; player: boolean }

export class Commentator {
  private t = 0;
  private busyUntil = 0;
  private lastPri = 0;
  private lastSaid = new Map<CommentEvent, number>();
  private queue: { ev: CommentEvent; text: string; clips: string[] | null; at: number }[] = [];
  private prevPos = -1;
  private leader = '';
  private pick = 0;
  private lastEmit = 0;
  /** speak (or only show captions) */
  voice = true;

  constructor(private out: CommentaryOut) {}

  say(ev: CommentEvent, vars: Record<string, string | number> = {}) {
    // not the same kind of line too often (the big moments can come round again sooner)
    const last = this.lastSaid.get(ev);
    if (last !== undefined && this.t - last < (PRIORITY[ev] >= 6 ? 3 : 9)) return;
    this.lastSaid.set(ev, this.t);
    const opts = LINES[ev];
    const raw = opts[(this.pick++ * 7 + Math.floor(Math.random() * opts.length)) % opts.length];
    const v: Record<string, string> = {};
    for (const [k, x] of Object.entries(vars)) v[k] = String(x);
    const text = raw.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');
    const c = CHEER[ev];
    if (c) this.out.cheer(c);
    const clips = this.clipsFor(raw, v);
    if (this.t >= this.busyUntil || PRIORITY[ev] > this.lastPri + 1) this.emit(ev, text, clips);
    else {
      this.queue.push({ ev, text, clips, at: this.t });
      this.queue.sort((a, b) => PRIORITY[b.ev] - PRIORITY[a.ev]);
      this.queue.length = Math.min(this.queue.length, 2);
    }
  }

  /** the line as a list of recorded clip texts, or null if a slot is empty */
  private clipsFor(raw: string, v: Record<string, string>): string[] | null {
    const out: string[] = [];
    for (const part of voiceParts(raw)) {
      if ('text' in part) { out.push(part.text); continue; }
      const val = v[part.slot === 'Ppos' ? 'pos' : part.slot];
      if (val === undefined || val === '') return null;
      out.push(part.slot === 'Ppos' ? `P${val}` : val);
    }
    return out;
  }

  private emit(ev: CommentEvent, text: string, clips: string[] | null) {
    this.lastEmit = this.t;
    const excite = Math.min(1, PRIORITY[ev] / 9);
    this.out.caption(text);
    if (this.voice) {
      if (clips) void this.out.speakClips(clips, excite).then(ok => { if (!ok) this.out.speak(text, excite); });
      else this.out.speak(text, excite);
    }
    // rough speaking time: about 14 characters a second
    this.busyUntil = this.t + Math.max(2.2, text.length / 14);
    this.lastPri = PRIORITY[ev];
  }

  /** per frame: the running order (null outside a race) */
  update(dt: number, runners: Runner[] | null) {
    this.t += dt;
    if (this.t >= this.busyUntil && this.queue.length) {
      const q = this.queue.shift()!;
      if (this.t - q.at < 5) this.emit(q.ev, q.text, q.clips);
    }
    if (!runners) return;
    const byPos = [...runners].sort((a, b) => a.pos - b.pos);
    const me = runners.find(r => r.player);
    if (me) {
      const was = this.prevPos;
      if (was > 0 && me.pos !== was) {
        if (me.pos < was) {
          if (me.pos === 1) this.say('lead');
          else this.say('overtake', { o: byPos[me.pos]?.name ?? '', pos: me.pos });
        } else this.say('lost', { o: byPos[me.pos - 2]?.name ?? '', pos: me.pos });
      }
      this.prevPos = me.pos;
      // fill the quiet stretches with a running update
      if (this.t - this.lastEmit > 22 && this.t >= this.busyUntil) {
        if (me.pos === 1) this.say('leading');
        else this.say('status', { pos: me.pos, o: byPos[me.pos - 2]?.name ?? '', l: byPos[0]?.name ?? '' });
        this.lastEmit = this.t;
      }
    }
    const lead = byPos[0];
    if (lead && this.leader && lead.name !== this.leader && !lead.player) this.say('leaderChange', { o: lead.name });
    if (lead) this.leader = lead.name;
  }

  /** forget the order (the start, so the grid isn't commentated) and anything queued */
  reset() { this.prevPos = -1; this.leader = ''; this.queue = []; this.busyUntil = 0; this.lastSaid.clear(); }
}
