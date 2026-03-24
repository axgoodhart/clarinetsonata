import type { Keyframe } from "./types";
import { PALETTES, DIRECTIONS, SPEEDS } from "./types";

export function parseSequence(dsl: string): Keyframe[] {
  const keyframes: Keyframe[] = [];
  const lines = dsl.split("\n");

  // Collect lines into phrase blocks.
  // A phrase block is a group of parameter lines ending with a ||| time line.
  // Legacy single-line format (params || time) is also supported.
  let currentParams: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    // Phrase time line: ||| startTime endTime [snap]
    const phraseTimeMatch = line.match(
      /^\|{3}\s+([\d.]+)s\s+([\d.]+)s\s*(snap)?$/
    );
    if (phraseTimeMatch) {
      const startTime = parseFloat(phraseTimeMatch[1]);
      const endTime = parseFloat(phraseTimeMatch[2]);
      const snap = !!phraseTimeMatch[3];

      // Parse each param line for begin|end values
      const startState: Record<string, unknown> = {};
      const endState: Record<string, unknown> = {};

      for (const paramLine of currentParams) {
        // Format: paramName(beginVal | endVal)
        const match = paramLine.match(/^(\w+)\((.+)\)$/);
        if (!match) continue;
        const [, name, inner] = match;

        // Split on | to get begin and end (pipe separates begin|end)
        const sides = inner.split("|").map((s) => s.trim());
        const beginStr = sides[0];
        const endStr = sides.length > 1 ? sides[1] : beginStr;

        applyParam(name, beginStr, startState);
        applyParam(name, endStr, endState);
      }

      keyframes.push({ time: startTime, state: startState, snap: false });
      keyframes.push({ time: endTime, state: endState, snap });

      currentParams = [];
      continue;
    }

    // Legacy single-line format: params || time
    if (line.includes("||")) {
      const sides = line.split("||").map((s) => s.trim());
      if (sides.length >= 2) {
        const timeMatch = sides[1].match(/([\d.]+)s/);
        if (timeMatch) {
          const time = parseFloat(timeMatch[1]);
          const snap = sides[1].includes("snap");
          const state: Record<string, unknown> = {};
          const params = sides[0].split("|").map((s) => s.trim());
          for (const param of params) {
            const match = param.match(/^(\w+)\((.+)\)$/);
            if (!match) continue;
            applyParam(match[1], match[2], state);
          }
          keyframes.push({ time, state, snap });
          continue;
        }
      }
    }

    // Otherwise it's a parameter line for a phrase block
    if (line.match(/^\w+\(/)) {
      currentParams.push(line);
    }
  }

  return keyframes.sort((a, b) => a.time - b.time);
}

function applyParam(
  name: string,
  valueStr: string,
  state: Record<string, unknown>
) {
  const args = valueStr.split(",").map((s) => s.trim());

  switch (name) {
    case "density":
      state.density = clamp(parseFloat(args[0]), 0, 1);
      break;
    case "connect":
      state.connect = Math.max(0, parseFloat(args[0]));
      break;
    case "drift": {
      const dir = args[0]?.toLowerCase();
      if (dir === "outward") {
        state.driftMode = "outward";
        state.driftSpeed = args[1] ? parseSpeed(args[1]) : 1.0;
      } else if (dir === "inward") {
        state.driftMode = "inward";
        state.driftSpeed = args[1] ? parseSpeed(args[1]) : 1.0;
      } else if (dir === "still") {
        state.driftMode = "directional";
        state.driftSpeed = 0;
      } else {
        state.driftMode = "directional";
        state.driftAngle = DIRECTIONS[dir] ?? parseFloat(dir);
        state.driftSpeed = args[1] ? parseSpeed(args[1]) : 1.0;
      }
      break;
    }
    case "intensity":
      state.intensity = clamp(parseFloat(args[0]), 0, 1);
      break;
    case "spread":
      state.spread = clamp(parseFloat(args[0]), 0, 1);
      break;
    case "size":
      state.size = clamp(parseFloat(args[0]), 0, 1);
      break;
    case "turbulence":
      state.turbulence = clamp(parseFloat(args[0]), 0, 1);
      break;
    case "opacity":
      state.opacity = clamp(parseFloat(args[0]), 0, 1);
      break;
    case "palette": {
      if (args.length >= 2 && args[0].startsWith("#")) {
        state.paletteA = args[0];
        state.paletteB = args[1];
      } else {
        const p = PALETTES[args[0].toLowerCase()];
        if (p) {
          state.paletteA = p[0];
          state.paletteB = p[1];
        }
      }
      break;
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function parseSpeed(s: string): number {
  const named = SPEEDS[s.toLowerCase()];
  return named !== undefined ? named : parseFloat(s) || 1.0;
}
