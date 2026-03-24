import type { FieldState, Keyframe } from "./types";
import { DEFAULT_STATE } from "./types";

export class SequenceEngine {
  private resolvedFrames: {
    time: number;
    state: FieldState;
    snap: boolean;
  }[] = [];

  load(keyframes: Keyframe[]) {
    this.resolvedFrames = [];
    let current = { ...DEFAULT_STATE };
    for (const kf of keyframes) {
      current = { ...current, ...(kf.state as Partial<FieldState>) };
      this.resolvedFrames.push({
        time: kf.time,
        state: { ...current },
        snap: kf.snap,
      });
    }
  }

  getStateAtTime(time: number): FieldState {
    if (this.resolvedFrames.length === 0) return { ...DEFAULT_STATE };

    if (time <= this.resolvedFrames[0].time) {
      return { ...this.resolvedFrames[0].state };
    }

    const last = this.resolvedFrames[this.resolvedFrames.length - 1];
    if (time >= last.time) {
      return { ...last.state };
    }

    let i = 0;
    for (; i < this.resolvedFrames.length - 1; i++) {
      if (
        time >= this.resolvedFrames[i].time &&
        time < this.resolvedFrames[i + 1].time
      )
        break;
    }

    const from = this.resolvedFrames[i];
    const to = this.resolvedFrames[i + 1];

    // snap: hold current state until the snap point
    if (to.snap) {
      return { ...from.state };
    }

    const duration = to.time - from.time;
    const t = duration > 0 ? (time - from.time) / duration : 0;
    return lerpState(from.state, to.state, t);
  }

  get duration(): number {
    if (this.resolvedFrames.length === 0) return 0;
    return this.resolvedFrames[this.resolvedFrames.length - 1].time;
  }

  /**
   * Return segment boundaries as pairs of keyframe times.
   * Each segment is a pair of consecutive keyframes (start keyframe, end keyframe).
   */
  getSegmentTimes(): { start: number; end: number }[] {
    const segments: { start: number; end: number }[] = [];
    for (let i = 0; i < this.resolvedFrames.length - 1; i += 2) {
      const next = this.resolvedFrames[i + 1];
      if (next) {
        segments.push({
          start: this.resolvedFrames[i].time,
          end: next.time,
        });
      }
    }
    return segments;
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpAngle(a: number, b: number, t: number): number {
  let diff = b - a;
  while (diff > Math.PI) diff -= 2 * Math.PI;
  while (diff < -Math.PI) diff += 2 * Math.PI;
  return a + diff * t;
}

function lerpColor(a: string, b: string, t: number): string {
  const pa = parseHex(a);
  const pb = parseHex(b);
  const r = Math.round(lerp(pa[0], pb[0], t));
  const g = Math.round(lerp(pa[1], pb[1], t));
  const bl = Math.round(lerp(pa[2], pb[2], t));
  return `#${hex(r)}${hex(g)}${hex(bl)}`;
}

function parseHex(c: string): [number, number, number] {
  const h = c.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function hex(n: number): string {
  return Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0");
}

function lerpState(a: FieldState, b: FieldState, t: number): FieldState {
  return {
    density: lerp(a.density, b.density, t),
    connect: lerp(a.connect, b.connect, t),
    driftAngle: lerpAngle(a.driftAngle, b.driftAngle, t),
    driftSpeed: lerp(a.driftSpeed, b.driftSpeed, t),
    driftMode: t < 0.5 ? a.driftMode : b.driftMode,
    intensity: lerp(a.intensity, b.intensity, t),
    spread: lerp(a.spread, b.spread, t),
    size: lerp(a.size, b.size, t),
    turbulence: lerp(a.turbulence, b.turbulence, t),
    paletteA: lerpColor(a.paletteA, b.paletteA, t),
    paletteB: lerpColor(a.paletteB, b.paletteB, t),
    opacity: lerp(a.opacity, b.opacity, t),
  };
}
