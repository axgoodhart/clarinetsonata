export type FieldState = {
  density: number;
  connect: number;
  driftAngle: number;
  driftSpeed: number;
  driftMode: "directional" | "outward" | "inward";
  intensity: number;
  spread: number;
  size: number;
  turbulence: number;
  paletteA: string;
  paletteB: string;
  opacity: number;
}

export type Keyframe = {
  time: number;
  state: Partial<FieldState>;
  snap: boolean;
}

export const DEFAULT_STATE: FieldState = {
  density: 0.25,
  connect: 80,
  driftAngle: -Math.PI / 2,
  driftSpeed: 0.3,
  driftMode: "directional",
  intensity: 0.4,
  spread: 0.7,
  size: 0.5,
  turbulence: 0.15,
  paletteA: "#60a5fa",
  paletteB: "#a78bfa",
  opacity: 0.6,
};

export const PALETTES: Record<string, [string, string]> = {
  cold: ["#ffffff", "#084027"],
  cool: ["#60a5fa", "#a78bfa"],
  warm: ["#f59e0b", "#ef4444"],
  mono: ["#94a3b8", "#e2e8f0"],
  ember: ["#dc2626", "#f97316"],
  forest: ["#10b981", "#06b6d4"],
  void: ["#1e293b", "#334155"],
  rose: ["#f43f5e", "#ec4899"],
  aurora: ["#22d3ee", "#a78bfa"],
};

export const DIRECTIONS: Record<string, number> = {
  up: -Math.PI / 2,
  down: Math.PI / 2,
  left: Math.PI,
  right: 0,
  upleft: (-3 * Math.PI) / 4,
  upright: -Math.PI / 4,
  downleft: (3 * Math.PI) / 4,
  downright: Math.PI / 4,
};

export const SPEEDS: Record<string, number> = {
  still: 0,
  slow: 0.3,
  medium: 1.0,
  fast: 2.5,
};
