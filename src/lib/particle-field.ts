import type { FieldState } from "./types";
import { DEFAULT_STATE } from "./types";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseSize: number;
  opacity: number;
  targetOpacity: number;
  colorIdx: number;
}

const MAX_PARTICLES = 350;

export class ParticleField {
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private particles: Particle[] = [];
  private state: FieldState = { ...DEFAULT_STATE };
  private width = 0;
  private height = 0;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d")!;
    this.resize();
  }

  resize() {
    const parent = this.canvas.parentElement;
    if (!parent) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.width = parent.clientWidth;
    this.height = parent.clientHeight;
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.canvas.style.width = this.width + "px";
    this.canvas.style.height = this.height + "px";
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  setState(state: FieldState) {
    this.state = state;
  }

  reset() {
    this.particles = [];
    const { ctx, width, height } = this;
    ctx.fillStyle = "rgba(3, 7, 18, 1)";
    ctx.fillRect(0, 0, width, height);
  }

  tick() {
    const { state, ctx, width, height, particles } = this;
    const cx = width / 2;
    const cy = height / 2;

    // --- Manage particle count ---
    const targetCount = Math.round(state.density * MAX_PARTICLES);

    // Add particles
    while (particles.length < targetCount) {
      const spawnRadius = state.spread * Math.max(width, height) * 0.5;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * spawnRadius;
      particles.push({
        x: cx + Math.cos(angle) * dist,
        y: cy + Math.sin(angle) * dist,
        vx: (Math.random() - 0.5) * 0.5,
        vy: (Math.random() - 0.5) * 0.5,
        baseSize: Math.random() * 3 + 1,
        opacity: 0,
        targetOpacity: 1,
        colorIdx: Math.random() > 0.5 ? 0 : 1,
      });
    }

    // Mark excess for removal
    if (particles.length > targetCount) {
      for (let i = targetCount; i < particles.length; i++) {
        particles[i].targetOpacity = 0;
      }
    }

    // --- Update particles ---
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i];

      // Fade in/out
      p.opacity += (p.targetOpacity - p.opacity) * 0.05;
      if (p.targetOpacity === 0 && p.opacity < 0.01) {
        particles.splice(i, 1);
        continue;
      }

      // Drift
      if (state.driftSpeed > 0) {
        const force = state.driftSpeed * 0.15;
        if (state.driftMode === "outward") {
          const dx = p.x - cx;
          const dy = p.y - cy;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          p.vx += (dx / d) * force;
          p.vy += (dy / d) * force;
        } else if (state.driftMode === "inward") {
          const dx = cx - p.x;
          const dy = cy - p.y;
          const d = Math.sqrt(dx * dx + dy * dy) || 1;
          p.vx += (dx / d) * force;
          p.vy += (dy / d) * force;
        } else {
          p.vx += Math.cos(state.driftAngle) * force;
          p.vy += Math.sin(state.driftAngle) * force;
        }
      }

      // Turbulence
      if (state.turbulence > 0) {
        p.vx += (Math.random() - 0.5) * state.turbulence * 0.8;
        p.vy += (Math.random() - 0.5) * state.turbulence * 0.8;
      }

      // Spread: attract toward center when spread is low
      const spreadForce = (1 - state.spread) * 0.02;
      if (spreadForce > 0.001) {
        p.vx += (cx - p.x) * spreadForce * 0.01;
        p.vy += (cy - p.y) * spreadForce * 0.01;
      }

      // Damping
      p.vx *= 0.96;
      p.vy *= 0.96;

      // Move
      p.x += p.vx;
      p.y += p.vy;

      // Wrap at edges
      const margin = 50;
      if (p.x < -margin) p.x = width + margin;
      if (p.x > width + margin) p.x = -margin;
      if (p.y < -margin) p.y = height + margin;
      if (p.y > height + margin) p.y = -margin;
    }

    // --- Draw ---

    // Trail: lower alpha = longer trails = more depth at high intensity
    const trailAlpha = 10 + (1 - state.intensity) * 0.18;
    ctx.fillStyle = `rgba(0,3,14, ${trailAlpha})`;
    ctx.fillRect(0, 0, width, height);

    // Connections
    const connectDist = state.connect;
    if (connectDist > 0 && state.opacity > 0) {
      const connectDistSq = connectDist * connectDist;
      ctx.lineWidth = 0.5;
      for (let i = 0; i < particles.length; i++) {
        if (particles[i].opacity < 0.05) continue;
        for (let j = i + 1; j < particles.length; j++) {
          if (particles[j].opacity < 0.05) continue;
          const dx = particles[i].x - particles[j].x;
          const dy = particles[i].y - particles[j].y;
          const distSq = dx * dx + dy * dy;
          if (distSq < connectDistSq) {
            const dist = Math.sqrt(distSq);
            const lineOpacity =
              (1 - dist / connectDist) *
              state.opacity *
              Math.min(particles[i].opacity, particles[j].opacity) *
              0.3;
            ctx.strokeStyle = hexToRgba(state.paletteA, lineOpacity);
            ctx.beginPath();
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }
    }

    // Particles
    const glowOn = state.intensity > 0.3;
    if (glowOn) {
      ctx.shadowBlur = state.intensity * 15;
    }

    for (const p of particles) {
      const s = p.baseSize * (0.5 + state.size * 1.5);
      const alpha = p.opacity * state.opacity;
      if (alpha < 0.01) continue;
      const color = p.colorIdx === 0 ? state.paletteA : state.paletteB;

      if (glowOn) {
        ctx.shadowColor = color;
      }

      ctx.fillStyle = hexToRgba(color, alpha);
      ctx.beginPath();
      ctx.arc(p.x, p.y, s, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.shadowBlur = 0;
    ctx.shadowColor = "transparent";
  }

  /**
   * Draw demo overlay: drift arrow + progress bar.
   * Called after tick() during demo mode.
   */
  drawDemoOverlay(state: FieldState, progress: number) {
    const { ctx, width, height } = this;
    const cx = width / 2;
    const cy = height / 2;

    // Drift arrow
    if (state.driftSpeed > 0) {
      const arrowLen = 30 + state.driftSpeed * 40;
      let ax: number, ay: number;

      if (state.driftMode === "outward") {
        // Draw 4 arrows pointing outward
        const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        for (const d of dirs) {
          const ex = cx + Math.cos(d) * arrowLen;
          const ey = cy + Math.sin(d) * arrowLen;
          drawArrow(ctx, cx + Math.cos(d) * 15, cy + Math.sin(d) * 15, ex, ey);
        }
      } else if (state.driftMode === "inward") {
        const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        for (const d of dirs) {
          const sx = cx + Math.cos(d) * arrowLen;
          const sy = cy + Math.sin(d) * arrowLen;
          drawArrow(ctx, sx, sy, cx + Math.cos(d) * 15, cy + Math.sin(d) * 15);
        }
      } else {
        ax = cx + Math.cos(state.driftAngle) * arrowLen;
        ay = cy + Math.sin(state.driftAngle) * arrowLen;
        drawArrow(ctx, cx, cy, ax, ay);
      }
    }

    // Progress bar at bottom
    const barY = height - 6;
    const barH = 3;
    const barW = Math.min(200, width * 0.3);
    const barX = (width - barW) / 2;

    ctx.fillStyle = "rgba(100, 116, 139, 0.1)";
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = "rgba(34, 211, 238, 0.5)";
    ctx.fillRect(barX, barY, barW * progress, barH);

    // "DEMO" label
    ctx.font = '9px "SF Mono", "Fira Code", monospace';
    ctx.textAlign = "center";
    ctx.fillStyle = "rgba(34, 211, 238, 0.3)";
    ctx.fillText("DEMO", width / 2, barY - 6);
  }
}

function drawArrow(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1: number,
  x2: number,
  y2: number
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const headLen = 8;

  ctx.strokeStyle = "rgba(34, 211, 238, 0.35)";
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();

  ctx.fillStyle = "rgba(34, 211, 238, 0.35)";
  ctx.beginPath();
  ctx.moveTo(x2, y2);
  ctx.lineTo(
    x2 - headLen * Math.cos(angle - 0.4),
    y2 - headLen * Math.sin(angle - 0.4)
  );
  ctx.lineTo(
    x2 - headLen * Math.cos(angle + 0.4),
    y2 - headLen * Math.sin(angle + 0.4)
  );
  ctx.closePath();
  ctx.fill();
}

function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
