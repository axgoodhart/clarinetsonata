import type { Keyframe, FieldState } from "./types";
import { DEFAULT_STATE, PALETTES } from "./types";
import type { SequenceEngine } from "./sequence-engine";

export const CURVE_PARAMS = [
  { key: "density",    label: "Density",    min: 0, max: 1,   color: "#60a5fa" },
  { key: "connect",    label: "Connect",    min: 0, max: 200, color: "#a78bfa" },
  { key: "intensity",  label: "Intensity",  min: 0, max: 1,   color: "#34d399" },
  { key: "spread",     label: "Spread",     min: 0, max: 1,   color: "#fbbf24" },
  { key: "size",       label: "Size",       min: 0, max: 1,   color: "#f472b6" },
  { key: "turbulence", label: "Turbulence", min: 0, max: 1,   color: "#818cf8" },
  { key: "opacity",    label: "Opacity",    min: 0, max: 1,   color: "#2dd4bf" },
] as const;

export type CurveParamKey = (typeof CURVE_PARAMS)[number]["key"];

/** Defensive getter for palette names to avoid circular init issues */
export const getPaletteNames = () => Object.keys(PALETTES);

export function paletteColors(idx: number): [string, string] {
  const names = getPaletteNames();
  const name = names[idx % names.length];
  return PALETTES[name];
}

const DEFAULTS: Record<CurveParamKey, number> = {
  density: DEFAULT_STATE.density,
  connect: DEFAULT_STATE.connect,
  intensity: DEFAULT_STATE.intensity,
  spread: DEFAULT_STATE.spread,
  size: DEFAULT_STATE.size,
  turbulence: DEFAULT_STATE.turbulence,
  opacity: DEFAULT_STATE.opacity,
};

export class CurveStore {
  data: Record<CurveParamKey, Float32Array>;
  driftX: Float32Array;
  driftY: Float32Array;
  driftMode: Uint8Array; // 0=directional, 1=inward, 2=outward
  paletteIdx: Uint8Array;
  private _duration: number;
  private _resolution: number;

  constructor(duration: number, resolution = 3) {
    this._duration = Math.max(1, duration);
    this._resolution = resolution;
    const count = Math.ceil(this._duration * resolution) + 1;
    this.data = {} as Record<CurveParamKey, Float32Array>;
    for (const p of CURVE_PARAMS) {
      this.data[p.key] = new Float32Array(count).fill(DEFAULTS[p.key]);
    }
    this.driftX = new Float32Array(count); // -1 to 1
    this.driftY = new Float32Array(count); // -1 to 1
    this.driftMode = new Uint8Array(count); // 0=dir
    this.paletteIdx = new Uint8Array(count).fill(1); // default "cool" = index 1
  }

  get duration() { return this._duration; }
  get resolution() { return this._resolution; }
  get pointCount() { return this.data.density.length; }
  get eventCount() { return this.pointCount * CURVE_PARAMS.length; }
  get paletteNames() { return getPaletteNames(); }

  private timeToIndex(time: number): number {
    return Math.round(Math.max(0, Math.min(time, this._duration)) * this._resolution);
  }

  getValue(param: CurveParamKey, time: number): number {
    const arr = this.data[param];
    return arr[Math.min(this.timeToIndex(time), arr.length - 1)];
  }

  getNormalized(param: CurveParamKey, time: number): number {
    const def = CURVE_PARAMS.find((p) => p.key === param)!;
    return (this.getValue(param, time) - def.min) / (def.max - def.min);
  }

  setValue(param: CurveParamKey, time: number, value: number): void {
    const idx = this.timeToIndex(time);
    const arr = this.data[param];
    if (idx >= 0 && idx < arr.length) arr[idx] = value;
  }

  setNormalized(param: CurveParamKey, time: number, norm: number): void {
    const def = CURVE_PARAMS.find((p) => p.key === param)!;
    this.setValue(param, time, def.min + Math.max(0, Math.min(1, norm)) * (def.max - def.min));
  }

  setDrift(time: number, x: number, y: number, mode = 0): void {
    const idx = this.timeToIndex(time);
    if (idx >= 0 && idx < this.driftX.length) {
      this.driftX[idx] = Math.max(-1, Math.min(1, x));
      this.driftY[idx] = Math.max(-1, Math.min(1, y));
      this.driftMode[idx] = mode;
    }
  }

  paintDrift(t0: number, x0: number, y0: number, t1: number, x1: number, y1: number, mode = 0): void {
    const i0 = this.timeToIndex(t0);
    const i1 = this.timeToIndex(t1);
    const start = Math.max(0, Math.min(i0, i1));
    const end = Math.min(this.driftX.length - 1, Math.max(i0, i1));
    for (let i = start; i <= end; i++) {
      const t = end === start ? 1 : (i - i0) / (i1 - i0);
      this.driftX[i] = Math.max(-1, Math.min(1, x0 + (x1 - x0) * t));
      this.driftY[i] = Math.max(-1, Math.min(1, y0 + (y1 - y0) * t));
      this.driftMode[i] = mode;
    }
  }

  getDrift(time: number): { x: number; y: number; mode: number } {
    const idx = Math.min(this.timeToIndex(time), this.driftX.length - 1);
    return { x: this.driftX[idx], y: this.driftY[idx], mode: this.driftMode[idx] };
  }

  setPalette(time: number, idx: number): void {
    const i = this.timeToIndex(time);
    const names = getPaletteNames();
    if (i >= 0 && i < this.paletteIdx.length) {
      this.paletteIdx[i] = idx % names.length;
    }
  }

  getPalette(time: number): number {
    const idx = Math.min(this.timeToIndex(time), this.paletteIdx.length - 1);
    return this.paletteIdx[idx];
  }

  paintNormalized(param: CurveParamKey, t0: number, v0: number, t1: number, v1: number): void {
    const def = CURVE_PARAMS.find((p) => p.key === param)!;
    const range = def.max - def.min;
    const i0 = this.timeToIndex(t0);
    const i1 = this.timeToIndex(t1);
    const start = Math.max(0, Math.min(i0, i1));
    const end = Math.min(this.data[param].length - 1, Math.max(i0, i1));
    const arr = this.data[param];
    for (let i = start; i <= end; i++) {
      const t = end === start ? 1 : (i - i0) / (i1 - i0);
      const norm = Math.max(0, Math.min(1, v0 + (v1 - v0) * t));
      arr[i] = def.min + norm * range;
    }
  }

  toKeyframes(): Keyframe[] {
    const kf: Keyframe[] = [];
    const count = this.pointCount;
    for (let i = 0; i < count; i++) {
      const time = i / this._resolution;
      const dx = this.driftX[i];
      const dy = this.driftY[i];
      const speed = Math.sqrt(dx * dx + dy * dy);
      const angle = Math.atan2(dy, dx);
      const pal = paletteColors(this.paletteIdx[i]);
      const mode = this.driftMode[i];
      const state: Partial<FieldState> = {
        density: this.data.density[i],
        connect: this.data.connect[i],
        intensity: this.data.intensity[i],
        spread: this.data.spread[i],
        size: this.data.size[i],
        turbulence: this.data.turbulence[i],
        opacity: this.data.opacity[i],
        driftAngle: angle,
        driftSpeed: speed * 2.5,
        driftMode: mode === 1 ? "inward" : mode === 2 ? "outward" : "directional",
        paletteA: pal[0],
        paletteB: pal[1],
      };
      kf.push({ time, state, snap: false });
    }
    return kf;
  }

  private driftToDSL(dx: number, dy: number, mode: number): string {
    const speed = Math.sqrt(dx * dx + dy * dy);
    if (speed < 0.05 && mode === 0) return "still, 0.001";
    if (mode === 1) return `inward, ${(speed * 2.5).toFixed(2)}`;
    if (mode === 2) return `outward, ${(speed * 2.5).toFixed(2)}`;
    const angle = Math.atan2(dy, dx);
    const dir = angleToDirName(angle);
    return `${dir}, ${(speed * 2.5).toFixed(2)}`;
  }

  toDSL(): string {
    const lines: string[] = [""];
    const count = this.pointCount;
    const step = 1 / this._resolution;
    const names = getPaletteNames();
    for (let i = 0; i < count - 1; i++) {
      const t0 = i * step;
      const t1 = (i + 1) * step;
      const f = (v: number) => v.toFixed(3);
      const d0 = this.driftToDSL(this.driftX[i], this.driftY[i], this.driftMode[i]);
      const d1 = this.driftToDSL(this.driftX[i + 1], this.driftY[i + 1], this.driftMode[i + 1]);
      const p0 = names[this.paletteIdx[i]];
      const p1 = names[this.paletteIdx[i + 1]];
      lines.push(`density(${f(this.data.density[i])} | ${f(this.data.density[i + 1])})`);
      lines.push(`connect(${f(this.data.connect[i])} | ${f(this.data.connect[i + 1])})`);
      lines.push(`drift(${d0} | ${d1})`);
      lines.push(`intensity(${f(this.data.intensity[i])} | ${f(this.data.intensity[i + 1])})`);
      lines.push(`spread(${f(this.data.spread[i])} | ${f(this.data.spread[i + 1])})`);
      lines.push(`size(${f(this.data.size[i])} | ${f(this.data.size[i + 1])})`);
      lines.push(`turbulence(${f(this.data.turbulence[i])} | ${f(this.data.turbulence[i + 1])})`);
      lines.push(`opacity(${f(this.data.opacity[i])} | ${f(this.data.opacity[i + 1])})`);
      lines.push(`palette(${p0} | ${p1})`);
      lines.push(`||| ${f(t0)}s ${f(t1)}s`);
      lines.push("");
    }
    return lines.join("\n");
  }

  static fromEngine(engine: SequenceEngine, duration: number, resolution = 3): CurveStore {
    const store = new CurveStore(duration, resolution);
    for (let i = 0; i < store.pointCount; i++) {
      const t = i / resolution;
      const s = engine.getStateAtTime(t);
      store.data.density[i] = s.density;
      store.data.connect[i] = s.connect;
      store.data.intensity[i] = s.intensity;
      store.data.spread[i] = s.spread;
      store.data.size[i] = s.size;
      store.data.turbulence[i] = s.turbulence;
      store.data.opacity[i] = s.opacity;
      // Convert angle+speed back to XY
      const spd = Math.min(1, s.driftSpeed / 2.5);
      store.driftX[i] = Math.cos(s.driftAngle) * spd;
      store.driftY[i] = Math.sin(s.driftAngle) * spd;
      // Convert mode back to index
      store.driftMode[i] = s.driftMode === "inward" ? 1 : s.driftMode === "outward" ? 2 : 0;
      // Match palette to nearest named palette
      store.paletteIdx[i] = matchPalette(s.paletteA, s.paletteB);
    }
    return store;
  }
}

function angleToDirName(angle: number): string {
  // Normalize to 0-2PI
  const a = ((angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  const deg = (a * 180) / Math.PI;
  if (deg >= 337.5 || deg < 22.5) return "right";
  if (deg < 67.5) return "downright";
  if (deg < 112.5) return "down";
  if (deg < 157.5) return "downleft";
  if (deg < 202.5) return "left";
  if (deg < 247.5) return "upleft";
  if (deg < 292.5) return "up";
  return "upright";
}

function matchPalette(a: string, b: string): number {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  const names = getPaletteNames();
  for (let i = 0; i < names.length; i++) {
    const [pa, pb] = PALETTES[names[i]];
    if (pa.toLowerCase() === al && pb.toLowerCase() === bl) return i;
  }
  return 1; // default "cool"
}
