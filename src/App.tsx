import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { ParticleField } from "./lib/particle-field-gl";
import { SequenceEngine } from "./lib/sequence-engine";
import { parseSequence } from "./lib/sequence-parser";
import {
  analyzeAudioAsync,
  arcsToSequence,
  DEFAULT_RANGES,
  PARAM_LIMITS,
  type GenerateRanges,
} from "./lib/audio-analyzer";
import { SEQUENCE } from "./sequence";
import { parseSegments } from "./lib/segment-utils";
import audioSrc from "./mvt2.mp3";
import SegmentEditor from "./SegmentEditor";
import DrawModeEditor from "./DrawModeEditor";
import WaveformTimeline from "./WaveformTimeline";
import { usePlayback, formatTime } from "./hooks/usePlayback";
import { useFrame } from "./hooks/useFrame";
import { CurveStore } from "./lib/curve-data";
import "./index.css";

const MAX_UNDO = 10;
const STORAGE_KEY = "sonata:sequence";
const NOTES_KEY = "sonata:notes";

type TimelineNote = { id: string; time: number; text: string };

function loadNotes(): TimelineNote[] {
  try {
    const raw = localStorage.getItem(NOTES_KEY);
    if (raw) return JSON.parse(raw);
  } catch { /* noop */ }
  return [];
}
function saveNotes(notes: TimelineNote[]) {
  try { localStorage.setItem(NOTES_KEY, JSON.stringify(notes)); } catch { /* noop */ }
}
function notesId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function serializeNotesForExport(notes: TimelineNote[]): string {
  if (notes.length === 0) return "";
  const lines = ["\n# ── NOTES ──"];
  for (const n of notes.sort((a, b) => a.time - b.time)) {
    const m = Math.floor(n.time / 60);
    const s = Math.floor(n.time % 60).toString().padStart(2, "0");
    lines.push(`# @${m}:${s} — ${n.text.replace(/\n/g, " ")}`);
  }
  return lines.join("\n");
}

function parseNotesFromImport(text: string): TimelineNote[] {
  const notes: TimelineNote[] = [];
  for (const line of text.split("\n")) {
    const m = line.match(/^#\s*@(\d+):(\d{2})\s*—\s*(.+)$/);
    if (m) {
      notes.push({
        id: notesId(),
        time: parseInt(m[1]) * 60 + parseInt(m[2]),
        text: m[3].trim(),
      });
    }
  }
  return notes;
}

function loadSavedSequence(): string {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && saved.trim()) return saved;
  } catch { /* localStorage unavailable */ }
  return SEQUENCE;
}

function saveSequence(text: string) {
  try { localStorage.setItem(STORAGE_KEY, text); } catch { /* noop */ }
}

function downloadFile(text: string, filename: string) {
  const blob = new Blob([text], { type: "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Compute demo playback duration so the loop always takes ~2-5 seconds
 * regardless of actual phase length.
 */
function getDemoPlaybackDuration(phaseDuration: number): number {
  if (phaseDuration <= 5) return phaseDuration;
  if (phaseDuration <= 10) return phaseDuration / 2;
  if (phaseDuration <= 24) return phaseDuration / 4;
  return phaseDuration / 8;
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const fieldRef = useRef<ParticleField | null>(null);
  const engineRef = useRef<SequenceEngine | null>(null);

  // Playback hook manages all audio/timing state
  const [playback, actions, playbackRefs] = usePlayback();

  const [showOverlay, setShowOverlay] = useState(true);
  const [dragOver, setDragOver] = useState(false);

  // Editable sequence state with undo/redo (restored from localStorage)
  const [sequenceText, setSequenceText] = useState(loadSavedSequence);
  const [seqDuration, setSeqDuration] = useState(() => {
    const kf = parseSequence(loadSavedSequence());
    const eng = new SequenceEngine();
    eng.load(kf);
    return eng.duration;
  });
  const undoStackRef = useRef<string[]>([]);
  const redoStackRef = useRef<string[]>([]);
  const [editorError, setEditorError] = useState(false);
  const [showEditor, setShowEditor] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [genRanges, setGenRanges] = useState<GenerateRanges>(() =>
    JSON.parse(JSON.stringify(DEFAULT_RANGES)),
  );
  const [genSensitivity, setGenSensitivity] = useState(0.5);

  // Lifted state for segment selection (shared between editor + waveform)
  const [selectedSegmentIdx, setSelectedSegmentIdx] = useState(0);

  // Demo state toggle
  const [showDemo, setShowDemo] = useState(false);

  // Draw mode
  const [drawMode, setDrawMode] = useState(false);
  const curveStoreRef = useRef<CurveStore | null>(null);

  // Timeline notes
  const [notes, setNotes] = useState<TimelineNote[]>(loadNotes);
  const [hoveredNoteId, setHoveredNoteId] = useState<string | null>(null);
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  useEffect(() => { saveNotes(notes); }, [notes]);

  const addNote = useCallback(() => {
    const t = playback.currentTime;
    const note: TimelineNote = { id: notesId(), time: t, text: "" };
    setNotes((prev) => [...prev, note]);
    setEditingNoteId(note.id);
  }, [playback.currentTime]);

  const updateNoteText = useCallback((id: string, text: string) => {
    setNotes((prev) => prev.map((n) => (n.id === id ? { ...n, text } : n)));
  }, []);

  const deleteNote = useCallback((id: string) => {
    setNotes((prev) => prev.filter((n) => n.id !== id));
    setHoveredNoteId(null);
    setEditingNoteId(null);
  }, []);

  // Mutable store for values the animation loop reads (avoids React compiler ref restrictions)
  const loopState = useRef({ showDemo: false, selectedSegIdx: 0 });

  // Parsed segments for waveform timeline
  const segments = useMemo(() => parseSegments(sequenceText), [sequenceText]);

  // Apply sequence text to engine, returns true if valid
  const applySequence = useCallback((text: string): boolean => {
    try {
      const kf = parseSequence(text);
      if (kf.length === 0) return false;
      const engine = engineRef.current;
      if (engine) {
        engine.load(kf);
        setSeqDuration(engine.duration);
      }
      return true;
    } catch {
      return false;
    }
  }, []);

  // Throttle undo pushes — sliders fire onChange rapidly during drag
  const lastUndoPushRef = useRef(0);
  const UNDO_THROTTLE_MS = 500;

  // Handle edits to the sequence text (from the textarea or slider editor)
  const handleSequenceEdit = useCallback(
    (newText: string) => {
      const now = Date.now();
      if (now - lastUndoPushRef.current > UNDO_THROTTLE_MS) {
        undoStackRef.current.push(sequenceText);
        if (undoStackRef.current.length > MAX_UNDO) {
          undoStackRef.current.shift();
        }
        lastUndoPushRef.current = now;
      }
      redoStackRef.current = [];

      setSequenceText(newText);
      if (applySequence(newText)) {
        setEditorError(false);
      } else {
        setEditorError(true);
      }
    },
    [sequenceText, applySequence],
  );

  // Undo/redo handlers
  const handleUndo = useCallback(() => {
    if (undoStackRef.current.length === 0) return;
    const prev = undoStackRef.current.pop()!;
    redoStackRef.current.push(sequenceText);
    if (redoStackRef.current.length > MAX_UNDO) {
      redoStackRef.current.shift();
    }
    setSequenceText(prev);
    applySequence(prev);
    setEditorError(false);
  }, [sequenceText, applySequence]);

  const handleRedo = useCallback(() => {
    if (redoStackRef.current.length === 0) return;
    const next = redoStackRef.current.pop()!;
    undoStackRef.current.push(sequenceText);
    if (undoStackRef.current.length > MAX_UNDO) {
      undoStackRef.current.shift();
    }
    setSequenceText(next);
    applySequence(next);
    setEditorError(false);
  }, [sequenceText, applySequence]);

  // Autosave to localStorage on every sequence change
  useEffect(() => {
    saveSequence(sequenceText);
  }, [sequenceText]);

  // Hidden file input ref for importing sequences
  const importRef = useRef<HTMLInputElement>(null);

  const handleDownload = useCallback(() => {
    const timestamp = new Date().toISOString().slice(0, 10);
    const exported = sequenceText + serializeNotesForExport(notes);
    downloadFile(exported, `sonata-${timestamp}.txt`);
  }, [sequenceText, notes]);

  const handleImportFile = useCallback(
    (file: File) => {
      const reader = new FileReader();
      reader.onload = () => {
        const text = reader.result as string;
        if (!text.trim()) return;
        undoStackRef.current.push(sequenceText);
        if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
        redoStackRef.current = [];
        setSequenceText(text);
        if (applySequence(text)) {
          setEditorError(false);
        } else {
          setEditorError(true);
        }
        const imported = parseNotesFromImport(text);
        if (imported.length > 0) setNotes(imported);
        setShowEditor(true);
      };
      reader.readAsText(file);
    },
    [sequenceText, applySequence],
  );

  const handleImportInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) handleImportFile(file);
      e.target.value = "";
    },
    [handleImportFile],
  );

  // Run the actual analysis with current modal settings (offloaded to Web Worker)
  const runGenerate = useCallback(async () => {
    if (!playback.audioBuffer) return;

    setAnalyzing(true);

    try {
      const { arcs } = await analyzeAudioAsync(
        playback.audioBuffer,
        genSensitivity,
      );
      const dsl = arcsToSequence(arcs, genRanges);

      if (dsl) {
        undoStackRef.current.push(sequenceText);
        if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
        redoStackRef.current = [];

        setSequenceText(dsl);
        applySequence(dsl);
        setShowEditor(true);
      }
    } finally {
      setAnalyzing(false);
      setShowGenModal(false);
    }
  }, [sequenceText, applySequence, genRanges, genSensitivity, playback.audioBuffer]);

  // Helper to update a single range field
  const updateRange = useCallback(
    (param: keyof GenerateRanges, end: "min" | "max", value: number) => {
      setGenRanges((prev) => ({
        ...prev,
        [param]: { ...prev[param], [end]: value },
      }));
    },
    [],
  );

  // Global keyboard shortcut for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === "z" && !e.shiftKey) {
        e.preventDefault();
        handleUndo();
      } else if (e.metaKey && e.shiftKey && e.key === "z") {
        e.preventDefault();
        handleRedo();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [handleUndo, handleRedo]);

  // Init particle field + engine + default audio (no longer manages animation loop)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const field = new ParticleField(canvas);
    fieldRef.current = field;

    const engine = new SequenceEngine();
    engineRef.current = engine;
    engine.load(parseSequence(loadSavedSequence()));

    // Load default audio
    actions.loadUrl(audioSrc).catch(() => {});

    const handleResize = () => field.resize();
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Demo mode tracking (kept outside useFrame to persist across frames)
  const demoState = useRef({ startTime: 0, wasActive: false });

  // Animation frame loop — only handles rendering + time updates
  useFrame(() => {
    const field = fieldRef.current;
    const engine = engineRef.current;
    if (!field || !engine) return;

    // Update time tracking (DOM + throttled React state)
    actions.updateTime();
    const t = actions.getCurrentTime();

    if (loopState.current.showDemo) {
      const now = performance.now();
      if (!demoState.current.wasActive) {
        demoState.current.startTime = now;
        demoState.current.wasActive = true;
        field.reset();
      }

      const segs = engine.getSegmentTimes();
      const segIdx = loopState.current.selectedSegIdx;
      const seg = segs[segIdx];

      if (seg) {
        const phaseDuration = seg.end - seg.start;
        const playbackDuration = getDemoPlaybackDuration(phaseDuration);
        const elapsed = (now - demoState.current.startTime) / 1000;
        const progress = (elapsed % playbackDuration) / playbackDuration;
        const virtualTime = seg.start + progress * phaseDuration;
        const state = engine.getStateAtTime(virtualTime);

        field.setState(state);
        field.tick();
        field.drawDemoOverlay(state, progress);
      }
    } else {
      demoState.current.wasActive = false;
      const state = engine.getStateAtTime(t);

      if (actions.isAudioPlaying()) {
        const fft = actions.getFFT();
        state.intensity = Math.min(1, state.intensity + fft.bass * 0.25);
        state.size = Math.min(1, state.size + fft.bass * 0.15);
        state.turbulence = Math.min(1, state.turbulence + fft.mid * 0.15);
        state.connect = Math.min(300, state.connect + fft.high * 40);
      }

      field.setState(state);
      field.tick();
    }
  });

  // Overlay start handler
  const handleStart = useCallback(() => {
    setShowOverlay(false);
    actions.start();
  }, [actions]);

  // Drag-and-drop (audio files or sequence files)
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (!file) return;
      if (file.name.match(/\.(mp3|wav|ogg|m4a|aac|flac)$/i)) {
        await actions.loadFile(file);
      } else if (file.name.match(/\.(txt|sonata)$/i)) {
        handleImportFile(file);
      }
    },
    [actions, handleImportFile],
  );

  const handleScrubInput = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      actions.scrub(parseFloat(e.target.value));
    },
    [actions],
  );

  const handleScrubReset = useCallback(() => {
    fieldRef.current?.reset();
  }, []);

  const totalDuration = playback.audioDuration || seqDuration || 120;

  // Demo particles: when paused, editor open, demo on, render static preview
  const showDemoState = showDemo && showEditor && !playback.isPlaying;

  // Keep loopState in sync so the animation loop can read current values
  useEffect(() => {
    loopState.current.showDemo = showDemoState;
  }, [showDemoState]);

  const selectSegment = useCallback((idx: number) => {
    loopState.current.selectedSegIdx = idx;
    setSelectedSegmentIdx(idx);
  }, []);

  const enterDrawMode = useCallback(() => {
    const engine = engineRef.current;
    if (!engine) return;
    const dur = totalDuration;
    const store = CurveStore.fromEngine(engine, dur, 3);
    curveStoreRef.current = store;
    setDrawMode(true);
    setShowEditor(false);
  }, [totalDuration]);

  const exitDrawMode = useCallback(() => {
    const store = curveStoreRef.current;
    if (store) {
      const dsl = store.toDSL();
      undoStackRef.current.push(sequenceText);
      if (undoStackRef.current.length > MAX_UNDO) undoStackRef.current.shift();
      redoStackRef.current = [];
      setSequenceText(dsl);
      applySequence(dsl);
    }
    setDrawMode(false);
  }, [sequenceText, applySequence]);

  const handleCurvesChanged = useCallback(() => {
    const store = curveStoreRef.current;
    const engine = engineRef.current;
    if (!store || !engine) return;
    engine.load(store.toKeyframes());
  }, []);

  return (
    <div
      className="app-container"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={handleDrop}
    >
      <canvas ref={canvasRef} className="app-canvas" />
      <input
        ref={importRef}
        type="file"
        accept=".txt,.sonata"
        onChange={handleImportInput}
        hidden
      />

      {dragOver && (
        <div className="drop-zone">
          <p className="drop-zone-text">Drop audio file</p>
        </div>
      )}

      {showOverlay && (
        <div className="overlay" onClick={handleStart}>
          <h1>SONATA</h1>
          <h2>
            for clarinet <a>&</a> piano
          </h2>
          <h3>
            alex
            <br />
            <a>good</a>
            <br />
            hart
          </h3>
          <h1>
            <a>• •</a>
          </h1>
          <p className="clicker">click to start</p>
        </div>
      )}

      {!showOverlay && (
        <div className={`controls-bar${showEditor || drawMode ? " edit-mode" : ""}`}>
          {/* Waveform timeline (when editor open) or simple scrub bar */}
          {showEditor ? (
            <WaveformTimeline
              audioBuffer={playback.audioBuffer}
              segments={segments}
              currentTime={playback.currentTime}
              totalDuration={totalDuration}
              selectedIdx={selectedSegmentIdx}
              onScrub={actions.scrub}
              onSelectSegment={selectSegment}
            />
          ) : (
            <input
              ref={playbackRefs.scrubRef}
              type="range"
              min="0"
              max={totalDuration}
              step="0.1"
              defaultValue="0"
              onChange={handleScrubInput}
              onDoubleClick={handleScrubReset}
              className="scrub-slider"
            />
          )}
          {/* Note markers on timeline */}
          {totalDuration > 0 && (
            <div className="note-markers">
              {notes.map((note) => {
                const pct = (note.time / totalDuration) * 100;
                const isOpen = hoveredNoteId === note.id || editingNoteId === note.id;
                return (
                  <div
                    key={note.id}
                    className={`note-marker${isOpen ? " open" : ""}`}
                    style={{ left: `${pct}%` }}
                    onMouseEnter={() => setHoveredNoteId(note.id)}
                    onMouseLeave={() => { if (editingNoteId !== note.id) setHoveredNoteId(null); }}
                    onClick={() => setEditingNoteId(note.id)}
                  >
                    <div className="note-diamond" />
                    {isOpen && (
                      <div className="note-tooltip" onClick={(e) => e.stopPropagation()}>
                        <textarea
                          className="note-textarea"
                          value={note.text}
                          onChange={(e) => updateNoteText(note.id, e.target.value)}
                          onBlur={() => setEditingNoteId(null)}
                          placeholder="your thoughts..."
                          autoFocus={editingNoteId === note.id}
                          rows={2}
                        />
                        <button
                          className="note-delete"
                          onMouseDown={(e) => { e.preventDefault(); deleteNote(note.id); }}
                        >
                          delete
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
          {/* Controls row */}
          <div className="controls-row">
            <button onClick={actions.toggle} className="control-btn">
              {playback.isPlaying ? "Pause" : "Resume"}
            </button>
            <div className="controls-center">
              <p className="status-text">
                {playback.hasAudio ? "sonscape" : "Drop MP3 for audio"}
              </p>
              {playback.hasAudio && (
                <button
                  onClick={() => setShowGenModal(true)}
                  className="control-btn generate-btn"
                >
                  Generate
                </button>
              )}
              {showEditor && (
                <>
                  <button
                    onClick={() => setShowDemo((v) => !v)}
                    className={`control-btn demo-btn${showDemo ? " active" : ""}`}
                  >
                    Demo
                  </button>
                  <button onClick={handleDownload} className="control-btn">
                    Save
                  </button>
                  <button
                    onClick={() => importRef.current?.click()}
                    className="control-btn"
                  >
                    Import
                  </button>
                </>
              )}
              <button onClick={addNote} className="control-btn">
                + Note
              </button>
              <button
                onClick={drawMode ? exitDrawMode : enterDrawMode}
                className={`control-btn${drawMode ? " demo-btn active" : ""}`}
              >
                {drawMode ? "Exit Draw" : "Draw"}
              </button>
              {!drawMode && (
                <button
                  onClick={() => setShowEditor((v) => !v)}
                  className="control-btn"
                >
                  {showEditor ? "Close" : "Edit"}
                </button>
              )}
            </div>
            {/* Time display — always on the right, never covered */}
            <div className="go">
              <span ref={playbackRefs.timeDisplayRef}>0:00</span>
              {totalDuration > 0 && (
                <span className="time">
                  {" "}
                  / {formatTime(totalDuration)}
                </span>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Draw mode editor */}
      {drawMode && !showOverlay && curveStoreRef.current && (
        <DrawModeEditor
          curves={curveStoreRef.current}
          currentTime={playback.currentTime}
          totalDuration={totalDuration}
          onCurvesChanged={handleCurvesChanged}
        />
      )}

      {/* Editable sequence pane */}
      {showEditor && !drawMode && !showOverlay && (
        <SegmentEditor
          sequenceText={sequenceText}
          editorError={editorError}
          onSequenceEdit={handleSequenceEdit}
          currentTime={playback.currentTime}
          isPlaying={playback.isPlaying}
          selectedIdx={selectedSegmentIdx}
          onSelectSegment={selectSegment}
        />
      )}

      {/* Generate modal */}
      {showGenModal && (
        <div
          className="gen-modal-backdrop"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowGenModal(false);
          }}
        >
          <div className="gen-modal">
            <div className="gen-modal-header">
              <span>Generate from Audio</span>
              <button
                onClick={() => setShowGenModal(false)}
                className="gen-modal-close"
              >
                &times;
              </button>
            </div>

            <div className="gen-modal-body">
              {/* Sensitivity */}
              <div className="gen-row">
                <label className="gen-label">sensitivity</label>
                <div className="gen-slider-row">
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={genSensitivity}
                    onChange={(e) =>
                      setGenSensitivity(parseFloat(e.target.value))
                    }
                    className="gen-slider"
                  />
                  <span className="gen-val">
                    {genSensitivity.toFixed(2)}
                  </span>
                </div>
                <span className="gen-hint">more boundaries &rarr;</span>
              </div>

              <div className="gen-divider" />

              {/* Per-parameter ranges */}
              {(Object.keys(PARAM_LIMITS) as (keyof GenerateRanges)[]).map(
                (param) => {
                  const limits = PARAM_LIMITS[param];
                  const range = genRanges[param];
                  return (
                    <div className="gen-row" key={param}>
                      <label className="gen-label">{param}</label>
                      <div className="gen-range-pair">
                        <div className="gen-range-half">
                          <span className="gen-range-tag">min</span>
                          <input
                            type="range"
                            min={limits.min}
                            max={limits.max}
                            step={limits.step}
                            value={range.min}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              updateRange(param, "min", Math.min(v, range.max));
                            }}
                            className="gen-slider"
                          />
                          <span className="gen-val">
                            {range.min.toFixed(limits.step < 1 ? 2 : 0)}
                          </span>
                        </div>
                        <div className="gen-range-half">
                          <span className="gen-range-tag">max</span>
                          <input
                            type="range"
                            min={limits.min}
                            max={limits.max}
                            step={limits.step}
                            value={range.max}
                            onChange={(e) => {
                              const v = parseFloat(e.target.value);
                              updateRange(param, "max", Math.max(v, range.min));
                            }}
                            className="gen-slider"
                          />
                          <span className="gen-val">
                            {range.max.toFixed(limits.step < 1 ? 2 : 0)}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                },
              )}
            </div>

            <div className="gen-modal-footer">
              <button
                onClick={() => {
                  setGenRanges(JSON.parse(JSON.stringify(DEFAULT_RANGES)));
                  setGenSensitivity(0.5);
                }}
                className="gen-btn gen-btn-reset"
              >
                Reset
              </button>
              <button
                onClick={runGenerate}
                disabled={analyzing}
                className="gen-btn gen-btn-run"
              >
                {analyzing ? "Analyzing..." : "Run"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
