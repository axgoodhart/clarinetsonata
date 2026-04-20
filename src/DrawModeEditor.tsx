import { useRef, useState, useCallback, useEffect } from "react";
import { CurveStore, CURVE_PARAMS, paletteColors, type CurveParamKey } from "./lib/curve-data";
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

  // Palette state
  const [currentPalette, setCurrentPalette] = useState(() => curves.getPalette(currentTime));

  // Joystick state
  const [joyActive, setJoyActive] = useState(false);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const joyRef = useRef<HTMLDivElement>(null);
  const joyPosRef = useRef({ x: 0, y: 0 });

  // Performance Capture State
  const [convergence, setConvergence] = useState(3); // 1-5 scale
  const [revision, setRevision] = useState(0);
  const [glyphs, setGlyphs] = useState<{ id: string; x: number; y: number; angle: number }[]>([]);

  const TARGET_STEPS = 40;
  const STRIP_GAP = totalDuration / TARGET_STEPS;
  const numSteps = TARGET_STEPS;

  const selectParam = useCallback((key: CurveParamKey) => {
    activeParamRef.current = key;
    setActiveParam(key);
  }, []);

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

    // Performance Recording (Full High-Res Data)
    const angle = Math.atan2(dy, dx);
    const time = currentTime;

    // Map 1-5 to engine mode (0=dir, 1=in, 2=out)
    const mode = convergence <= 2 ? 1 : convergence >= 4 ? 2 : 0;
    curves.setDrift(time, dx, dy, mode);
    curves.setPalette(time, currentPalette);
    
    // Notify system and force UI refresh for sampled strip
    onCurvesChanged();
    setRevision(r => r + 1);

    // Spawn visual "treat"
    if (Math.random() > 0.75) {
      const id = Math.random().toString(36).substring(7);
      setGlyphs(prev => [...prev, { id, x: e.clientX - rect.left, y: e.clientY - rect.top, angle }]);
      setTimeout(() => setGlyphs(prev => prev.filter(g => g.id !== id)), 800);
    }
  }, [joyActive, currentTime, currentPalette, convergence, curves, onCurvesChanged]);

  const handleJoyUp = useCallback(() => {
    const { x, y } = joyPosRef.current;

    // If we were performing, paint a "momentum" tail into the future
    if (Math.sqrt(x * x + y * y) > 0.01) {
      const tailDuration = STRIP_GAP * 2; // 2 arrows worth of time
      curves.paintDrift(currentTime, x, y, currentTime + tailDuration, 0, 0);
      onCurvesChanged();
      setRevision((r) => r + 1);
    }

    setJoyActive(false);
    joyPosRef.current = { x: 0, y: 0 };
    setJoyPos({ x: 0, y: 0 });
  }, [curves, currentTime, onCurvesChanged, STRIP_GAP]);

  // Sync palette with keyboard 1-9
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      if (e.key === "Tab") {
        e.preventDefault();
        setConvergence(prev => e.shiftKey ? Math.max(1, prev - 1) : Math.min(5, prev + 1));
        return;
      }

      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        setCurrentPalette(num - 1);
        curves.setPalette(currentTime, num - 1);
        onCurvesChanged();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [currentTime, curves, onCurvesChanged]);

  // When drawing on the curve graph, also record current drift + palette
  const recordDriftAndPalette = useCallback((time: number) => {
    const jp = joyPosRef.current;
    // Map 1-5 to engine mode (0=dir, 1=in, 2=out)
    const mode = convergence <= 2 ? 1 : convergence >= 4 ? 2 : 0;
    curves.setDrift(time, jp.x, jp.y, mode);
    curves.setPalette(time, currentPalette);
  }, [curves, currentPalette, convergence]);

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
  }, [curves]);

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

  // Drawing handlers
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
        // Map 1-5 to engine mode (0=dir, 1=in, 2=out)
        const mode = convergence <= 2 ? 1 : convergence >= 4 ? 2 : 0;
        curves.paintDrift(prev.time, jp.x, jp.y, pt.time, jp.x, jp.y, mode);
      } else {
        curves.setNormalized(activeParamRef.current, pt.time, pt.norm);
      }
      recordDriftAndPalette(pt.time);
      lastDrawPoint.current = pt;
      onCurvesChanged();
      syncPreview();
    },
    [curves, onCurvesChanged, posToTimeNorm, syncPreview, recordDriftAndPalette, convergence],
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
    ctx.fillStyle = "rgba(3, 7, 18, 0.0)";
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
    // Vertical time grid
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
      const range = paramDef.max - paramDef.min;

      ctx.strokeStyle = isActive ? paramDef.color : paramDef.color + "30";
      ctx.lineWidth = isActive ? 2.5 : 1;
      ctx.setLineDash(isActive ? [] : [3, 4]);

      ctx.beginPath();
      for (let i = 0; i < arr.length; i++) {
        const x = (i / (arr.length - 1)) * w;
        const norm = (arr[i] - paramDef.min) / range;
        const y = (1 - norm) * h;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      ctx.setLineDash([]);

      if (isActive) {
        const dotStep = Math.max(1, Math.floor(arr.length / 80));
        ctx.fillStyle = paramDef.color;
        for (let i = 0; i < arr.length; i += dotStep) {
          const x = (i / (arr.length - 1)) * w;
          const norm = (arr[i] - paramDef.min) / range;
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
      ctx.strokeStyle = "rgba(255, 255, 255, 0.15)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(px, 0);
      ctx.lineTo(px, h);
      ctx.stroke();

      const activeDef = CURVE_PARAMS.find((p) => p.key === activeParam)!;
      const val = curves.getValue(activeParam, currentTime);
      const norm = (val - activeDef.min) / (activeDef.max - activeDef.min);
      const orbY = (1 - norm) * h;

      const grad = ctx.createRadialGradient(px, orbY, 0, px, orbY, 18);
      grad.addColorStop(0, activeDef.color + "aa");
      grad.addColorStop(0.5, activeDef.color + "33");
      grad.addColorStop(1, "transparent");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(px, orbY, 18, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = activeDef.color;
      ctx.beginPath();
      ctx.arc(px, orbY, 5, 0, Math.PI * 2);
      ctx.fill();

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

        <div className="draw-palette-grid">
          <div className="palette-row">
            {[5, 6, 7, 8].map((i) => (
              <div key={i} className="palette-item">
                <div
                  className={`palette-swatch-mini${currentPalette === i ? " active" : ""}`}
                  style={{ background: paletteColors(i)[0] }}
                  onClick={() => setCurrentPalette(i)}
                />
                <span className="palette-label-mini">{i + 1}</span>
              </div>
            ))}
          </div>
          <div className="palette-row">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="palette-item">
                <div
                  className={`palette-swatch-mini${currentPalette === i ? " active" : ""}`}
                  style={{ background: paletteColors(i)[0] }}
                  onClick={() => setCurrentPalette(i)}
                />
                <span className="palette-label-mini">{i + 1}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="drift-module-sidebar">
          <div className="convergence-wrap">
            <div 
              className={`convergence-dots${convergence !== 3 ? " active" : ""}`}
              style={{ 
                letterSpacing: `${(convergence - 1) * 5}px`,
                paddingLeft: `${(convergence - 1) * 5}px` 
              }}
            >
              • • •
            </div>
            <div className="speed-box-mini">
              {Math.sqrt(joyPos.x ** 2 + joyPos.y ** 2).toFixed(1)}
            </div>
          </div>
          <div
            className="draw-joy-pad"
            ref={joyRef}
            style={{ borderColor: paletteColors(currentPalette)[1] + "33" }}
            onPointerDown={handleJoyDown}
            onPointerMove={handleJoyMove}
            onPointerUp={handleJoyUp}
          >
            <div className="draw-joy-ring" />
            <div
              className="draw-joy-knob"
              style={{
                left: `calc(${50 + joyPos.x * 50}% - 10px)`,
                top: `calc(${50 + joyPos.y * 50}% - 10px)`,
                background: paletteColors(currentPalette)[1],
                boxShadow: `0 0 10px ${paletteColors(currentPalette)[1]}`,
              }}
            />
            {glyphs.map((g) => (
              <div
                key={g.id}
                className="drift-glyph"
                style={{
                  left: g.x,
                  top: g.y,
                  transform: `translate(-50%, -50%) rotate(${g.angle + Math.PI / 2}rad)`,
                  color: paletteColors(currentPalette)[1],
                }}
              >
                ↑
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="draw-center">
        <div className="draw-preview-wrap">
          <span className="draw-preview-label">Preview</span>
          <div className="draw-preview">
            <canvas ref={previewCanvasRef} className="draw-preview-canvas" />
          </div>
        </div>

        <div className="draw-stats">
          <span>{curves.eventCount} events</span>
          <span>parameter resolution: {curves.resolution}/s</span>
        </div>

        <div className="draw-graph-wrap" ref={graphContainerRef}>
          <canvas
            ref={graphCanvasRef}
            className="draw-graph-canvas"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerLeave={handlePointerUp}
          />
          <span className="draw-axis-label draw-axis-high" style={{ color: activeDef.color }}>
            {activeDef.label} <span style={{ opacity: 0.5 }}>HIGH</span>
          </span>
          <span className="draw-axis-label draw-axis-low" style={{ color: activeDef.color, opacity: 0.5 }}>
            LOW
          </span>
        </div>

        <div className="drift-strip-center" data-rev={revision}>
          <div className="drift-strip-bar">
            {Array.from({ length: numSteps }).map((_, i) => {
              const t = i * STRIP_GAP;
              const drift = curves.getDrift(t);
              const pal = curves.getPalette(t);
              const angle = Math.atan2(drift.y, drift.x);
              const mag = Math.sqrt(drift.x * drift.x + drift.y * drift.y);
              const hasData = mag > 0.01;
              const symbol = drift.mode === 1 ? "􀅋" : drift.mode === 2 ? "􀅊" : "↑";
              const rotation = drift.mode === 0 ? `${angle + Math.PI / 2}rad` : "0rad";

              return (
                <div key={i} className="drift-step" style={{ opacity: hasData ? (mag * 0.8 + 0.2) : 0.1 }}>
                  <div
                    className="drift-step-arrow"
                    style={{
                      transform: `rotate(${rotation}) scale(${0.5 + mag * 0.5})`,
                      color: hasData ? paletteColors(pal)[1] : "#1e293b",
                    }}
                  >
                    {symbol}
                  </div>
                </div>
              );
            })}
          </div>
          <div className="drift-strip-hint">
            MOVE JOYSTICK TO ADD A DRIFT POINT<br />
            CHANGE COLOR WITH NUMBER KEYS — DATA RECORDED AT CURRENT PLACE OR THROUGH PLAYBACK
          </div>
        </div>
      </div>
    </div>
  );
}
