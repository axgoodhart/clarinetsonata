import { Application, Graphics, Container } from "pixi.js";
import type { FieldState } from "./types";
import { DEFAULT_STATE } from "./types";

const MAX_PARTICLES = 350;

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  baseSize: number;
  opacity: number;
  targetOpacity: number;
  colorIdx: number;
  active: boolean;
}

export class ParticleField {
  private app: Application;
  private particles: Particle[] = [];
  private particleGfx: Graphics[] = [];
  private connectionGfx: Graphics;
  private trailGfx: Graphics;
  private demoGfx: Graphics;
  private particleContainer: Container;
  private state: FieldState = { ...DEFAULT_STATE };
  private width = 0;
  private height = 0;
  private initialized = false;

  constructor(canvas: HTMLCanvasElement) {
    this.app = new Application();
    this.trailGfx = new Graphics();
    this.connectionGfx = new Graphics();
    this.particleContainer = new Container();
    this.demoGfx = new Graphics();

    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({
        x: 0, y: 0, vx: 0, vy: 0,
        baseSize: 1, opacity: 0, targetOpacity: 0,
        colorIdx: 0, active: false,
      });
      this.particleGfx.push(new Graphics());
    }

    this.initApp(canvas);
  }

  private async initApp(canvas: HTMLCanvasElement) {
    const parent = canvas.parentElement;
    if (!parent) return;

    await this.app.init({
      canvas,
      width: parent.clientWidth,
      height: parent.clientHeight,
      background: "#030712",
      antialias: true,
      resolution: Math.min(window.devicePixelRatio, 2),
      autoDensity: true,
    });

    this.width = parent.clientWidth;
    this.height = parent.clientHeight;

    this.app.stage.addChild(this.trailGfx);
    this.app.stage.addChild(this.connectionGfx);
    this.app.stage.addChild(this.particleContainer);
    this.app.stage.addChild(this.demoGfx);

    for (const gfx of this.particleGfx) {
      this.particleContainer.addChild(gfx);
    }

    // We drive rendering from useFrame, not the built-in ticker
    this.app.ticker.stop();

    this.initialized = true;
  }

  resize() {
    if (!this.initialized) return;
    const parent = this.app.canvas.parentElement;
    if (!parent) return;
    this.width = parent.clientWidth;
    this.height = parent.clientHeight;
    this.app.renderer.resize(this.width, this.height);
  }

  setState(state: FieldState) {
    this.state = state;
  }

  reset() {
    for (const p of this.particles) {
      p.active = false;
      p.opacity = 0;
      p.targetOpacity = 0;
    }
    if (this.initialized) {
      this.trailGfx.clear();
      this.connectionGfx.clear();
      this.demoGfx.clear();
      for (const gfx of this.particleGfx) gfx.clear();
      this.trailGfx.rect(0, 0, this.width, this.height).fill({ color: 0x030712 });
      this.app.renderer.render(this.app.stage);
    }
  }

  tick() {
    if (!this.initialized) return;

    const { state, width, height, particles } = this;
    const cx = width / 2;
    const cy = height / 2;

    // --- Manage particle count ---
    const targetCount = Math.round(state.density * MAX_PARTICLES);
    let activeCount = 0;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      if (particles[i].active) activeCount++;
    }

    // Activate particles to reach target
    if (activeCount < targetCount) {
      for (let i = 0; i < MAX_PARTICLES && activeCount < targetCount; i++) {
        if (!particles[i].active) {
          const spawnRadius = state.spread * Math.max(width, height) * 0.5;
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * spawnRadius;
          particles[i].x = cx + Math.cos(angle) * dist;
          particles[i].y = cy + Math.sin(angle) * dist;
          particles[i].vx = (Math.random() - 0.5) * 0.5;
          particles[i].vy = (Math.random() - 0.5) * 0.5;
          particles[i].baseSize = Math.random() * 3 + 1;
          particles[i].opacity = 0;
          particles[i].targetOpacity = 1;
          particles[i].colorIdx = Math.random() > 0.5 ? 0 : 1;
          particles[i].active = true;
          activeCount++;
        }
      }
    }

    // Mark excess for fade-out
    if (activeCount > targetCount) {
      let excess = activeCount - targetCount;
      for (let i = MAX_PARTICLES - 1; i >= 0 && excess > 0; i--) {
        if (particles[i].active && particles[i].targetOpacity > 0) {
          particles[i].targetOpacity = 0;
          excess--;
        }
      }
    }

    // --- Update particles ---
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = particles[i];
      if (!p.active) continue;

      // Fade in/out
      p.opacity += (p.targetOpacity - p.opacity) * 0.05;
      if (p.targetOpacity === 0 && p.opacity < 0.01) {
        p.active = false;
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

    // Trail overlay: lower alpha = longer trails at high intensity
    const trailAlpha = 10 + (1 - state.intensity) * 0.18;
    const trailAlphaNorm = Math.min(1, trailAlpha / 255);
    this.trailGfx.clear();
    this.trailGfx.rect(0, 0, width, height).fill({ color: 0x00030e, alpha: trailAlphaNorm });

    // Connections
    this.connectionGfx.clear();
    const connectDist = state.connect;
    if (connectDist > 0 && state.opacity > 0) {
      const connectDistSq = connectDist * connectDist;
      const colorA = hexToNum(state.paletteA);

      for (let i = 0; i < MAX_PARTICLES; i++) {
        if (!particles[i].active || particles[i].opacity < 0.05) continue;
        for (let j = i + 1; j < MAX_PARTICLES; j++) {
          if (!particles[j].active || particles[j].opacity < 0.05) continue;
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

            this.connectionGfx
              .moveTo(particles[i].x, particles[i].y)
              .lineTo(particles[j].x, particles[j].y)
              .stroke({ color: colorA, alpha: lineOpacity, width: 0.5 });
          }
        }
      }
    }

    // Particles
    const glowOn = state.intensity > 0.3;

    for (let i = 0; i < MAX_PARTICLES; i++) {
      const gfx = this.particleGfx[i];
      gfx.clear();

      const p = particles[i];
      if (!p.active) continue;

      const s = p.baseSize * (0.5 + state.size * 1.5);
      const alpha = p.opacity * state.opacity;
      if (alpha < 0.01) continue;

      const color = p.colorIdx === 0
        ? hexToNum(state.paletteA)
        : hexToNum(state.paletteB);

      // Glow layer: larger, lower-alpha circle behind the particle
      if (glowOn) {
        const glowRadius = s + state.intensity * 8;
        const glowAlpha = alpha * state.intensity * 0.3;
        gfx.circle(p.x, p.y, glowRadius).fill({ color, alpha: glowAlpha });
      }

      // Core particle
      gfx.circle(p.x, p.y, s).fill({ color, alpha });
    }

    // Clear demo overlay (will be drawn separately if needed)
    this.demoGfx.clear();

    // Render the full stage
    this.app.renderer.render(this.app.stage);
  }

  drawDemoOverlay(state: FieldState, progress: number) {
    if (!this.initialized) return;

    const { width, height } = this;
    const cx = width / 2;
    const cy = height / 2;
    const gfx = this.demoGfx;
    // demoGfx was already cleared in tick()

    // Drift arrows
    if (state.driftSpeed > 0) {
      const arrowLen = 30 + state.driftSpeed * 40;
      const arrowColor = 0x22d3ee;
      const arrowAlpha = 0.35;

      if (state.driftMode === "outward") {
        const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        for (const d of dirs) {
          const sx = cx + Math.cos(d) * 15;
          const sy = cy + Math.sin(d) * 15;
          const ex = cx + Math.cos(d) * arrowLen;
          const ey = cy + Math.sin(d) * arrowLen;
          drawArrowPixi(gfx, sx, sy, ex, ey, arrowColor, arrowAlpha);
        }
      } else if (state.driftMode === "inward") {
        const dirs = [0, Math.PI / 2, Math.PI, -Math.PI / 2];
        for (const d of dirs) {
          const sx = cx + Math.cos(d) * arrowLen;
          const sy = cy + Math.sin(d) * arrowLen;
          drawArrowPixi(gfx, sx, sy, cx + Math.cos(d) * 15, cy + Math.sin(d) * 15, arrowColor, arrowAlpha);
        }
      } else {
        const ax = cx + Math.cos(state.driftAngle) * arrowLen;
        const ay = cy + Math.sin(state.driftAngle) * arrowLen;
        drawArrowPixi(gfx, cx, cy, ax, ay, arrowColor, arrowAlpha);
      }
    }

    // Progress bar
    const barY = height - 6;
    const barH = 3;
    const barW = Math.min(200, width * 0.3);
    const barX = (width - barW) / 2;

    gfx.rect(barX, barY, barW, barH).fill({ color: 0x64748b, alpha: 0.1 });
    gfx.rect(barX, barY, barW * progress, barH).fill({ color: 0x22d3ee, alpha: 0.5 });

    // Re-render with overlay
    this.app.renderer.render(this.app.stage);
  }
}

function drawArrowPixi(
  gfx: Graphics,
  x1: number, y1: number,
  x2: number, y2: number,
  color: number, alpha: number,
) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx);
  const headLen = 8;

  // Shaft
  gfx.moveTo(x1, y1).lineTo(x2, y2).stroke({ color, alpha, width: 1.5 });

  // Arrowhead
  gfx.moveTo(x2, y2)
    .lineTo(x2 - headLen * Math.cos(angle - 0.4), y2 - headLen * Math.sin(angle - 0.4))
    .lineTo(x2 - headLen * Math.cos(angle + 0.4), y2 - headLen * Math.sin(angle + 0.4))
    .closePath()
    .fill({ color, alpha });
}

function hexToNum(hex: string): number {
  return parseInt(hex.replace("#", ""), 16);
}
