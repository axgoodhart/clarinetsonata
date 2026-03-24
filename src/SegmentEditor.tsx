import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  parseSegments,
  serializeSegments,
  NUMERIC_PARAMS,
  DIRECTIONS,
  DRIFT_MAGS,
  PALETTE_NAMES,
  type NumericParamKey,
} from "./lib/segment-utils";

interface SegmentEditorProps {
  sequenceText: string;
  editorError: boolean;
  onSequenceEdit: (text: string) => void;
  currentTime: number;
  isPlaying: boolean;
  selectedIdx: number;
  onSelectSegment: (idx: number) => void;
}

type EditorMode = "text" | "sliders";

const CHIP_COLORS = [
  "rgb(96, 165, 250)",
  "rgb(167, 139, 250)",
  "rgb(52, 211, 153)",
  "rgb(251, 191, 36)",
  "rgb(244, 114, 182)",
  "rgb(129, 140, 248)",
  "rgb(45, 212, 191)",
  "rgb(248, 113, 113)",
];

export default function SegmentEditor({
  sequenceText,
  editorError,
  onSequenceEdit,
  currentTime,
  isPlaying,
  selectedIdx,
  onSelectSegment,
}: SegmentEditorProps) {
  const [mode, setMode] = useState<EditorMode>("sliders");
  const [headerHeld, setHeaderHeld] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);

  // Release header hold on mouseup anywhere
  useEffect(() => {
    if (!headerHeld) return;
    const up = () => setHeaderHeld(false);
    window.addEventListener("mouseup", up);
    return () => window.removeEventListener("mouseup", up);
  }, [headerHeld]);

  const segments = useMemo(() => parseSegments(sequenceText), [sequenceText]);
  const safeIdx = segments[selectedIdx] ? selectedIdx : 0;
  const selected = segments[safeIdx];

  // Auto-follow: during playback, select the segment that contains currentTime
  useEffect(() => {
    if (!isPlaying || segments.length === 0) return;
    for (let i = 0; i < segments.length; i++) {
      if (currentTime >= segments[i].startTime && currentTime < segments[i].endTime) {
        if (i !== selectedIdx) onSelectSegment(i);
        return;
      }
    }
  }, [isPlaying, currentTime, segments, selectedIdx, onSelectSegment]);

  // Helper: update segments and enforce sequential continuity
  const commitSegments = useCallback(
    (updater: (segs: ReturnType<typeof parseSegments>) => void) => {
      const segs = parseSegments(sequenceText);
      updater(segs);

      // Sequential continuity: cascade end → next start
      for (let i = 0; i < segs.length - 1; i++) {
        const cur = segs[i];
        const next = segs[i + 1];
        for (const def of NUMERIC_PARAMS) {
          next.params[def.key].a = cur.params[def.key].b;
        }
        next.params.drift.dirA = cur.params.drift.dirB;
        next.params.drift.magA = cur.params.drift.magB;
        next.params.palette.a = cur.params.palette.b;
        // Time continuity: next start = current end
        next.startTime = cur.endTime;
      }

      onSequenceEdit(serializeSegments(segs));
    },
    [sequenceText, onSequenceEdit]
  );

  const updateNumeric = useCallback(
    (key: NumericParamKey, side: "a" | "b", value: number) => {
      commitSegments((segs) => {
        const seg = segs[safeIdx];
        if (seg) seg.params[key][side] = value;
      });
    },
    [commitSegments, safeIdx]
  );

  const updateDrift = useCallback(
    (field: "dirA" | "magA" | "dirB" | "magB", value: string) => {
      commitSegments((segs) => {
        const seg = segs[safeIdx];
        if (seg) seg.params.drift[field] = value;
      });
    },
    [commitSegments, safeIdx]
  );

  const updatePalette = useCallback(
    (side: "a" | "b", value: string) => {
      commitSegments((segs) => {
        const seg = segs[safeIdx];
        if (seg) seg.params.palette[side] = value;
      });
    },
    [commitSegments, safeIdx]
  );

  const updateTime = useCallback(
    (field: "startTime" | "endTime", value: number) => {
      commitSegments((segs) => {
        const seg = segs[safeIdx];
        if (!seg) return;
        seg[field] = Math.max(0, value);
        // Enforce start < end
        if (seg.startTime >= seg.endTime) {
          if (field === "startTime") seg.endTime = seg.startTime + 0.1;
          else seg.startTime = seg.endTime - 0.1;
        }
      });
    },
    [commitSegments, safeIdx]
  );

  const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

  if (segments.length === 0) {
    return (
      <div className="seg-editor-wrap">
        <div className="seg-editor-panel">
          <textarea
            className={`seq-editor full${editorError ? " seq-editor-error" : ""}`}
            value={sequenceText}
            onChange={(e) => onSequenceEdit(e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="seg-editor-wrap">
      <div
        ref={panelRef}
        className={`seg-editor-panel${headerHeld ? " dragging" : ""}`}
      >
        {/* Segment selector strip */}
        <div className="seg-strip">
          {segments.map((seg, i) => (
            <button
              key={i}
              className={`seg-chip${i === safeIdx ? " active" : ""}`}
              style={{ "--chip-color": CHIP_COLORS[i % CHIP_COLORS.length] } as React.CSSProperties}
              onClick={() => onSelectSegment(i)}
            >
              <span className="seg-chip-num">#{i + 1}</span>
              <span className="seg-chip-time">
                {fmt(seg.startTime)}–{fmt(seg.endTime)}s
              </span>
            </button>
          ))}
        </div>

        {/* Header with editable times */}
        {selected && (
          <div className="seg-header" onMouseDown={() => setHeaderHeld(true)}>
            <span className="seg-header-num">#{safeIdx + 1}</span>
            <div className="seg-time-inputs">
              <input
                type="number"
                className="seg-time-input"
                value={selected.startTime}
                step={0.1}
                min={0}
                onChange={(e) => updateTime("startTime", parseFloat(e.target.value) || 0)}
              />
              <span className="seg-time-arrow">→</span>
              <input
                type="number"
                className="seg-time-input"
                value={selected.endTime}
                step={0.1}
                min={0}
                onChange={(e) => updateTime("endTime", parseFloat(e.target.value) || 0)}
              />
              <span className="seg-time-unit">s</span>
            </div>
            {selected.name && (
              <span className="seg-header-name">{selected.name}</span>
            )}
          </div>
        )}

        {/* Content area */}
        {mode === "text" ? (
          <div className="seg-text-mode">
            <textarea
              className={`seq-editor full${editorError ? " seq-editor-error" : ""}`}
              value={sequenceText}
              onChange={(e) => onSequenceEdit(e.target.value)}
              spellCheck={false}
            />
            <button className="seg-mode-toggle" onClick={() => setMode("sliders")}>
              switch to sliders
            </button>
          </div>
        ) : (
          <div className="seg-slider-mode">
            {/* Column headers */}
            <div className="seg-col-headers">
              <span>START</span>
              <span>END</span>
            </div>

            {/* Numeric param rows */}
            {NUMERIC_PARAMS.map((def) => {
              const val = selected.params[def.key];
              return (
                <div className="seg-param-row" key={def.key}>
                  <label className="seg-param-label">{def.key}</label>
                  <div className="seg-param-values">
                    <span className="seg-val start">{fmt(val.a)}</span>
                    <span className="seg-val end">{fmt(val.b)}</span>
                  </div>
                  <div className="seg-sliders">
                    <input
                      type="range"
                      className="seg-slider start"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={val.a}
                      onChange={(e) =>
                        updateNumeric(def.key, "a", parseFloat(e.target.value))
                      }
                    />
                    <input
                      type="range"
                      className="seg-slider end"
                      min={def.min}
                      max={def.max}
                      step={def.step}
                      value={val.b}
                      onChange={(e) =>
                        updateNumeric(def.key, "b", parseFloat(e.target.value))
                      }
                    />
                  </div>
                </div>
              );
            })}

            {/* Drift row */}
            <div className="seg-param-row">
              <label className="seg-param-label">drift</label>
              <div className="seg-drift-controls">
                <div className="seg-drift-side">
                  <select
                    className="seg-select"
                    value={selected.params.drift.dirA}
                    onChange={(e) => updateDrift("dirA", e.target.value)}
                  >
                    {DIRECTIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <select
                    className="seg-select"
                    value={selected.params.drift.magA}
                    onChange={(e) => updateDrift("magA", e.target.value)}
                  >
                    {DRIFT_MAGS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
                <div className="seg-drift-side">
                  <select
                    className="seg-select"
                    value={selected.params.drift.dirB}
                    onChange={(e) => updateDrift("dirB", e.target.value)}
                  >
                    {DIRECTIONS.map((d) => (
                      <option key={d} value={d}>{d}</option>
                    ))}
                  </select>
                  <select
                    className="seg-select"
                    value={selected.params.drift.magB}
                    onChange={(e) => updateDrift("magB", e.target.value)}
                  >
                    {DRIFT_MAGS.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            {/* Palette row */}
            <div className="seg-param-row">
              <label className="seg-param-label">palette</label>
              <div className="seg-palette-controls">
                <select
                  className="seg-select"
                  value={selected.params.palette.a}
                  onChange={(e) => updatePalette("a", e.target.value)}
                >
                  {PALETTE_NAMES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
                <select
                  className="seg-select"
                  value={selected.params.palette.b}
                  onChange={(e) => updatePalette("b", e.target.value)}
                >
                  {PALETTE_NAMES.map((p) => (
                    <option key={p} value={p}>{p}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* Toggle to text */}
            <button className="seg-mode-toggle" onClick={() => setMode("text")}>
              switch to text
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
