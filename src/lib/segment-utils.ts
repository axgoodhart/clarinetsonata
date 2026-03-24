/**
 * Utilities for parsing DSL text into structured segments
 * and serializing them back. Used by the SegmentEditor UI.
 */

export interface SegmentParams {
  density: { a: number; b: number };
  connect: { a: number; b: number };
  intensity: { a: number; b: number };
  spread: { a: number; b: number };
  size: { a: number; b: number };
  turbulence: { a: number; b: number };
  opacity: { a: number; b: number };
  drift: { dirA: string; magA: string; dirB: string; magB: string };
  palette: { a: string; b: string };
}

export interface Segment {
  name: string;
  startTime: number;
  endTime: number;
  snap: boolean;
  params: SegmentParams;
  rawLines: string[]; // original lines for reconstruction
}

export const NUMERIC_PARAMS = [
  { key: "density" as const, min: 0, max: 1, step: 0.001 },
  { key: "connect" as const, min: 0, max: 200, step: 0.1 },
  { key: "intensity" as const, min: 0, max: 1, step: 0.001 },
  { key: "spread" as const, min: 0, max: 10, step: 0.001 },
  { key: "size" as const, min: 0.001, max: 1, step: 0.001 },
  { key: "turbulence" as const, min: 0, max: 1, step: 0.001 },
  { key: "opacity" as const, min: 0, max: 1, step: 0.001 },
] as const;

export type NumericParamKey = (typeof NUMERIC_PARAMS)[number]["key"];

const DIRECTIONS = [
  "still",
  "up",
  "down",
  "left",
  "right",
  "inward",
  "outward",
  "upleft",
  "upright",
  "downleft",
  "downright",
];
const DRIFT_MAGS = ["0.001", "0.005", "0.01", "0.02", "0.05", "0.1", "0.3", "slow", "fast"];
const PALETTE_NAMES = [
  "cold",
  "cool",
  "warm",
  "mono",
  "ember",
  "forest",
  "void",
  "rose",
  "aurora",
];

export { DIRECTIONS, DRIFT_MAGS, PALETTE_NAMES };

function fmt(v: number): string {
  return String(Math.round(v * 1000) / 1000);
}

function defaultParams(): SegmentParams {
  return {
    density: { a: 0.1, b: 0.5 },
    connect: { a: 20, b: 80 },
    intensity: { a: 0.1, b: 0.3 },
    spread: { a: 1, b: 2 },
    size: { a: 0.1, b: 0.5 },
    turbulence: { a: 0.1, b: 0.5 },
    opacity: { a: 0.2, b: 1 },
    drift: { dirA: "still", magA: "0.01", dirB: "up", magB: "0.01" },
    palette: { a: "cold", b: "cool" },
  };
}

/**
 * Parse DSL text into an array of Segments.
 */
export function parseSegments(dsl: string): Segment[] {
  const segments: Segment[] = [];
  const lines = dsl.split("\n");

  let currentName = "";
  let currentParamLines: string[] = [];
  let blockStartIdx = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();

    // Comment/name line
    if (line.startsWith("#")) {
      const nameMatch = line.match(/^#\s*---\s*(.*?)\s*---\s*$/);
      if (nameMatch) {
        currentName = nameMatch[1];
        blockStartIdx = i;
      }
      continue;
    }

    if (!line) continue;

    // Time line ending a phrase block
    const timeMatch = line.match(/^\|{3}\s+([\d.]+)s\s+([\d.]+)s\s*(snap)?$/);
    if (timeMatch) {
      const startTime = parseFloat(timeMatch[1]);
      const endTime = parseFloat(timeMatch[2]);
      const snap = !!timeMatch[3];

      const params = defaultParams();

      for (const paramLine of currentParamLines) {
        const match = paramLine.match(/^(\w+)\((.+)\)$/);
        if (!match) continue;
        const [, name, inner] = match;
        const sides = inner.split("|").map((s) => s.trim());
        const beginStr = sides[0];
        const endStr = sides.length > 1 ? sides[1] : beginStr;

        parseParamInto(name, beginStr, endStr, params);
      }

      segments.push({
        name: currentName,
        startTime,
        endTime,
        snap,
        params,
        rawLines: lines.slice(blockStartIdx, i + 1),
      });

      currentName = "";
      currentParamLines = [];
      blockStartIdx = i + 1;
      continue;
    }

    // Parameter line
    if (line.match(/^\w+\(/)) {
      currentParamLines.push(line);
    }
  }

  return segments;
}

function parseParamInto(
  name: string,
  beginStr: string,
  endStr: string,
  params: SegmentParams
) {
  switch (name) {
    case "density":
    case "connect":
    case "intensity":
    case "spread":
    case "size":
    case "turbulence":
    case "opacity":
      params[name] = {
        a: parseFloat(beginStr) || 0,
        b: parseFloat(endStr) || 0,
      };
      break;
    case "drift": {
      const aArgs = beginStr.split(",").map((s) => s.trim());
      const bArgs = endStr.split(",").map((s) => s.trim());
      params.drift = {
        dirA: aArgs[0] || "still",
        magA: aArgs[1] || "0.01",
        dirB: bArgs[0] || "still",
        magB: bArgs[1] || "0.01",
      };
      break;
    }
    case "palette":
      params.palette = {
        a: beginStr.trim(),
        b: endStr.trim(),
      };
      break;
  }
}

/**
 * Serialize segments back into DSL text.
 */
export function serializeSegments(segments: Segment[]): string {
  return segments
    .map((seg) => {
      const p = seg.params;
      const lines = [];
      if (seg.name) lines.push(`# --- ${seg.name} ---`);
      lines.push(`density(${fmt(p.density.a)} | ${fmt(p.density.b)})`);
      lines.push(`connect(${fmt(p.connect.a)} | ${fmt(p.connect.b)})`);
      lines.push(
        `drift(${p.drift.dirA}, ${p.drift.magA} | ${p.drift.dirB}, ${p.drift.magB})`
      );
      lines.push(`intensity(${fmt(p.intensity.a)} | ${fmt(p.intensity.b)})`);
      lines.push(`spread(${fmt(p.spread.a)} | ${fmt(p.spread.b)})`);
      lines.push(`size(${fmt(p.size.a)} | ${fmt(p.size.b)})`);
      lines.push(`turbulence(${fmt(p.turbulence.a)} | ${fmt(p.turbulence.b)})`);
      lines.push(`opacity(${fmt(p.opacity.a)} | ${fmt(p.opacity.b)})`);
      lines.push(`palette(${p.palette.a} | ${p.palette.b})`);
      lines.push(
        `||| ${fmt(seg.startTime)}s ${fmt(seg.endTime)}s${seg.snap ? " snap" : ""}`
      );
      return lines.join("\n");
    })
    .join("\n\n");
}
