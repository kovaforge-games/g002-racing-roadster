// Synthesised audio (no sample files, following g001's approach): an electric motor whine that
// rises with speed, inverter whistle under load, tyre squeal, wind, kerb rumble and impacts,
// plus the thrusters: a hiss that drops in pitch as the tank empties, hop blasts and pickups.

class AudioEngine {
  ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private motor: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private inverter!: { osc: OscillatorNode; gain: GainNode };
  private squeal!: GainNode; private squealF!: BiquadFilterNode;
  private wind!: GainNode; private rumble!: GainNode; private road!: GainNode;
  private hiss!: GainNode; private hissF!: BiquadFilterNode; private puff!: GainNode;
  muted = false;

  /** must be called from a user gesture (iOS requirement) */
  unlock() {
    try { const n = navigator as Navigator & { audioSession?: { type: string } }; if (n.audioSession) n.audioSession.type = 'playback'; } catch { /* older Safari */ }
    if (!this.ctx) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      const ctx = (this.ctx = new Ctor());
      const comp = ctx.createDynamicsCompressor();
      this.master = ctx.createGain(); this.master.gain.value = this.muted ? 0 : 0.7;
      comp.connect(this.master); this.master.connect(ctx.destination);
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

      // motor: a sine fundamental with two inharmonic partials, through a soft low-pass
      const gain = ctx.createGain(); gain.gain.value = 0;
      const filter = ctx.createBiquadFilter(); filter.type = 'lowpass'; filter.frequency.value = 1800; filter.Q.value = 2;
      const osc = [1, 2.02, 3.97].map((_, k) => {
        const o = ctx.createOscillator(); o.type = k === 0 ? 'sine' : 'triangle';
        const g = ctx.createGain(); g.gain.value = [0.5, 0.18, 0.07][k];
        o.connect(g); g.connect(filter); o.start();
        return o;
      });
      filter.connect(gain); gain.connect(comp);
      this.motor = { osc, gain, filter };
      // inverter: a thin high whistle that only shows up under power
      const io = ctx.createOscillator(); io.type = 'sine';
      const ig = ctx.createGain(); ig.gain.value = 0;
      io.connect(ig); ig.connect(comp); io.start();
      this.inverter = { osc: io, gain: ig };

      const voice = (type: BiquadFilterType, freq: number, q: number) => {
        const src = ctx.createBufferSource(); src.buffer = this.noise; src.loop = true;
        const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
        const g = ctx.createGain(); g.gain.value = 0;
        src.connect(f); f.connect(g); g.connect(comp); src.start();
        return { g, f };
      };
      const sq = voice('bandpass', 1500, 7); this.squeal = sq.g; this.squealF = sq.f;
      this.wind = voice('lowpass', 600, 0.6).g;
      this.road = voice('lowpass', 260, 0.8).g;
      this.rumble = voice('lowpass', 90, 1.5).g;
      const hs = voice('bandpass', 5000, 0.7); this.hiss = hs.g; this.hissF = hs.f;
      this.puff = voice('highpass', 2600, 0.5).g;
      const silent = ctx.createBufferSource(); silent.buffer = ctx.createBuffer(1, 1, 22050); silent.connect(ctx.destination); silent.start(0);
    }
    if (this.ctx.state !== 'running') this.ctx.resume().catch(() => {});
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.7, this.ctx.currentTime, 0.05);
    return this.muted;
  }

  /** speed in m/s, load -1 (regen) .. 1 (full power), slip 0..1, kerb 0..1 */
  update(speed: number, load: number, slip: number, kerb: number, paused: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.motor) return;
    const t = ctx.currentTime, tc = 0.04;
    const v = Math.abs(speed);
    const quiet = paused ? 0 : 1;
    // motor pitch follows wheel speed (single-speed reduction gear), a little higher under load
    const f0 = 38 + v * 14.5 * (1 + 0.03 * Math.max(0, load));
    this.motor.osc.forEach((o, k) => o.frequency.setTargetAtTime(f0 * [1, 2.02, 3.97][k], t, tc));
    this.motor.filter.frequency.setTargetAtTime(900 + v * 40 + Math.abs(load) * 1500, t, tc);
    const motorLevel = (0.05 + Math.min(1, v / 25) * 0.1 + Math.abs(load) * 0.16) * quiet;
    this.motor.gain.gain.setTargetAtTime(motorLevel, t, tc);
    this.inverter.osc.frequency.setTargetAtTime(2400 + v * 55, t, tc);
    this.inverter.gain.gain.setTargetAtTime(Math.max(0, load) * 0.022 * quiet, t, 0.08);
    this.squeal.gain.setTargetAtTime(slip * slip * 0.5 * Math.min(1, v / 8) * quiet, t, 0.05);
    this.squealF.frequency.setTargetAtTime(1200 + slip * 600, t, 0.1);
    this.wind.gain.setTargetAtTime(Math.min(0.45, (v / 70) ** 2 * 0.45) * quiet, t, 0.1);
    this.road.gain.setTargetAtTime(Math.min(0.2, v / 70 * 0.2) * quiet, t, 0.1);
    this.rumble.gain.setTargetAtTime(kerb * Math.min(1, v / 10) * 0.9 * quiet, t, 0.03);
  }

  /** boost 0..1 (rear jets), attitude 0..1 (air control), tank 0..1 */
  jets(boost: number, attitude: number, tank: number, paused: boolean) {
    const ctx = this.ctx;
    if (!ctx || !this.hiss) return;
    const t = ctx.currentTime, quiet = paused ? 0 : 1;
    this.hiss.gain.setTargetAtTime(boost * 0.32 * quiet, t, boost > 0 ? 0.02 : 0.08);
    // lower tank pressure: a lower, breathier hiss
    this.hissF.frequency.setTargetAtTime(1500 + tank * 4200, t, 0.1);
    this.puff.gain.setTargetAtTime(attitude * 0.08 * quiet, t, 0.03);
  }

  /** the hop: a sharp blast of air with a low thump under it */
  hop() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 0.6;
    f.frequency.setValueAtTime(3000, now); f.frequency.exponentialRampToValueAtTime(500, now + 0.5);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, now); g.gain.exponentialRampToValueAtTime(0.7, now + 0.015); g.gain.exponentialRampToValueAtTime(0.001, now + 0.6);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(now, Math.random()); src.stop(now + 0.65);
    this.impact(6);
  }

  /** an air canister: a quick rising two-note chime */
  pickup() {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const now = ctx.currentTime;
    [880, 1320].forEach((freq, k) => {
      const o = ctx.createOscillator(); o.type = 'triangle';
      o.frequency.setValueAtTime(freq, now + k * 0.07); o.frequency.exponentialRampToValueAtTime(freq * 1.25, now + k * 0.07 + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now + k * 0.07); g.gain.exponentialRampToValueAtTime(0.16, now + k * 0.07 + 0.01); g.gain.exponentialRampToValueAtTime(0.001, now + k * 0.07 + 0.3);
      o.connect(g); g.connect(this.master);
      o.start(now + k * 0.07); o.stop(now + k * 0.07 + 0.32);
    });
  }

  /** a dull thump for wall hits, scaled by impact speed (m/s) */
  impact(strength: number) {
    const ctx = this.ctx;
    if (!ctx || this.muted) return;
    const src = ctx.createBufferSource(); src.buffer = this.noise;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 380;
    const g = ctx.createGain();
    const a = Math.min(1, strength / 12);
    g.gain.setValueAtTime(a, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(); src.stop(ctx.currentTime + 0.4);
  }
}

export const audio = new AudioEngine();
