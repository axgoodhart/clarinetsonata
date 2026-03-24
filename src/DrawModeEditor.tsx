import { useRef, useState, useCallback, useEffect } from "react";
import { CurveStore, CURVE_PARAMS, PALETTE_NAMES, paletteColors, type CurveParamKey } from "./lib/curve-data";
import { ParticleField } from "./lib/particle-field-gl";
import { SequenceEngine } from "./lib/sequence-engine";
import { useFrame } from "./hooks/useFrame";

interface DrawModeEditorProps {
  curves: CurveStore;
  currentTime: number;
  totalDuration: number;
  onCurvesChanged: () => void;
}

export default function DrawModeEditor({
  curves,
  currentTime,
  totalDuration,
  onCurvesChanged,
}: DrawModeEditorProps) {
  const graphCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);
  const previewFieldRef = useRef<ParticleField | null>(null);
  const previewEngineRef = useRef<SequenceEngine | null>(null);
  const graphContainerRef = useRef<HTMLDivElement>(null);

  const [activeParam, setActiveParam] = useState<CurveParamKey>("density");
  const activeParamRef = useRef<CurveParamKey>("density");
  const isDrawing = useRef(false);
  const lastDrawPoint = useRef<{ time: number; norm: number } | null>(null);

  const selectParam = useCallback((key: CurveParamKey) => {
    activeParamRef.current = key;
    setActiveParam(key);
  }, []);

  // Joystick state
  const [joyActive, setJoyActive] = useState(false);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const joyRef = useRef<HTMLDivElement>(null);
  const joyPosRef = useRef({ x: 0, y: 0 });

  const handleJoyDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setJoyActive(true);
  }, []);

  const handleJoyMove = useCallback((e: React.PointerEvent) => {
    if (!joyActive) return;
    const pad = joyRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width / 2;
    let dx = (e.clientX - cx) / radius;
    let dy = (e.clientY - cy) / radius;
    // Clamp to unit circle
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) { dx /= dist; dy /= dist; }
    joyPosRef.current = { x: dx, y: dy };
    setJoyPos({ x: dx, y: dy });
  }, [joyActive]);

  const handleJoyUp = useCallback(() => {
    setJoyActive(false);
    joyPosRef.current = { x: 0, y: 0 };
    setJoyPos({ x: 0, y: 0 });
  }, []);

  // Palette state
  const [currentPalette, setCurrentPalette] = useState(() => curves.getPalette(currentTime));

  const cyclePalette = useCallback((dir: number) => {
    setCurrentPalette((prev) => {
      const next = (prev + dir + PALETTE_NAMES.length) % PALETTE_NAMES.length;
      return next;
    });
  }, []);

  // When drawing on the curve graph, also record current drift + palette
  const recordDriftAndPalette = useCallback((time: number) => {
    const jp = joyPosRef.current;
    curves.setDrift(time, jp.x, jp.y);
    curves.setPalette(time, currentPalette);
  }, [curves, currentPalette]);

  // Init preview field
  useEffect(() => {
    const canvas = previewCanvasRef.current;
    if (!canvas) return;
    const field = new ParticleField(canvas);
    previewFieldRef.current = field;
    const engine = new SequenceEngine();
    previewEngineRef.current = engine;
    engine.load(curves.toKeyframes());
    return () => { previewFieldRef.current = null; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Update preview engine when curves change
  const syncPreview = useCallback(() => {
    previewEngineRef.current?.load(curves.toKeyframes());
  }, [curves]);

  // Preview render loop
  useFrame(() => {
    const field = previewFieldRef.current;
    const engine = previewEngineRef.current;
    if (!field || !engine) return;
    const state = engine.getStateAtTime(currentTime);
    field.setState(state);
    field.tick();
  });

  // Graph dimensions helpers
  const getGraphRect = useCallback(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return { left: 0, top: 0, width: 1, height: 1 };
    const rect = canvas.getBoundingClientRect();
    return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
  }, []);

  const posToTimeNorm = useCallback(
    (clientX: number, clientY: number) => {
      const r = getGraphRect();
      const pad = 0;
      const time = ((clientX - r.left - pad) / (r.width - pad * 2)) * totalDuration;
      const norm = 1 - (clientY - r.top) / r.height;
      return {
        time: Math.max(0, Math.min(totalDuration, time)),
        norm: Math.max(0, Math.min(1, norm)),
      };
    },
    [getGraphRect, totalDuration],
  );

  // Drawing handlers — use activeParamRef to avoid stale closures
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
      isDrawing.current = true;
      const pt = posToTimeNorm(e.clientX, e.clientY);
      curves.setNormalized(activeParamRef.current, pt.time, pt.norm);
      recordDriftAndPalette(pt.time);
      lastDrawPoint.current = pt;
      onCurvesChanged();
      syncPreview();
    },
    [curves, onCurvesChanged, posToTimeNorm, syncPreview, recordDriftAndPalette],
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (!isDrawing.current) return;
      const pt = posToTimeNorm(e.clientX, e.clientY);
      const prev = lastDrawPoint.current;
      if (prev) {
        curves.paintNormalized(activeParamRef.current, prev.time, prev.norm, pt.time, pt.norm);
        // Also paint drift between points
        const jp = joyPosRef.current;
        curves.paintDrift(prev.time, jp.x, jp.y, pt.time, jp.x, jp.y);
      } else {
        curves.setNormalized(activeParamRef.current, pt.time, pt.norm);
      }
      recordDriftAndPalette(pt.time);
      lastDrawPoint.current = pt;
      onCurvesChanged();
      syncPreview();
    },
    [curves, onCurvesChanged, posToTimeNorm, syncPreview, recordDriftAndPalette],
  );

  const handlePointerUp = useCallback(() => {
    isDrawing.current = false;
    lastDrawPoint.current = null;
  }, []);

  // Draw the graph canvas
  useFrame(() => {
    const canvas = graphCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const container = graphContainerRef.current;
    if (!container) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    const w = container.clientWidth;
    const h = container.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // Background
    ctx.fillStyle = "rgba(3, 7, 18, 0.95)";
    ctx.fillRect(0, 0, w, h);

    // Grid lines
    ctx.strokeStyle = "rgba(100, 116, 139, 0.08)";
    ctx.lineWidth = 1;
    for (let i = 1; i < 4; i++) {
      const y = (i / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }
    // Vertical time grid (every 30s)
    if (totalDuration > 0) {
      const step = totalDuration > 120 ? 30 : totalDuration > 30 ? 10 : 5;
      for (let t = step; t < totalDuration; t += step) {
        const x = (t / totalDuration) * w;
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, h);
        ctx.stroke();
      }
    }

    // Draw all curves
    for (const paramDef of CURVE_PARAMS) {
      const isActive = paramDef.key === activeParam;
      const arr = curves.data[paramDef.key];
      const pDef = paramDef;
      const range = pDef.max - pDef.min;

      ctx.strokeStyle = isActive ? pDef.color : pDef.color + "30";
      ctx.lineWidth = isActive ? 2.5 : 1;
      ctx.setLineDash(isActive ? [] : [3, 4]);

      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const x = (i / (arr.length - 1)) * w;
        const norm = (arr[i] - pDef.min) / range;
        const y = (1 - norm) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      // Dot markers for active param
      if (isActive) {
        const dotStep = Math.max(1, Math.floor(arr.length / 80));
        ctx.fillStyle = pDef.color;
        for (let i = 0; i < arr.length; i += dotStep) {
          const x = (i / (arr.length - 1)) * w;
          const norm = (arr[i] - pDef.min) / range;
          const y = (1 - norm) * h;
          ctx.beginPath();
          ctx.arc(x, y, 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
      }
    }

    // Playhead
    if (totalDuration > 0) {
      const px = (currentTime / totalDuration) * w;

      // Vertical line
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();

      // Glowing orb on active curve
      const activeDef = CURVE_PARAMS.find((p) => p.key === activeParam)!;
      const val = curves.getValue(activeParam, currentTime);
      const norm = (val - activeDef.min) / (activeDef.max - activeDef.min);
      const orbY = (1 - norm) * h;

      // Outer glow
      const grad = ctx.createRadialGradient(px, orbY, 0, px, orbY, 18);
      grad.addColorStop(0, activeDef.color + "aa");
      grad.addColorStop(0.5, activeDef.color + "33");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, orbY, 18, 0, Math.PI * 2);
      ctx.fill();

      // Inner orb
      ctx.fillStyle = activeDef.color;
      ctx.beginPath();
      ctx.arc(px, orbY, 5, 0, Math.PI * 2);
      ctx.fill();

      // White ring
      ctx.strokeStyle = "rgba(255, 255, 255, 0.6)";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(px, orbY, 8, 0, Math.PI * 2);
      ctx.stroke();
    }
  });

  // Resize preview on mount
  useEffect(() => {
    const obs = new ResizeObserver(() => previewFieldRef.current?.resize());
    const el = previewCanvasRef.current?.parentElement;
    if (el) obs.observe(el);
    return () => obs.disconnect();
  }, []);

  const activeDef = CURVE_PARAMS.find((p) => p.key === activeParam)!;

  return (
    <div className="draw-mode">
      {/* Left panel — parameter selector */}
      <div className="draw-param-panel">
        <div className="draw-mode-label">DRAW MODE</div>
        <div className="draw-param-list">
          {CURVE_PARAMS.map((p) => {
            const val = curves.getValue(p.key, currentTime);
            const isActive = p.key === activeParam;
            const displayVal = p.max > 1 ? Math.round(val) : Math.round(val * 100);
            return (
              <button
                key={p.key}
                className={`draw-param-item${isActive ? " active" : ""}`}
                style={{ "--param-color": p.color } as React.CSSProperties}
                onClick={() => selectParam(p.key)}
              >
                <span className="draw-param-name">{p.label}</span>
                <span className="draw-param-val">{displayVal}</span>
                <span className="draw-param-dot" />
              </button>
            );
          })}
        </div>

        {/* Palette picker */}
        <div className="draw-palette-picker">
          <span className="draw-palette-label">Palette</span>
          <div className="draw-palette-row">
            <button className="draw-palette-arrow" onClick={() => cyclePalette(-1)}>&lt;</button>
            <div className="draw-palette-swatch">
              <div style={{ background: paletteColors(currentPalette)[0] }} />
              <div style={{ background: paletteColors(currentPalette)[1] }} />
            </div>
            <span className="draw-palette-name">{PALETTE_NAMES[currentPalette]}</span>
            <button className="draw-palette-arrow" onClick={() => cyclePalette(1)}>&gt;</button>
          </div>
        </div>

        {/* Joystick (sidebar preview — small) */}
        {!joyActive && (
          <div className="draw-joy-sidebar">
            <span className="draw-joy-label">Drift</span>
            <div
              className="draw-joy-pad"
              ref={joyRef}
              onPointerDown={handleJoyDown}
              onPointerMove={handleJoyMove}
              onPointerUp={handleJoyUp}
            >
              <div className="draw-joy-ring" />
              <div
                className="draw-joy-knob"
                style={{ transform: `translate(${joyPos.x * 30}px, ${joyPos.y * 30}px)` }}
              />
            </div>
          </div>
        )}
      </div>

      {/* Floating joystick — center bottom when active */}
      {joyActive && (
        <div className="draw-joy-float">
          <div
            className="draw-joy-pad large"
            ref={joyRef}
            onPointerDown={handleJoyDown}
            onPointerMove={handleJoyMove}
            onPointerUp={handleJoyUp}
          >
            <div className="draw-joy-ring" />
            <div
              className="draw-joy-knob"
              style={{ transform: `translate(${joyPos.x * 60}px, ${joyPos.y * 60}px)` }}
            />
            <span className="draw-joy-speed">{(Math.sqrt(joyPos.x ** 2 + joyPos.y ** 2) * 100).toFixed(0)}%</span>
          </div>
        </div>
      )}

      {/* Center area */}
      <div className="draw-center">
        {/* Preview window */}
        <div className="draw-preview-wrap">
          <span className="draw-preview-label">Preview</span>
          <div className="draw-preview">
            <canvas ref={previewCanvasRef} className="draw-preview-canvas" />
          </div>
        </div>

        {/* Stats */}
        <div className="draw-stats">
          <span>{curves.eventCount} events</span>
          <span>parameter resolution: {curves.resolution}/s</span>
        </div>

        {/* Curve graph */}
        <div className="draw-graph-wrap" ref={graphContainerRef}>
          <canvas
            ref={graphCanvasRef}
            className="draw-graph-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
          {/* Y-axis labels */}
          <span
            className="draw-axis-label draw-axis-high"
            style={{ color: activeDef.color }}
          >
            {activeDef.label} <span style={{ opacity: 0.5 }}>HIGH</span>
          </span>
          <span className="draw-axis-label draw-axis-low" style={{ color: activeDef.color, opacity: 0.5 }}>
            LOW
          </span>
        </div>
      </div>
    </div>
  );
}
