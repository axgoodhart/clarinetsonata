import React, { useState, useRef, useEffect } from "react";
import { paletteColors, getPaletteNames } from "./lib/curve-data";

interface DriftStep {
  angle: number;
  magnitude: number;
  paletteIdx: number;
}

interface Glyph {
  id: string;
  x: number;
  y: number;
  angle: number;
}

interface TrailCircle {
  id: string;
  x: number;
  y: number;
  size: number;
}

export default function PerformanceRack() {
  // Performance State
  const [activePalette, setActivePalette] = useState(0);
  const [joyPos, setJoyPos] = useState({ x: 0, y: 0 });
  const [isRecording, setIsRecording] = useState(false);
  const [steps, setSteps] = useState<DriftStep[]>([]);
  const [glyphs, setGlyphs] = useState<Glyph[]>([]);
  const [trail, setTrail] = useState<TrailCircle[]>([]);
  
  // Advanced Controls
  const [isLocked, setIsLocked] = useState(false);
  const [tornado, setTornado] = useState(0); // 0.0 to 1.0

  const joyRef = useRef<HTMLDivElement>(null);
  const tornadoTrackRef = useRef<HTMLDivElement>(null);
  const lastStepTime = useRef(0);
  const GATED_INTERVAL = 200;

  // Keyboard listeners for 1-9
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      const num = parseInt(e.key);
      if (num >= 1 && num <= 9) {
        setActivePalette(num - 1);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);

  const handleJoyDown = (e: React.PointerEvent) => {
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    setIsRecording(true);
    updatePerformance(e.clientX, e.clientY);
  };

  const handleJoyMove = (e: React.PointerEvent) => {
    if (!isRecording) return;
    updatePerformance(e.clientX, e.clientY);
  };

  const handleJoyUp = () => {
    setIsRecording(false);
    if (!isLocked) {
      setJoyPos({ x: 0, y: 0 });
    }
  };

  const handleTornadoMove = (e: React.PointerEvent) => {
    const track = tornadoTrackRef.current;
    if (!track || e.buttons !== 1) return;
    const rect = track.getBoundingClientRect();
    const val = 1 - Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
    setTornado(val);
  };

  const updatePerformance = (clientX: number, clientY: number) => {
    const pad = joyRef.current;
    if (!pad) return;
    const rect = pad.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const radius = rect.width / 2;

    let dx = (clientX - cx) / radius;
    let dy = (clientY - cy) / radius;

    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > 1) {
      dx /= dist;
      dy /= dist;
    }

    setJoyPos({ x: dx, y: dy });

    const angle = Math.atan2(dy, dx);
    const mag = Math.min(1, dist);

    // Spawn Trail Circle
    const tid = Math.random().toString(36).substring(7);
    const trailX = 50 + dx * 50;
    const trailY = 50 + dy * 50;
    setTrail(prev => [...prev, { id: tid, x: trailX, y: trailY, size: 8 + mag * 12 }].slice(-12));
    setTimeout(() => {
        setTrail(prev => prev.filter(t => t.id !== tid)); // FIXED TYPO: t.id instead of g.id
    }, 500);

    // Spawn visual "treat" glyph
    if (Math.random() > 0.8) {
        const id = Math.random().toString(36).substring(7);
        setGlyphs(prev => [...prev, { id, x: clientX - rect.left, y: clientY - rect.top, angle }]);
        setTimeout(() => {
            setGlyphs(prev => prev.filter(g => g.id !== id));
        }, 800);
    }

    // Quantized step recording (Lab simulation only)
    const now = performance.now();
    if (now - lastStepTime.current > GATED_INTERVAL) {
      setSteps((prev) => [...prev, { angle, magnitude: mag, paletteIdx: activePalette }].slice(-40));
      lastStepTime.current = now;
    }
  };

  const palColor = paletteColors(activePalette)[1];

  return (
    <div className="perf-rack">
      <div className="palette-rack">
        {getPaletteNames().map((name, i) => (
          <div key={name} className="palette-slot">
            <div
              className={`palette-swatch${activePalette === i ? " active" : ""}`}
              style={{ 
                background: paletteColors(i)[0],
                color: paletteColors(i)[1]
              }}
              onClick={() => setActivePalette(i)}
            />
            <span className="palette-num">{i + 1}</span>
          </div>
        ))}
      </div>

      <div className="drift-module" style={{ justifyContent: 'center' }}>
        <div className="convergence-wrap">
          <div className="speed-box-mini" style={{ color: palColor, borderColor: palColor + "44" }}>
            {Math.sqrt(joyPos.x ** 2 + joyPos.y ** 2).toFixed(1)}
          </div>
        </div>

        <div className="joy-capture-wrap">
          <div
            ref={joyRef}
            className="joy-capture-pad"
            style={{ borderColor: palColor + "33" }}
            onPointerDown={handleJoyDown}
            onPointerMove={handleJoyMove}
            onPointerUp={handleJoyUp}
          >
            <div className="joy-capture-inner">
              <div
                className={`joy-lock-btn${isLocked ? " active" : ""}`}
                style={{ color: isLocked ? palColor : undefined }}
                onClick={(e) => { e.stopPropagation(); setIsLocked(!isLocked); }}
              >
                {isLocked ? "🔒" : "🔓"}
              </div>

              <div
                className="joy-capture-knob"
                style={{
                  left: `${50 + joyPos.x * 50}%`,
                  top: `${50 + joyPos.y * 50}%`,
                  background: palColor,
                  boxShadow: `0 0 10px ${palColor}`
                }}
              />

              {trail.map(t => (
                <div 
                  key={t.id}
                  className="joy-trail-circle"
                  style={{ 
                    left: `${t.x}%`, 
                    top: `${t.y}%`,
                    width: t.size,
                    height: t.size,
                    borderColor: palColor + "66"
                  }}
                />
              ))}

              {glyphs.map(g => (
                  <div 
                      key={g.id}
                      className="drift-glyph"
                      style={{ 
                        left: g.x, 
                        top: g.y, 
                        transform: `translate(-50%, -50%) rotate(${g.angle + Math.PI / 2}rad)`,
                        color: palColor
                      }}
                  >
                      ↑
                  </div>
              ))}
            </div>
          </div>

          <div className="tornado-wrap">
            <div 
              className={`tornado-icon${tornado > 0.1 ? " active" : ""}`}
              style={{ color: tornado > 0.1 ? palColor : undefined }}
              onClick={() => setTornado(tornado > 0 ? 0 : 0.5)}
            >
              🌪️
            </div>
            <div 
              className="tornado-slider-track" 
              ref={tornadoTrackRef}
              onPointerMove={handleTornadoMove}
              onPointerDown={handleTornadoMove}
            >
              <div 
                className="tornado-slider-handle" 
                style={{ 
                    top: `${(1 - tornado) * 100}%`,
                    background: tornado > 0.1 ? palColor : undefined
                }}
              />
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', marginTop: '10px' }}>
        <div className="drift-strip">
          {steps.map((step, i) => (
            <div key={i} className="drift-step" style={{ opacity: step.magnitude * 0.8 + 0.2 }}>
              <div
                className="drift-step-arrow"
                style={{
                  transform: `rotate(${step.angle + Math.PI / 2}rad) scale(${0.5 + step.magnitude * 0.5})`,
                  color: paletteColors(step.paletteIdx)[1]
                }}
              >
                ↑
              </div>
            </div>
          ))}
          {steps.length === 0 && (
            <span style={{ color: "#475569", fontSize: "10px", fontFamily: "SF Mono", padding: "0 10px" }}>
              MOVE JOYSTICK TO RECORD DRIFT...
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
