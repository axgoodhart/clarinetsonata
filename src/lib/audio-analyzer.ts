import { PALETTES } from "./types";

// ── Types ──────────────────────────────────────────────────────────

export type TextureBoundary = {
  time: number;
  flux: number;
};

export type ArcSegment = {
  startTime: number;
  endTime: number;
  bass: number;
  mid: number;
  high: number;
  rms: number;
  centroid: number;
  flatness: number;
};

/** User-configurable output range per parameter */
export type ParamRange = { min: number; max: number };

export type GenerateRanges = {
  density: ParamRange;
  connect: ParamRange;
  intensity: ParamRange;
  spread: ParamRange;
  size: ParamRange;
  turbulence: ParamRange;
  opacity: ParamRange;
};

/** Absolute hard limits for each parameter (used by the modal sliders) */
export const PARAM_LIMITS: Record<keyof GenerateRanges, { min: number; max: number; step: number }> = {
  density:    { min: 0, max: 1,   step: 0.01 },
  connect:    { min: 0, max: 300, step: 1 },
  intensity:  { min: 0, max: 1,   step: 0.01 },
  spread:     { min: 0, max: 1,   step: 0.01 },
  size:       { min: 0, max: 1,   step: 0.01 },
  turbulence: { min: 0, max: 1,   step: 0.01 },
  opacity:    { min: 0, max: 1,   step: 0.01 },
};

export const DEFAULT_RANGES: GenerateRanges = {
  density:    { min: 0.05, max: 0.8 },
  connect:    { min: 0,    max: 200 },
  intensity:  { min: 0.05, max: 0.9 },
  spread:     { min: 0.1,  max: 1 },
  size:       { min: 0.05, max: 0.8 },
  turbulence: { min: 0.05, max: 0.7 },
  opacity:    { min: 0.1,  max: 1 },
};

// ── Config ─────────────────────────────────────────────────────────

const FFT_SIZE = 2048;
const HOP = 512;

// ── Public API ─────────────────────────────────────────────────────

export function analyzeAudio(
  buffer: AudioBuffer,
  sensitivity = 0.5,
  forcedBoundaries: number[] = [],
): { boundaries: TextureBoundary[]; arcs: ArcSegment[] } {
  const mono = mixToMono(buffer);
  const sr = buffer.sampleRate;
  const frames = extractFrames(mono, sr);

  const flux = spectralFlux(frames);
  const smoothed = smooth(flux, 8);
  const peaks = pickPeaks(smoothed, sensitivity, sr);

  // Merge auto-detected peaks with forced boundaries (forced wins within 0.5s)
  const autoTimes = peaks.map((p) => p.time);
  const forced = forcedBoundaries.filter((t) => t > 0 && t < buffer.duration);
  const merged = autoTimes.filter(
    (at) => !forced.some((ft) => Math.abs(at - ft) < 0.5),
  );
  const allBoundaries = [...merged, ...forced].sort((a, b) => a - b);
  // Deduplicate within 25ms tolerance
  const deduped: number[] = [];
  for (const t of allBoundaries) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1] > 0.025) {
      deduped.push(t);
    }
  }
  const times = [0, ...deduped, buffer.duration];
  const arcs: ArcSegment[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i];
    const t1 = times[i + 1];
    if (t1 - t0 < 0.5) continue;
    arcs.push(characterizeArc(frames, t0, t1));
  }

  return { boundaries: peaks, arcs };
}

/**
 * Async version that offloads FFT/spectral analysis to a Web Worker,
 * keeping the main thread free for 60fps rendering.
 */
export function analyzeAudioAsync(
  buffer: AudioBuffer,
  sensitivity = 0.5,
  forcedBoundaries: number[] = [],
): Promise<{ boundaries: TextureBoundary[]; arcs: ArcSegment[] }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./audio-analyzer.worker.ts', import.meta.url),
      { type: 'module' },
    );

    // Extract channel data as transferable copies
    const channelData: Float32Array[] = [];
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      channelData.push(buffer.getChannelData(c).slice());
    }

    worker.onmessage = (e: MessageEvent) => {
      resolve(e.data);
      worker.terminate();
    };

    worker.onerror = (e) => {
      reject(new Error(e.message));
      worker.terminate();
    };

    worker.postMessage(
      { channelData, sampleRate: buffer.sampleRate, duration: buffer.duration, sensitivity, forcedBoundaries },
      channelData.map((c) => c.buffer),
    );
  });
}

// ── Frame Extraction (radix-2 FFT) ────────────────────────────────

type Frame = {
  time: number;
  mag: Float32Array;
  bass: number;
  mid: number;
  high: number;
  rms: number;
  centroid: number;
  flatness: number;
};

function extractFrames(mono: Float32Array, sr: number): Frame[] {
  const win = hanningWindow(FFT_SIZE);
  const bins = FFT_SIZE / 2;
  const frames: Frame[] = [];

  const re = new Float32Array(FFT_SIZE);
  const im = new Float32Array(FFT_SIZE);

  for (let off = 0; off + FFT_SIZE <= mono.length; off += HOP) {
    const time = off / sr;

    for (let i = 0; i < FFT_SIZE; i++) {
      re[i] = mono[off + i] * win[i];
      im[i] = 0;
    }

    fftInPlace(re, im);

    const mag = new Float32Array(bins);
    for (let i = 0; i < bins; i++) {
      mag[i] = Math.sqrt(re[i] * re[i] + im[i] * im[i]) / FFT_SIZE;
    }

    const bassEnd = Math.floor(bins * 0.1);
    const midEnd = Math.floor(bins * 0.4);
    let bass = 0, mid = 0, high = 0;
    for (let i = 0; i < bins; i++) {
      const m2 = mag[i] * mag[i];
      if (i < bassEnd) bass += m2;
      else if (i < midEnd) mid += m2;
      else high += m2;
    }
    bass = Math.sqrt(bass / bassEnd);
    mid = Math.sqrt(mid / (midEnd - bassEnd));
    high = Math.sqrt(high / (bins - midEnd));

    let rmsAcc = 0;
    for (let i = 0; i < FFT_SIZE; i++) {
      const s = mono[off + i];
      rmsAcc += s * s;
    }
    const rms = Math.sqrt(rmsAcc / FFT_SIZE);

    let wSum = 0, mSum = 0;
    for (let i = 0; i < bins; i++) {
      wSum += i * mag[i];
      mSum += mag[i];
    }
    const centroid = mSum > 0 ? wSum / mSum / bins : 0;

    let logAcc = 0, linAcc = 0;
    for (let i = 1; i < bins; i++) {
      const m = mag[i] + 1e-12;
      logAcc += Math.log(m);
      linAcc += m;
    }
    const geo = Math.exp(logAcc / (bins - 1));
    const ari = linAcc / (bins - 1);
    const flatness = ari > 0 ? geo / ari : 0;

    frames.push({ time, mag, bass, mid, high, rms, centroid, flatness });
  }

  return frames;
}

// ── Radix-2 In-Place FFT ───────────────────────────────────────────

function fftInPlace(re: Float32Array, im: Float32Array) {
  const N = re.length;

  for (let i = 1, j = 0; i < N; i++) {
    let bit = N >> 1;
    while (j & bit) { j ^= bit; bit >>= 1; }
    j ^= bit;
    if (i < j) {
      let tmp = re[i]; re[i] = re[j]; re[j] = tmp;
      tmp = im[i]; im[i] = im[j]; im[j] = tmp;
    }
  }

  for (let len = 2; len <= N; len <<= 1) {
    const half = len >> 1;
    const angle = -2 * Math.PI / len;
    const wRe = Math.cos(angle);
    const wIm = Math.sin(angle);

    for (let i = 0; i < N; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < half; j++) {
        const a = i + j;
        const b = a + half;
        const tRe = curRe * re[b] - curIm * im[b];
        const tIm = curRe * im[b] + curIm * re[b];
        re[b] = re[a] - tRe;
        im[b] = im[a] - tIm;
        re[a] += tRe;
        im[a] += tIm;
        const nextRe = curRe * wRe - curIm * wIm;
        curIm = curRe * wIm + curIm * wRe;
        curRe = nextRe;
      }
    }
  }
}

// ── Spectral Flux ──────────────────────────────────────────────────

function spectralFlux(frames: Frame[]): number[] {
  const flux: number[] = [0];
  for (let i = 1; i < frames.length; i++) {
    const prev = frames[i - 1].mag;
    const curr = frames[i].mag;
    let sum = 0;
    for (let b = 0; b < curr.length; b++) {
      const d = curr[b] - prev[b];
      if (d > 0) sum += d * d;
    }
    flux.push(Math.sqrt(sum));
  }
  return flux;
}

function smooth(arr: number[], radius: number): number[] {
  const out = new Array<number>(arr.length);
  for (let i = 0; i < arr.length; i++) {
    let sum = 0, count = 0;
    const lo = Math.max(0, i - radius);
    const hi = Math.min(arr.length - 1, i + radius);
    for (let j = lo; j <= hi; j++) { sum += arr[j]; count++; }
    out[i] = sum / count;
  }
  return out;
}

// ── Peak Picking ───────────────────────────────────────────────────

function pickPeaks(flux: number[], sensitivity: number, sr: number): TextureBoundary[] {
  const sorted = Float64Array.from(flux).sort();
  const median = sorted[sorted.length >> 1];
  const deviations = Float64Array.from(flux, (v) => Math.abs(v - median)).sort();
  const mad = deviations[deviations.length >> 1];

  const threshold = median + mad * (3 - sensitivity * 2.5);
  const minGap = Math.floor((2.0 * sr) / HOP);

  const peaks: TextureBoundary[] = [];
  let lastIdx = -minGap;

  for (let i = 2; i < flux.length - 2; i++) {
    if (
      flux[i] > threshold &&
      flux[i] >= flux[i - 1] && flux[i] >= flux[i + 1] &&
      flux[i] >= flux[i - 2] && flux[i] >= flux[i + 2] &&
      i - lastIdx >= minGap
    ) {
      peaks.push({ time: (i * HOP) / sr, flux: flux[i] });
      lastIdx = i;
    }
  }
  return peaks;
}

// ── Arc Characterization ───────────────────────────────────────────

function characterizeArc(frames: Frame[], t0: number, t1: number): ArcSegment {
  let bass = 0, mid = 0, high = 0, rms = 0, centroid = 0, flatness = 0, n = 0;
  for (const f of frames) {
    if (f.time < t0 || f.time >= t1) continue;
    bass += f.bass; mid += f.mid; high += f.high;
    rms += f.rms; centroid += f.centroid; flatness += f.flatness;
    n++;
  }
  if (n === 0) return { startTime: t0, endTime: t1, bass: 0, mid: 0, high: 0, rms: 0, centroid: 0, flatness: 0 };
  return {
    startTime: t0, endTime: t1,
    bass: bass / n, mid: mid / n, high: high / n,
    rms: rms / n, centroid: centroid / n, flatness: flatness / n,
  };
}

// ── DSL Generation ─────────────────────────────────────────────────

/** Which audio feature drives each visual parameter */
type FeatureFn = (a: ArcSegment) => number;
const FEATURE_MAP: Record<keyof GenerateRanges, FeatureFn> = {
  density:    (a) => a.rms,
  connect:    (a) => a.high,
  intensity:  (a) => a.bass,
  spread:     (a) => a.mid,
  size:       (a) => a.bass * 0.6 + a.rms * 0.4,
  turbulence: (a) => a.flatness * 0.5 + a.mid * 0.5,
  opacity:    (a) => a.rms,
};

const PAL_NAMES = Object.keys(PALETTES);

function pickPalette(centroidNorm: number, flatness: number): string {
  const idx = Math.floor(centroidNorm * (PAL_NAMES.length - 1));
  const shift = flatness > 0.3 ? 1 : 0;
  return PAL_NAMES[Math.min(idx + shift, PAL_NAMES.length - 1)];
}

function pickDrift(centroidNorm: number, rmsNorm: number): string {
  if (rmsNorm < 0.15) return "still, 0.001";
  if (centroidNorm > 0.7) return "outward, fast";
  if (centroidNorm > 0.4) return "up, " + lerp(0.01, 2.5, rmsNorm).toFixed(2);
  return "down, " + lerp(0.01, 1.5, rmsNorm).toFixed(2);
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

/**
 * Convert analyzed arcs into the sequence DSL.
 *
 * Normalizes every audio feature across all arcs to 0–1,
 * then maps into the user's requested output range.
 * This ensures the full slider range is utilized even when
 * the raw audio features cluster in a narrow band.
 */
export function arcsToSequence(
  arcs: ArcSegment[],
  ranges: GenerateRanges = DEFAULT_RANGES,
  drama = 0.5,
): string {
  if (arcs.length === 0) return "";

  const keys = Object.keys(FEATURE_MAP) as (keyof GenerateRanges)[];

  // Compute raw feature values per arc per param
  const raw: Record<keyof GenerateRanges, number[]> = {} as never;
  for (const k of keys) raw[k] = arcs.map(FEATURE_MAP[k]);

  // Normalize centroid/rms for drift & palette
  const rawCentroid = arcs.map((a) => a.centroid);
  const rawRms = arcs.map((a) => a.rms);
  const rawFlatness = arcs.map((a) => a.flatness);

  function normalizeArr(arr: number[]): number[] {
    let lo = Infinity, hi = -Infinity;
    for (const v of arr) { if (v < lo) lo = v; if (v > hi) hi = v; }
    const span = hi - lo || 1;
    return arr.map((v) => (v - lo) / span);
  }

  const norm: Record<keyof GenerateRanges, number[]> = {} as never;
  for (const k of keys) norm[k] = normalizeArr(raw[k]);

  // Apply drama contrast curve
  const dramaScale = drama * 2; // 0→0, 0.5→1 (identity), 1→2
  for (const k of keys) {
    norm[k] = norm[k].map((v) => Math.max(0, Math.min(1, 0.5 + (v - 0.5) * dramaScale)));
  }
  const normCentroid = normalizeArr(rawCentroid);
  const normRms = normalizeArr(rawRms);

  function mapVal(normalized: number, range: ParamRange): number {
    return range.min + normalized * (range.max - range.min);
  }

  const out: string[] = [""];

  for (let i = 0; i < arcs.length; i++) {
    const a = arcs[i];
    const hasNext = i + 1 < arcs.length;

    function val(k: keyof GenerateRanges, idx: number): number {
      return mapVal(norm[k][idx], ranges[k]);
    }
    function fadeOut(k: keyof GenerateRanges, idx: number): number {
      const v = val(k, idx);
      return ranges[k].min + (v - ranges[k].min) * 0.3;
    }

    const d0 = val("density", i);
    const d1 = hasNext ? val("density", i + 1) : fadeOut("density", i);
    const c0 = val("connect", i);
    const c1 = hasNext ? val("connect", i + 1) : fadeOut("connect", i);
    const i0 = val("intensity", i);
    const i1 = hasNext ? val("intensity", i + 1) : fadeOut("intensity", i);
    const sp0 = val("spread", i);
    const sp1 = hasNext ? val("spread", i + 1) : fadeOut("spread", i);
    const sz0 = val("size", i);
    const sz1 = hasNext ? val("size", i + 1) : fadeOut("size", i);
    const tu0 = val("turbulence", i);
    const tu1 = hasNext ? val("turbulence", i + 1) : fadeOut("turbulence", i);
    const op0 = val("opacity", i);
    const op1 = hasNext ? val("opacity", i + 1) : fadeOut("opacity", i);

    const p0 = pickPalette(normCentroid[i], rawFlatness[i]);
    const p1 = hasNext ? pickPalette(normCentroid[i + 1], rawFlatness[i + 1]) : "void";
    const dr0 = pickDrift(normCentroid[i], normRms[i]);
    const dr1 = hasNext ? pickDrift(normCentroid[i + 1], normRms[i + 1]) : "still, 0.001";

    out.push(`# --- ${fmtTime(a.startTime)} ---`);
    out.push(`density(${f(d0)} | ${f(d1)})`);
    out.push(`connect(${f(c0)} | ${f(c1)})`);
    out.push(`drift(${dr0} | ${dr1})`);
    out.push(`intensity(${f(i0)} | ${f(i1)})`);
    out.push(`spread(${f(sp0)} | ${f(sp1)})`);
    out.push(`size(${f(sz0)} | ${f(sz1)})`);
    out.push(`turbulence(${f(tu0)} | ${f(tu1)})`);
    out.push(`opacity(${f(op0)} | ${f(op1)})`);
    out.push(`palette(${p0} | ${p1})`);
    out.push(`||| ${f(a.startTime)}s ${f(a.endTime)}s`);
    out.push("");
  }

  return out.join("\n");
}

// ── Helpers ────────────────────────────────────────────────────────

function mixToMono(buf: AudioBuffer): Float32Array {
  const len = buf.length;
  const ch = buf.numberOfChannels;
  const mono = new Float32Array(len);
  for (let c = 0; c < ch; c++) {
    const d = buf.getChannelData(c);
    for (let i = 0; i < len; i++) mono[i] += d[i];
  }
  if (ch > 1) { const s = 1 / ch; for (let i = 0; i < len; i++) mono[i] *= s; }
  return mono;
}

function hanningWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
  return w;
}

function f(v: number) { return v.toFixed(3); }
function fmtTime(s: number) {
  return `${Math.floor(s / 60)}:${Math.floor(s % 60).toString().padStart(2, "0")}`;
}
