// ── Web Worker for audio analysis (self-contained, no imports) ────

type TextureBoundary = {
  time: number;
  flux: number;
};

type ArcSegment = {
  startTime: number;
  endTime: number;
  bass: number;
  mid: number;
  high: number;
  rms: number;
  centroid: number;
  flatness: number;
};

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

// ── Config ─────────────────────────────────────────────────────────

const FFT_SIZE = 2048;
const HOP = 512;

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

// ── Hanning Window ─────────────────────────────────────────────────

function hanningWindow(size: number): Float32Array {
  const w = new Float32Array(size);
  for (let i = 0; i < size; i++) w[i] = 0.5 * (1 - Math.cos(2 * Math.PI * i / (size - 1)));
  return w;
}

// ── Frame Extraction ───────────────────────────────────────────────

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

// ── Smoothing ──────────────────────────────────────────────────────

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

// ── Worker Message Handler ─────────────────────────────────────────

self.onmessage = (e: MessageEvent) => {
  const { channelData, sampleRate, duration, sensitivity, forcedBoundaries = [] } = e.data;

  // Mix to mono from raw channel arrays
  const numChannels = channelData.length;
  const len = channelData[0].length;
  const mono = new Float32Array(len);
  for (let c = 0; c < numChannels; c++) {
    const d = channelData[c];
    for (let i = 0; i < len; i++) mono[i] += d[i];
  }
  if (numChannels > 1) {
    const s = 1 / numChannels;
    for (let i = 0; i < len; i++) mono[i] *= s;
  }

  const frames = extractFrames(mono, sampleRate);
  const flux = spectralFlux(frames);
  const smoothed = smooth(flux, 8);
  const peaks = pickPeaks(smoothed, sensitivity, sampleRate);

  // Merge auto-detected peaks with forced boundaries (forced wins within 0.5s)
  const autoTimes = peaks.map((p: TextureBoundary) => p.time);
  const forced = (forcedBoundaries as number[]).filter((t: number) => t > 0 && t < duration);
  const merged = autoTimes.filter(
    (at: number) => !forced.some((ft: number) => Math.abs(at - ft) < 0.5),
  );
  const allBoundaries = [...merged, ...forced].sort((a: number, b: number) => a - b);
  const deduped: number[] = [];
  for (const t of allBoundaries) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1] > 0.025) {
      deduped.push(t);
    }
  }
  const times = [0, ...deduped, duration];
  const arcs: ArcSegment[] = [];
  for (let i = 0; i < times.length - 1; i++) {
    const t0 = times[i];
    const t1 = times[i + 1];
    if (t1 - t0 < 0.5) continue;
    arcs.push(characterizeArc(frames, t0, t1));
  }

  self.postMessage({ boundaries: peaks, arcs });
};
