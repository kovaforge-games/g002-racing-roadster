// Unified input, ported from g001: keyboard keys are ramped into smooth analogue values, and a
// gamepad (left stick, triggers) takes over whenever it asks for more.
import type { CarInputs } from '../sim/car';

export type Action = 'camera' | 'reset' | 'pause' | 'paint' | 'help' | 'time' | 'mute' | 'assist1' | 'assist2' | 'assist3' | 'hop' | 'practice';

const KEYS = {
  left: ['ArrowLeft', 'KeyA'], right: ['ArrowRight', 'KeyD'],
  throttle: ['ArrowUp', 'KeyW'], brake: ['ArrowDown', 'KeyS'],
  handbrake: ['Space'], lookBack: ['KeyB'], boost: ['ShiftLeft', 'ShiftRight'],
};
const PRESS: Record<string, Action> = {
  KeyC: 'camera', KeyR: 'reset', Escape: 'pause', KeyP: 'paint', KeyH: 'help', KeyT: 'time', KeyM: 'mute',
  Digit1: 'assist1', Digit2: 'assist2', Digit3: 'assist3', KeyE: 'hop', Enter: 'hop', KeyF: 'practice',
};
/** standard-mapping gamepad buttons: A hops, B boosts (held, read in poll) */
const PAD_PRESS: Record<number, Action> = { 0: 'hop', 3: 'camera', 8: 'reset', 9: 'pause', 2: 'paint' };

export interface DriveInput extends CarInputs {
  lookBack: boolean;
  /** rear jets, held */
  boost: boolean;
  /** the hop button was pressed since the last poll */
  hop: boolean;
  /** gamepad left stick forward/back for pitch in the air (0 on a keyboard) */
  pitch: number;
}

class InputManager {
  private down = new Set<string>();
  private pressed = new Set<Action>();
  private padPrev: boolean[] = [];
  private steer = 0; private throttle = 0; private brake = 0;
  /** any key, click, tap or pad button (used to start and to unlock audio); gets the key code */
  onAny: ((code?: string) => void) | null = null;
  lastDevice: 'keyboard' | 'gamepad' = 'keyboard';

  init() {
    addEventListener('keydown', e => {
      if (!e.repeat && PRESS[e.code]) this.pressed.add(PRESS[e.code]);
      this.down.add(e.code);
      this.lastDevice = 'keyboard';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
      this.onAny?.(e.code);
    });
    addEventListener('keyup', e => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    addEventListener('pointerdown', () => this.onAny?.());
  }

  private held(keys: string[]) { return keys.some(k => this.down.has(k)); }

  /** true once per press (keyboard or gamepad) */
  consume(a: Action) {
    const p = this.pressed.has(a);
    this.pressed.delete(a);
    return p;
  }

  private pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const gp = Array.from(pads).find(p => p && p.connected) ?? null;
    if (!gp) return null;
    gp.buttons.forEach((b, i) => {
      if (b.pressed && !this.padPrev[i]) {
        this.lastDevice = 'gamepad';
        if (PAD_PRESS[i]) this.pressed.add(PAD_PRESS[i]);
        this.onAny?.();
      }
      this.padPrev[i] = b.pressed;
    });
    return gp;
  }

  poll(dt: number): DriveInput {
    const gp = this.pollPad();
    // keyboard: ramp digital keys into smooth analogue values (faster back to centre)
    const target = (this.held(KEYS.right) ? 1 : 0) - (this.held(KEYS.left) ? 1 : 0);
    const rate = target === 0 ? 8 : Math.sign(target) !== Math.sign(this.steer) ? 10 : 6;
    this.steer += Math.max(-rate * dt, Math.min(rate * dt, target - this.steer));
    this.throttle += Math.max(-8 * dt, Math.min(6 * dt, (this.held(KEYS.throttle) ? 1 : 0) - this.throttle));
    this.brake += Math.max(-12 * dt, Math.min(20 * dt, (this.held(KEYS.brake) ? 1 : 0) - this.brake));
    let steer = this.steer, throttle = this.throttle, brake = this.brake, pitch = 0;
    let handbrake = this.held(KEYS.handbrake), lookBack = this.held(KEYS.lookBack), boost = this.held(KEYS.boost);
    if (gp) {
      const ax = gp.axes[0] ?? 0;
      const dz = Math.abs(ax) < 0.08 ? 0 : (ax - Math.sign(ax) * 0.08) / 0.92;
      if (Math.abs(dz) > Math.abs(steer)) steer = Math.sign(dz) * Math.abs(dz) ** 1.4;
      throttle = Math.max(throttle, gp.buttons[7]?.value ?? 0);
      brake = Math.max(brake, gp.buttons[6]?.value ?? 0);
      boost ||= !!gp.buttons[1]?.pressed;
      // stick forward (negative) is nose down
      const ay = gp.axes[1] ?? 0;
      pitch = Math.abs(ay) < 0.15 ? 0 : -ay;
      handbrake ||= !!gp.buttons[5]?.pressed;
      lookBack ||= !!gp.buttons[4]?.pressed;
    }
    return { steer: Math.max(-1, Math.min(1, steer)), throttle, brake, handbrake, lookBack, boost, hop: this.consume('hop'), pitch };
  }
}

export const input = new InputManager();
