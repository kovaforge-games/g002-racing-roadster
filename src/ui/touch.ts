// iPad and phone controls: steering on the left (a slider by default, or left/right buttons, or
// tilting the device), gas and brake pedals on the right with the gear, RPM and speed above them
// and the four tyres beside them, and thruster buttons: jump (hold to hover), the two side
// thrusters (dodge on the road, flip in the air) and boost.
import { h } from './dom';
import { settings } from '../core/settings';
import { TYRE } from '../sim/car';

export type Steering = 'slider' | 'buttons' | 'tilt';

/** what the touch controls are asking for this frame */
export interface TouchDrive { steer: number; throttle: number; brake: number; boost: boolean; hop: boolean; hover: boolean; side: number; sidePress: number }

/** colour class for a tyre temperature */
export const tyreClass = (t: number) => t < TYRE.cold ? 'cold' : t > TYRE.hot ? 'hot' : 'warm';

/** a touch device: the touch controls come on by themselves unless Settings says otherwise */
export const touchDevice = () => matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 1;

export class TouchControls {
  readonly root = h('div', { class: 'touch', 'data-ui': true });
  private steerArea = h('div', { class: 'steer-area' });
  private slider = h('div', { class: 'slider' }, h('div', { class: 'slider-mid' }));
  private thumb = h('div', { class: 'slider-thumb' });
  private tiltDot = h('div', { class: 'tilt-dot' });
  private gear = h('b', { class: 'rd-gear' }, 'D');
  private rpm = h('b', { class: 'rd-rpm' }, '0');
  private kmh = h('b', { class: 'rd-kmh' }, '0');
  private tyres: HTMLElement[] = [];
  private tyreText: HTMLElement[] = [];
  private gas = h('button', { class: 'pedal gas', 'aria-label': 'Gas' }, h('span', null, 'GAS'));
  private brake = h('button', { class: 'pedal brake', 'aria-label': 'Brake' }, h('span', null, 'BRAKE'));
  private boostBtn = h('button', { class: 'jet-btn boost', 'aria-label': 'Boost' }, 'BOOST');
  private hopBtn = h('button', { class: 'jet-btn hop', 'aria-label': 'Jump, hold to hover' }, 'JUMP');
  private sideL = h('button', { class: 'jet-btn side left', 'aria-label': 'Left side thruster' }, '◀◀');
  private sideR = h('button', { class: 'jet-btn side right', 'aria-label': 'Right side thruster' }, '▶▶');
  /** Fun Mode: use the item you're holding (shows its icon) */
  private itemBtn = h('button', { class: 'jet-btn item', 'aria-label': 'Use item' }, 'ITEM');
  onItem: (() => void) | null = null;

  // raw touch state
  private sliderX = 0;
  private sliderId: number | null = null;
  private held = { left: false, right: false, gas: false, brake: false, boost: false, jump: false, sideL: false, sideR: false };
  private hopPressed = false;
  private sidePressed = 0;
  private buttonSteer = 0;
  private tilt = 0;
  private tiltZero: number | null = null;
  private tiltListening = false;
  private steering: Steering = 'slider';

  constructor() {
    const tyreBox = h('div', { class: 'tyres', 'aria-label': 'Tyre temperatures' });
    for (let k = 0; k < 4; k++) {
      const t = h('div', { class: 'tyre cold' }), txt = h('span', null, '');
      t.append(txt); tyreBox.append(t);
      this.tyres.push(t); this.tyreText.push(txt);
    }
    const readout = h('div', { class: 'readout-touch' },
      h('div', null, this.gear, h('small', null, 'GEAR')),
      h('div', null, this.rpm, h('small', null, 'RPM')),
      h('div', null, this.kmh, h('small', null, 'KM/H')));
    this.slider.append(this.thumb);
    this.root.append(
      this.steerArea,
      h('div', { class: 'jets' }, h('div', { class: 'jet-row' }, this.sideL, this.sideR), h('div', { class: 'jet-row' }, this.hopBtn, this.boostBtn), h('div', { class: 'jet-row fun-only' }, this.itemBtn)),
      h('div', { class: 'pedal-side' }, readout, h('div', { class: 'pedal-row' }, tyreBox, this.brake, this.gas)));
    document.body.append(this.root);

    this.hold(this.gas, 'gas'); this.hold(this.brake, 'brake'); this.hold(this.boostBtn, 'boost');
    // jump, side thrusters: a press fires them, holding keeps them going (hover, flip)
    this.hold(this.hopBtn, 'jump', () => { this.hopPressed = true; });
    this.hold(this.sideL, 'sideL', () => { this.sidePressed = -1; });
    this.hold(this.sideR, 'sideR', () => { this.sidePressed = 1; });
    this.itemBtn.addEventListener('pointerdown', e => { e.preventDefault(); this.onItem?.(); });

    // the slider: put a finger anywhere on it and slide; let go and it springs back to the middle
    const fromEvent = (e: PointerEvent) => {
      const r = this.slider.getBoundingClientRect();
      return Math.max(-1, Math.min(1, ((e.clientX - r.left) / r.width) * 2 - 1));
    };
    this.slider.addEventListener('pointerdown', e => {
      e.preventDefault();
      this.sliderId = e.pointerId;
      try { this.slider.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      this.sliderX = fromEvent(e);
    });
    this.slider.addEventListener('pointermove', e => { if (e.pointerId === this.sliderId) this.sliderX = fromEvent(e); });
    const release = (e: PointerEvent) => { if (e.pointerId === this.sliderId) { this.sliderId = null; this.sliderX = 0; } };
    this.slider.addEventListener('pointerup', release);
    this.slider.addEventListener('pointercancel', release);
    // no long-press menus, text selection or page scrolling from the controls
    this.root.addEventListener('contextmenu', e => e.preventDefault());
    this.setSteering(settings.steering);
  }

  private hold(el: HTMLElement, key: keyof TouchControls['held'], onPress?: () => void) {
    el.addEventListener('pointerdown', e => {
      e.preventDefault();
      try { el.setPointerCapture(e.pointerId); } catch { /* the pointer is already gone */ }
      this.held[key] = true; el.classList.add('down');
      onPress?.();
    });
    const up = () => { this.held[key] = false; el.classList.remove('down'); };
    el.addEventListener('pointerup', up); el.addEventListener('pointercancel', up); el.addEventListener('lostpointercapture', up);
  }

  setSteering(mode: Steering) {
    this.steering = mode;
    this.root.dataset.steering = mode;
    if (mode === 'slider') this.steerArea.replaceChildren(this.slider);
    else if (mode === 'buttons') {
      const left = h('button', { class: 'steer-btn left', 'aria-label': 'Steer left' }, '◀');
      const right = h('button', { class: 'steer-btn right', 'aria-label': 'Steer right' }, '▶');
      this.hold(left, 'left'); this.hold(right, 'right');
      this.steerArea.replaceChildren(left, right);
    } else {
      this.steerArea.replaceChildren(h('div', { class: 'tilt-meter' }, h('div', { class: 'tilt-mid' }), this.tiltDot), h('div', { class: 'tilt-hint' }, 'Tilt to steer'));
      this.listenTilt();
      this.tiltZero = null;
    }
  }

  /** tilt needs permission on iPad (asked from a tap, so call this from a button's click) */
  static async askTilt(): Promise<boolean> {
    const D = DeviceOrientationEvent as unknown as { requestPermission?: () => Promise<string> };
    if (typeof D?.requestPermission !== 'function') return true;
    try { return (await D.requestPermission()) === 'granted'; } catch { return false; }
  }

  private listenTilt() {
    if (this.tiltListening) return;
    this.tiltListening = true;
    addEventListener('deviceorientation', e => {
      // in landscape, steering is the device's roll around the long axis of the screen
      const angle = (screen.orientation?.angle ?? (window as unknown as { orientation?: number }).orientation ?? 0) as number;
      const a = angle === 90 ? (e.beta ?? 0) : angle === 270 || angle === -90 ? -(e.beta ?? 0) : (e.gamma ?? 0);
      if (this.tiltZero === null) this.tiltZero = a;
      this.tilt = a - this.tiltZero;
    });
  }

  /** straight ahead is however the device is held now (called as a session starts) */
  recentre() { this.tiltZero = null; }

  poll(dt: number): TouchDrive {
    let steer = 0;
    if (this.steering === 'slider') {
      const dz = 0.06;
      steer = Math.abs(this.sliderX) < dz ? 0 : Math.sign(this.sliderX) * (Math.abs(this.sliderX) - dz) / (1 - dz);
      this.thumb.style.left = `${(50 + this.sliderX * 50).toFixed(1)}%`;
    } else if (this.steering === 'buttons') {
      // ramped like keyboard steering: quick to turn in, quicker back to the middle
      const target = (this.held.right ? 1 : 0) - (this.held.left ? 1 : 0);
      const rate = target === 0 ? 8 : Math.sign(target) !== Math.sign(this.buttonSteer) ? 10 : 5;
      this.buttonSteer += Math.max(-rate * dt, Math.min(rate * dt, target - this.buttonSteer));
      steer = this.buttonSteer;
    } else {
      // ±28° of tilt is full lock, with a small dead zone around level
      const deg = this.tilt, dz = 2;
      steer = Math.abs(deg) < dz ? 0 : Math.max(-1, Math.min(1, Math.sign(deg) * (Math.abs(deg) - dz) / 26));
      this.tiltDot.style.left = `${50 + steer * 46}%`;
    }
    const hop = this.hopPressed; this.hopPressed = false;
    const sidePress = this.sidePressed; this.sidePressed = 0;
    return { steer, throttle: this.held.gas ? 1 : 0, brake: this.held.brake ? 1 : 0, boost: this.held.boost, hop,
      hover: this.held.jump, side: (this.held.sideR ? 1 : 0) - (this.held.sideL ? 1 : 0), sidePress };
  }

  /** gear, RPM and speed above the pedals; the tyres next to them */
  show(gear: string, rpm: number, kmh: number, tyres: number[]) {
    if (this.gear.textContent !== gear) this.gear.textContent = gear;
    this.rpm.textContent = String(Math.round(rpm / 10) * 10);
    this.kmh.textContent = String(Math.round(kmh));
    tyres.forEach((t, k) => {
      const c = `tyre ${tyreClass(t)}`;
      if (this.tyres[k].className !== c) this.tyres[k].className = c;
      this.tyreText[k].textContent = String(Math.round(t));
    });
  }

  /** the item button: its icon, or empty when there is nothing to use */
  setItem(icon: string | null) {
    const text = icon ?? 'ITEM';
    if (this.itemBtn.textContent !== text) this.itemBtn.textContent = text;
    this.itemBtn.classList.toggle('empty', !icon);
  }

  set visible(v: boolean) { this.root.classList.toggle('hidden', !v); }
}
