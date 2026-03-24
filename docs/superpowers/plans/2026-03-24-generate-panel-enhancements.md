# Generate Panel Enhancements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a master attenuation slider, an XY frequency/drama pad, and a hitpoint system to the Generate from Audio panel.

**Architecture:** All three features modify how `arcsToSequence` produces DSL output. The XY pad replaces the sensitivity slider and adds a drama contrast curve. The master slider scales all effective parameter ranges. The hitpoint panel injects forced arc boundaries from timeline notes and applies per-arc attenuation. Modifier order: drama → master → hitpoint attenuation.

**Tech Stack:** React 18, TypeScript, CSS (no Tailwind utilities), Web Worker for audio analysis.

**Spec:** `docs/superpowers/specs/2026-03-24-generate-panel-enhancements-design.md`

---

## File Map

| File | Responsibility |
|------|---------------|
| `src/lib/audio-analyzer.ts` | `arcsToSequence` gains `drama` and `attenuationMap` params; `analyzeAudio` gains `forcedBoundaries` param |
| `src/lib/audio-analyzer.worker.ts` | Worker accepts `forcedBoundaries` in message, merges into boundary list |
| `src/App.tsx` | New state (`genMaster`, `genDrama`, hitpoint state), XY pad UI, master slider UI, hitpoint panel UI, updated `runGenerate` |
| `src/index.css` | Styles for XY pad (`.gen-xy-*`), master slider (`.gen-master-*`), hitpoint panel (`.gen-hp-*`) |

---

### Task 1: Add `drama` parameter to `arcsToSequence`

**Files:**
- Modify: `src/lib/audio-analyzer.ts:356-434`

- [ ] **Step 1: Add `drama` to function signature**

In `src/lib/audio-analyzer.ts`, change the `arcsToSequence` signature from:

```ts
export function arcsToSequence(arcs: ArcSegment[], ranges: GenerateRanges = DEFAULT_RANGES): string {
```

to:

```ts
export function arcsToSequence(
  arcs: ArcSegment[],
  ranges: GenerateRanges = DEFAULT_RANGES,
  drama = 0.5,
): string {
```

- [ ] **Step 2: Apply contrast curve after normalization**

After the normalization loop (after line 378 `for (const k of keys) norm[k] = normalizeArr(raw[k]);`), add the drama contrast curve:

```ts
  // Apply drama contrast curve
  const dramaScale = drama * 2; // 0→0, 0.5→1 (identity), 1→2
  for (const k of keys) {
    norm[k] = norm[k].map((v) => Math.max(0, Math.min(1, 0.5 + (v - 0.5) * dramaScale)));
  }
```

- [ ] **Step 3: Verify the app still compiles**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npx tsc --noEmit`
Expected: No errors (drama has a default value so existing callers are fine).

- [ ] **Step 4: Commit**

```bash
git add src/lib/audio-analyzer.ts
git commit -m "feat: add drama contrast parameter to arcsToSequence"
```

---

### Task 2: Add `forcedBoundaries` to audio analysis

**Files:**
- Modify: `src/lib/audio-analyzer.ts:62-84`
- Modify: `src/lib/audio-analyzer.worker.ts:230-261`

- [ ] **Step 1: Update `analyzeAudio` to accept forced boundaries**

In `src/lib/audio-analyzer.ts`, change:

```ts
export function analyzeAudio(
  buffer: AudioBuffer,
  sensitivity = 0.5,
): { boundaries: TextureBoundary[]; arcs: ArcSegment[] } {
```

to:

```ts
export function analyzeAudio(
  buffer: AudioBuffer,
  sensitivity = 0.5,
  forcedBoundaries: number[] = [],
): { boundaries: TextureBoundary[]; arcs: ArcSegment[] } {
```

Then update the boundary merging logic. Replace:

```ts
  const times = [0, ...peaks.map((p) => p.time), buffer.duration];
```

with:

```ts
  // Merge auto-detected peaks with forced boundaries (forced wins within 0.5s)
  const autoTimes = peaks.map((p) => p.time);
  const forced = forcedBoundaries.filter((t) => t > 0 && t < buffer.duration);
  const merged = autoTimes.filter(
    (at) => !forced.some((ft) => Math.abs(at - ft) < 0.5),
  );
  const allBoundaries = [...merged, ...forced].sort((a, b) => a - b);
  // Deduplicate within 25ms tolerance
  const deduped: number[] = [];
  for (const t of allBoundaries) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1] > 0.025) {
      deduped.push(t);
    }
  }
  const times = [0, ...deduped, buffer.duration];
```

- [ ] **Step 2: Update `analyzeAudioAsync` to pass forced boundaries**

In `src/lib/audio-analyzer.ts`, change the `analyzeAudioAsync` signature:

```ts
export function analyzeAudioAsync(
  buffer: AudioBuffer,
  sensitivity = 0.5,
  forcedBoundaries: number[] = [],
): Promise<{ boundaries: TextureBoundary[]; arcs: ArcSegment[] }> {
```

Update the `postMessage` call (around line 116):

```ts
    worker.postMessage(
      { channelData, sampleRate: buffer.sampleRate, duration: buffer.duration, sensitivity, forcedBoundaries },
      channelData.map((c) => c.buffer),
    );
```

- [ ] **Step 3: Update the worker to handle forced boundaries**

In `src/lib/audio-analyzer.worker.ts`, change the `onmessage` handler. Update the destructure:

```ts
  const { channelData, sampleRate, duration, sensitivity, forcedBoundaries = [] } = e.data;
```

Replace the boundary construction block:

```ts
  const times = [0, ...peaks.map((p) => p.time), duration];
```

with the same merging logic:

```ts
  // Merge auto-detected peaks with forced boundaries (forced wins within 0.5s)
  const autoTimes = peaks.map((p: TextureBoundary) => p.time);
  const forced = (forcedBoundaries as number[]).filter((t: number) => t > 0 && t < duration);
  const merged = autoTimes.filter(
    (at: number) => !forced.some((ft: number) => Math.abs(at - ft) < 0.5),
  );
  const allBoundaries = [...merged, ...forced].sort((a: number, b: number) => a - b);
  const deduped: number[] = [];
  for (const t of allBoundaries) {
    if (deduped.length === 0 || t - deduped[deduped.length - 1] > 0.025) {
      deduped.push(t);
    }
  }
  const times = [0, ...deduped, duration];
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio-analyzer.ts src/lib/audio-analyzer.worker.ts
git commit -m "feat: support forced boundaries in audio analysis"
```

---

### Task 3: Add `attenuationMap` to `arcsToSequence`

**Files:**
- Modify: `src/lib/audio-analyzer.ts:356+`

- [ ] **Step 1: Add attenuationMap parameter**

Update the signature:

```ts
export function arcsToSequence(
  arcs: ArcSegment[],
  ranges: GenerateRanges = DEFAULT_RANGES,
  drama = 0.5,
  attenuationMap: Record<number, number> = {},
): string {
```

- [ ] **Step 2: Add helper to find matching attenuation**

Inside `arcsToSequence`, before the main loop, add:

```ts
  const TOLERANCE = 0.025; // 25ms
  function getAttenuation(startTime: number): number {
    for (const key of Object.keys(attenuationMap)) {
      if (Math.abs(Number(key) - startTime) <= TOLERANCE) return attenuationMap[Number(key)];
    }
    return 1.0;
  }
```

- [ ] **Step 3: Apply attenuation in the output loop**

Inside the main `for` loop (the `for (let i = 0; i < arcs.length; i++)` block), replace the existing `val` and `fadeOut` function declarations with attenuation-aware versions. The full replacement for the inner section of the loop is:

Find this block inside the loop (around lines 392–398):

```ts
    function val(k: keyof GenerateRanges, idx: number): number {
      return mapVal(norm[k][idx], ranges[k]);
    }
    function fadeOut(k: keyof GenerateRanges, idx: number): number {
      const v = val(k, idx);
      return ranges[k].min + (v - ranges[k].min) * 0.3;
    }
```

Replace it with:

```ts
    const atten = getAttenuation(a.startTime);
    function val(k: keyof GenerateRanges, idx: number): number {
      const v = mapVal(norm[k][idx], ranges[k]);
      return Math.max(PARAM_LIMITS[k].min, Math.min(PARAM_LIMITS[k].max, v * atten));
    }
    function fadeOut(k: keyof GenerateRanges, idx: number): number {
      const v = val(k, idx);
      return ranges[k].min + (v - ranges[k].min) * 0.3;
    }
```

`const atten` must come before `val`/`fadeOut` since both closures reference it. The existing `d0`, `c0`, `i0`, etc. locals that call `val()` do not need any changes — they will automatically pick up the attenuation because `val` now bakes it in. `fadeOut` does not need separate clamping because it scales down from the already-clamped `val` result.

- [ ] **Step 4: Add PARAM_LIMITS import if not already available**

`PARAM_LIMITS` is already exported from the same file — it's accessible. No import needed.

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/audio-analyzer.ts
git commit -m "feat: add per-arc attenuation map to arcsToSequence"
```

---

### Task 4: XY Pad UI + state in App.tsx

**Files:**
- Modify: `src/App.tsx:125-131` (state declarations)
- Modify: `src/App.tsx:695-735` (replace sensitivity slider with XY pad)
- Modify: `src/index.css` (add XY pad styles)

- [ ] **Step 1: Add CSS for the XY pad**

In `src/index.css`, before the `/* ── Draw Mode ──` comment (line 845), add:

```css
/* ── XY Pad ───────────────────────────── */

.gen-xy-wrap {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
}

.gen-xy-pad {
  width: 160px;
  height: 160px;
  background: rgba(15, 23, 42, 0.8);
  border: 1px solid rgba(100, 116, 139, 0.2);
  border-radius: 6px;
  position: relative;
  cursor: crosshair;
  touch-action: none;
}

.gen-xy-pad::before,
.gen-xy-pad::after {
  content: "";
  position: absolute;
  background: rgba(100, 116, 139, 0.08);
}

.gen-xy-pad::before {
  left: 50%;
  top: 0;
  bottom: 0;
  width: 1px;
}

.gen-xy-pad::after {
  top: 50%;
  left: 0;
  right: 0;
  height: 1px;
}

.gen-xy-dot {
  position: absolute;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #22d3ee;
  box-shadow: 0 0 8px rgba(6, 182, 212, 0.4);
  transform: translate(-50%, -50%);
  pointer-events: none;
}

.gen-xy-labels {
  display: flex;
  justify-content: space-between;
  width: 160px;
}

.gen-xy-label {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 9px;
  letter-spacing: 0.1em;
  color: #475569;
}

.gen-xy-axis-label {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 8px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  color: #334155;
  position: absolute;
}

.gen-xy-axis-x {
  bottom: -14px;
  left: 50%;
  transform: translateX(-50%);
}

.gen-xy-axis-y {
  left: -30px;
  top: 50%;
  transform: translateY(-50%) rotate(-90deg);
}
```

- [ ] **Step 2: Add `genDrama` state**

In `src/App.tsx`, after the `genSensitivity` state declaration (line 130), add:

```ts
  const [genDrama, setGenDrama] = useState(0.5);
```

- [ ] **Step 3: Replace sensitivity slider with XY pad**

In `src/App.tsx`, replace the entire sensitivity section (the `gen-row` div from around line 716 to 735, including the sensitivity slider, "more boundaries" hint, AND the `gen-divider` div at line 737) with:

```tsx
              {/* XY Pad: Frequency × Drama */}
              <div className="gen-xy-wrap">
                <div
                  className="gen-xy-pad"
                  onPointerDown={(e) => {
                    const pad = e.currentTarget;
                    const rect = pad.getBoundingClientRect();
                    const update = (px: number, py: number) => {
                      const x = Math.max(0, Math.min(1, (px - rect.left) / rect.width));
                      const y = Math.max(0, Math.min(1, 1 - (py - rect.top) / rect.height));
                      setGenSensitivity(x);
                      setGenDrama(y);
                    };
                    update(e.clientX, e.clientY);
                    const onMove = (ev: PointerEvent) => update(ev.clientX, ev.clientY);
                    const onUp = () => {
                      window.removeEventListener("pointermove", onMove);
                      window.removeEventListener("pointerup", onUp);
                    };
                    window.addEventListener("pointermove", onMove);
                    window.addEventListener("pointerup", onUp);
                  }}
                >
                  <div
                    className="gen-xy-dot"
                    style={{
                      left: `${genSensitivity * 100}%`,
                      top: `${(1 - genDrama) * 100}%`,
                    }}
                  />
                  <span className="gen-xy-axis-label gen-xy-axis-x">frequency</span>
                  <span className="gen-xy-axis-label gen-xy-axis-y">drama</span>
                </div>
                <div className="gen-xy-labels">
                  <span className="gen-xy-label">freq {genSensitivity.toFixed(2)}</span>
                  <span className="gen-xy-label">drama {genDrama.toFixed(2)}</span>
                </div>
              </div>

              <div className="gen-divider" />
```

- [ ] **Step 4: Update Reset button to reset pad position**

In `src/App.tsx`, in the Reset button's onClick handler (around line 793), add `setGenDrama(0.5);` alongside the existing resets:

```ts
                onClick={() => {
                  setGenRanges(JSON.parse(JSON.stringify(DEFAULT_RANGES)));
                  setGenSensitivity(0.5);
                  setGenDrama(0.5);
                }}
```

- [ ] **Step 5: Verify it compiles and renders**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npx tsc --noEmit`
Expected: No errors.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/index.css
git commit -m "feat: replace sensitivity slider with XY frequency/drama pad"
```

---

### Task 5: Master slider UI + state in App.tsx

**Files:**
- Modify: `src/App.tsx` (state, UI, effective range computation)
- Modify: `src/index.css` (master slider styles)

- [ ] **Step 1: Add CSS for master slider**

In `src/index.css`, after the XY pad styles, add:

```css
/* ── Master Slider ───────────────────────────── */

.gen-master-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gen-master-label {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 10px;
  letter-spacing: 0.15em;
  text-transform: uppercase;
  color: #64748b;
  width: 52px;
  flex-shrink: 0;
}
```

- [ ] **Step 2: Add `genMaster` state**

In `src/App.tsx`, after `genDrama` state, add:

```ts
  const [genMaster, setGenMaster] = useState(1.0);
```

- [ ] **Step 3: Add master slider UI**

In the modal body, after the XY pad `gen-divider` and before the per-parameter rows loop, add:

```tsx
              {/* Master attenuation */}
              <div className="gen-master-row">
                <span className="gen-master-label">master</span>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={genMaster}
                  onChange={(e) => setGenMaster(parseFloat(e.target.value))}
                  className="gen-slider"
                />
                <span className="gen-val">{genMaster.toFixed(2)}</span>
              </div>

              <div className="gen-divider" />
```

- [ ] **Step 4: Compute effective ranges and update param display**

In the per-parameter range display, update the displayed values to show effective (attenuated) values. In the `gen-val` spans for each parameter, replace:

```tsx
                          <span className="gen-val">
                            {range.min.toFixed(limits.step < 1 ? 2 : 0)}
                          </span>
```

with:

```tsx
                          <span className="gen-val" style={genMaster < 1 ? { opacity: 0.5 } : undefined}>
                            {(range.min * genMaster).toFixed(limits.step < 1 ? 2 : 0)}
                          </span>
```

And same for `range.max`:

```tsx
                          <span className="gen-val" style={genMaster < 1 ? { opacity: 0.5 } : undefined}>
                            {(range.max * genMaster).toFixed(limits.step < 1 ? 2 : 0)}
                          </span>
```

- [ ] **Step 5: Update Reset button**

Add `setGenMaster(1.0);` to the Reset onClick.

- [ ] **Step 6: Verify compilation**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npx tsc --noEmit`

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx src/index.css
git commit -m "feat: add master attenuation slider to generate modal"
```

---

### Task 6: Wire drama + master into `runGenerate`

**Files:**
- Modify: `src/App.tsx:288-313` (`runGenerate`)

- [ ] **Step 1: Compute effective ranges in runGenerate**

Replace the current `runGenerate` implementation:

```ts
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
```

with:

```ts
  const runGenerate = useCallback(async () => {
    if (!playback.audioBuffer) return;

    setAnalyzing(true);

    try {
      // Compute effective ranges (master-scaled, clamped)
      const effectiveRanges = { ...genRanges } as GenerateRanges;
      for (const k of Object.keys(genRanges) as (keyof GenerateRanges)[]) {
        let eMin = genRanges[k].min * genMaster;
        let eMax = genRanges[k].max * genMaster;
        const lim = PARAM_LIMITS[k];
        eMin = Math.max(lim.min, Math.min(lim.max, eMin));
        eMax = Math.max(lim.min, Math.min(lim.max, eMax));
        if (eMin > eMax) eMin = eMax;
        effectiveRanges[k] = { min: eMin, max: eMax };
      }

      const { arcs } = await analyzeAudioAsync(
        playback.audioBuffer,
        genSensitivity,
      );
      const dsl = arcsToSequence(arcs, effectiveRanges, genDrama);

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
  }, [sequenceText, applySequence, genRanges, genMaster, genDrama, genSensitivity, playback.audioBuffer]);
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npx tsc --noEmit`

- [ ] **Step 3: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire drama and master into runGenerate"
```

---

### Task 7: Hitpoint panel UI + state

**Files:**
- Modify: `src/App.tsx` (new state, hitpoint panel JSX)
- Modify: `src/index.css` (hitpoint panel styles)

- [ ] **Step 1: Add CSS for hitpoint panel**

In `src/index.css`, after the master slider styles, add:

```css
/* ── Hitpoint Panel ───────────────────────────── */

.gen-hp-panel {
  position: fixed;
  z-index: 51;
  top: 50%;
  transform: translateY(-50%);
  right: calc(50% + 230px);
  width: 340px;
  background: rgba(8, 12, 24, 0.95);
  border: 1px solid rgba(100, 116, 139, 0.2);
  border-radius: 10px;
  padding: 14px 18px;
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.gen-hp-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.gen-hp-title {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 10px;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: #94a3b8;
}

.gen-hp-note {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 9px;
  color: #475569;
}

.gen-hp-toggle {
  position: relative;
  width: 36px;
  height: 18px;
  background: rgba(30, 41, 59, 0.8);
  border: 1px solid rgba(100, 116, 139, 0.2);
  border-radius: 9px;
  cursor: pointer;
  transition: background 0.2s;
}

.gen-hp-toggle.on {
  background: rgba(6, 182, 212, 0.25);
  border-color: rgba(6, 182, 212, 0.4);
}

.gen-hp-toggle-dot {
  position: absolute;
  top: 2px;
  left: 2px;
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: #475569;
  transition: all 0.2s;
}

.gen-hp-toggle.on .gen-hp-toggle-dot {
  left: 20px;
  background: #22d3ee;
}

.gen-hp-slider-row {
  display: flex;
  align-items: center;
  gap: 8px;
}

.gen-hp-slider-label {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 14px;
  color: #475569;
  width: 14px;
  text-align: center;
  flex-shrink: 0;
}

.gen-hp-nav {
  display: flex;
  justify-content: center;
  gap: 8px;
}

.gen-hp-nav-btn {
  font-family: "SF Mono", "Fira Code", monospace;
  font-size: 10px;
  letter-spacing: 0.1em;
  text-transform: uppercase;
  padding: 4px 14px;
  border-radius: 4px;
  border: 1px solid rgba(100, 116, 139, 0.2);
  cursor: pointer;
  transition: all 0.15s;
  background: transparent;
  color: #94a3b8;
}

.gen-hp-nav-btn:hover {
  border-color: rgba(100, 116, 139, 0.4);
  color: #e2e8f0;
}

.gen-hp-nav-btn.last {
  background: rgba(244, 114, 182, 0.12);
  color: #f472b6;
  border-color: rgba(244, 114, 182, 0.25);
}

.gen-hp-nav-btn.last:hover {
  background: rgba(244, 114, 182, 0.2);
}
```

- [ ] **Step 2: Add hitpoint state**

In `src/App.tsx`, after `genMaster` state, add:

```ts
  const [hitpointsEnabled, setHitpointsEnabled] = useState(false);
  const [hitpointAttenuations, setHitpointAttenuations] = useState<Record<string, number>>({});
  const [activeHitpointIdx, setActiveHitpointIdx] = useState(0);
```

- [ ] **Step 3: Add sorted notes memo and helpers**

After the hitpoint state, add:

```ts
  const sortedNotes = useMemo(
    () => [...notes].sort((a, b) => a.time - b.time),
    [notes],
  );

  // Clamp active hitpoint index when notes change
  useEffect(() => {
    if (sortedNotes.length === 0) {
      setActiveHitpointIdx(0);
    } else if (activeHitpointIdx >= sortedNotes.length) {
      setActiveHitpointIdx(sortedNotes.length - 1);
    }
  }, [sortedNotes.length, activeHitpointIdx]);

  const activeNote = sortedNotes[activeHitpointIdx] ?? null;

  const getHitpointAtten = useCallback(
    (noteId: string) => hitpointAttenuations[noteId] ?? 1.0,
    [hitpointAttenuations],
  );

  const setHitpointAtten = useCallback(
    (noteId: string, value: number) => {
      setHitpointAttenuations((prev) => ({ ...prev, [noteId]: value }));
    },
    [],
  );
```

- [ ] **Step 4: Add hitpoint panel JSX**

In the generate modal backdrop (inside the `gen-modal-backdrop` div, before the `gen-modal` div), add the hitpoint panel:

```tsx
            {/* Hitpoint panel */}
            {sortedNotes.length > 0 && (
              <div className="gen-hp-panel">
                <div className="gen-hp-header">
                  <span className="gen-hp-title">
                    hitpoint: {activeNote
                      ? `note #${activeHitpointIdx + 1} (${formatTime(activeNote.time)})`
                      : "—"}
                  </span>
                  <div
                    className={`gen-hp-toggle${hitpointsEnabled ? " on" : ""}`}
                    onClick={() => setHitpointsEnabled((v) => !v)}
                  >
                    <div className="gen-hp-toggle-dot" />
                  </div>
                </div>

                {activeNote && (
                  <>
                    <div className="gen-hp-slider-row">
                      <span className="gen-hp-slider-label">&minus;</span>
                      <input
                        type="range"
                        min="0"
                        max="2"
                        step="0.01"
                        value={getHitpointAtten(activeNote.id)}
                        onChange={(e) => setHitpointAtten(activeNote.id, parseFloat(e.target.value))}
                        className="gen-slider"
                      />
                      <span className="gen-hp-slider-label">+</span>
                    </div>
                    <span className="gen-hp-note">
                      {getHitpointAtten(activeNote.id).toFixed(2)}x
                      {activeNote.text ? ` — ${activeNote.text.slice(0, 30)}` : ""}
                    </span>
                  </>
                )}

                <div className="gen-hp-nav">
                  <button
                    className="gen-hp-nav-btn last"
                    onClick={() =>
                      setActiveHitpointIdx((i) => Math.max(0, i - 1))
                    }
                    disabled={activeHitpointIdx === 0}
                  >
                    Last
                  </button>
                  <button
                    className="gen-hp-nav-btn"
                    onClick={() =>
                      setActiveHitpointIdx((i) =>
                        Math.min(sortedNotes.length - 1, i + 1),
                      )
                    }
                    disabled={activeHitpointIdx >= sortedNotes.length - 1}
                  >
                    Next
                  </button>
                </div>
              </div>
            )}
```

- [ ] **Step 5: Verify compilation**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npx tsc --noEmit`

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/index.css
git commit -m "feat: add hitpoint panel UI with per-note attenuation"
```

---

### Task 8: Wire hitpoints into `runGenerate`

**Files:**
- Modify: `src/App.tsx:288+` (`runGenerate`)

- [ ] **Step 1: Update runGenerate to pass forced boundaries and attenuation**

Update `runGenerate` to incorporate hitpoint data. In the `try` block, after effective ranges computation and before the `analyzeAudioAsync` call, add forced boundaries logic. And pass attenuation to `arcsToSequence`.

Replace the `analyzeAudioAsync` and `arcsToSequence` calls with:

```ts
      // Collect forced boundaries from hitpoints
      const forcedBoundaries = hitpointsEnabled && sortedNotes.length > 0
        ? sortedNotes.map((n) => n.time)
        : [];

      // Build attenuation map (keyed by time for arcsToSequence)
      const attenuationMap: Record<number, number> = {};
      if (hitpointsEnabled) {
        for (const n of sortedNotes) {
          attenuationMap[n.time] = hitpointAttenuations[n.id] ?? 1.0;
        }
      }

      const { arcs } = await analyzeAudioAsync(
        playback.audioBuffer,
        genSensitivity,
        forcedBoundaries,
      );
      const dsl = arcsToSequence(arcs, effectiveRanges, genDrama, attenuationMap);
```

- [ ] **Step 2: Update useCallback dependency array**

Add `hitpointsEnabled`, `sortedNotes`, `hitpointAttenuations` to the dependency array:

```ts
  }, [sequenceText, applySequence, genRanges, genMaster, genDrama, genSensitivity, hitpointsEnabled, sortedNotes, hitpointAttenuations, playback.audioBuffer]);
```

- [ ] **Step 3: Update Reset button to reset hitpoint attenuations**

In the Reset onClick, add:

```ts
                  setHitpointAttenuations({});
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npx tsc --noEmit`

- [ ] **Step 5: Manual test**

Run: `cd /Users/alex/Documents/Cufolio/clarinetsonata && npm run dev`

Test the full flow:
1. Drop an MP3 file
2. Click Generate — the XY pad should appear with a draggable dot
3. Drag the dot: X changes sensitivity, Y changes drama
4. Adjust the master slider — per-param values should dim and show scaled values
5. Add some notes on the timeline
6. Re-open Generate — hitpoint panel should appear on the left
7. Toggle hitpoints on, adjust attenuation for a note, click Run
8. Verify the generated DSL has segment boundaries at note timestamps

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx
git commit -m "feat: wire hitpoints into runGenerate with forced boundaries and attenuation"
```
