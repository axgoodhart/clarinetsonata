# Clarinet Sonata Architecture Refactor

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address all 6 CLAUDE.md architectural issues: decompose god component, fix React-bypassing state, move audio analysis to Web Worker, improve DSL error handling, migrate particles to WebGL, and consolidate CSS.

**Architecture:** Extract playback engine and frame loop into custom hooks (usePlayback, useFrame). Move FFT to a Web Worker. Replace Canvas 2D particle renderer with PixiJS for GPU-accelerated rendering. Remove timed DSL rollback in favor of persistent error display. Consolidate all styling into CSS classes, removing Tailwind utility classes from JSX.

**Tech Stack:** React 19, Vite 8, PixiJS 8, TypeScript 5.9, Web Workers (native)

---

## File Structure

### New Files
- `src/hooks/usePlayback.ts` — Playback engine hook (timing, play/pause/seek, audio sync)
- `src/hooks/useFrame.ts` — requestAnimationFrame subscription hook (replaces React-bypassing refs)
- `src/lib/audio-analyzer.worker.ts` — Web Worker for FFT/spectral analysis
- `src/lib/particle-field-gl.ts` — PixiJS-based particle renderer (replaces Canvas 2D)

### Modified Files
- `src/App.tsx` — Dramatically slimmed: uses hooks, no manual loop
- `src/index.css` — Receives all styling previously in Tailwind utilities
- `src/lib/audio-analyzer.ts` — Thin wrapper that posts to worker
- `src/lib/particle-field.ts` — Removed (replaced by particle-field-gl.ts)
- `package.json` — Add pixi.js dependency

---

## Task 1: CSS Consolidation (Issue #6)

**Files:**
- Modify: `src/index.css`
- Modify: `src/App.tsx` — Remove all Tailwind utility classes, replace with CSS classes
- Modify: `src/WaveformTimeline.tsx` — Remove inline styles

- [ ] **Step 1:** Add CSS classes to index.css for every Tailwind utility or inline style used in JSX
- [ ] **Step 2:** Replace all `className="..."` utility strings in App.tsx with semantic CSS classes
- [ ] **Step 3:** Replace inline `style={{}}` in WaveformTimeline.tsx with CSS classes
- [ ] **Step 4:** Verify build: `npm run build`
- [ ] **Step 5:** Run lint: `npm run lint`

---

## Task 2: Web Worker for Audio Analysis (Issue #3)

**Files:**
- Create: `src/lib/audio-analyzer.worker.ts`
- Modify: `src/lib/audio-analyzer.ts` — Add async wrapper
- Modify: `src/App.tsx` — Use async analysis

- [ ] **Step 1:** Create `audio-analyzer.worker.ts` — move `analyzeAudio`, `extractFrames`, `fftInPlace`, `spectralFlux`, `smooth`, `pickPeaks`, `characterizeArc`, `mixToMono`, `hanningWindow` into the worker
- [ ] **Step 2:** Add `analyzeAudioAsync()` to `audio-analyzer.ts` that creates/posts to worker and returns a Promise
- [ ] **Step 3:** Update `runGenerate` in App.tsx to use `await analyzeAudioAsync()` instead of sync call
- [ ] **Step 4:** Verify build: `npm run build`
- [ ] **Step 5:** Run lint: `npm run lint`

---

## Task 3: DSL Error Handling (Issue #4)

**Files:**
- Modify: `src/App.tsx:114-145` — Remove timed rollback, keep error state persistent

- [ ] **Step 1:** Remove the 1.5s `setTimeout` rollback in `handleSequenceEdit`. Instead: on parse error, set `editorError: true` and keep the invalid text. The engine retains the last valid state.
- [ ] **Step 2:** Remove `errorTimerRef` entirely
- [ ] **Step 3:** Verify build + lint

---

## Task 4: Extract usePlayback Hook (Issue #1 + #2)

**Files:**
- Create: `src/hooks/usePlayback.ts`
- Modify: `src/App.tsx` — Remove all playback state/refs, use hook

- [ ] **Step 1:** Create `usePlayback.ts` encapsulating: `isPlayingRef`, `playStartRef`, `pauseOffsetRef`, `currentTimeRef`, `audioRef`, timing logic, play/pause/seek/toggle handlers, audio loading. Returns `{ isPlaying, currentTime, hasAudio, audioDuration, audioBuffer, play, pause, toggle, seek, scrub, loadFile, loadUrl, getFFT }`.
- [ ] **Step 2:** Update App.tsx to use `usePlayback()` — remove ~15 refs and ~5 callbacks
- [ ] **Step 3:** Verify build + lint

---

## Task 5: Extract useFrame Hook (Issue #2)

**Files:**
- Create: `src/hooks/useFrame.ts`
- Modify: `src/App.tsx` — Replace manual loop() with useFrame

- [ ] **Step 1:** Create `useFrame.ts` — a hook that runs a callback every animation frame via requestAnimationFrame. Manages the animation loop lifecycle. Signature: `useFrame(callback: (time: number) => void, active: boolean)`.
- [ ] **Step 2:** Integrate useFrame into usePlayback for time tracking. The playback hook uses useFrame internally to update `currentTime` at 60fps and provides a throttled React state update at 250ms.
- [ ] **Step 3:** Refactor App.tsx loop() into a useFrame callback that only handles: engine state lookup, audio reactivity, and particle field updates. Remove all manual RAF management.
- [ ] **Step 4:** Remove `timeDisplayRef` and `scrubRef` direct DOM manipulation — usePlayback provides currentTime via ref for high-frequency reads.
- [ ] **Step 5:** Verify build + lint

---

## Task 6: PixiJS Particle Renderer (Issue #5)

**Files:**
- Create: `src/lib/particle-field-gl.ts`
- Modify: `src/App.tsx` — Use new renderer
- Modify: `package.json` — Add pixi.js

- [ ] **Step 1:** Install PixiJS: `npm install pixi.js`
- [ ] **Step 2:** Create `particle-field-gl.ts` with same public API as `particle-field.ts` (`setState`, `tick`, `reset`, `resize`, `drawDemoOverlay`) but using PixiJS Application + Container + Graphics/Sprites for particles
- [ ] **Step 3:** Use PixiJS filters for glow effects instead of CPU shadowBlur
- [ ] **Step 4:** Implement object pool for particles (no splice)
- [ ] **Step 5:** Update App.tsx to import from `particle-field-gl.ts`
- [ ] **Step 6:** Verify build + lint
- [ ] **Step 7:** Test visually in dev

---

## Execution Order

Tasks 1, 2, 3 are independent and can run in parallel.
Task 4 depends on nothing but is a prerequisite for Task 5.
Task 5 depends on Task 4.
Task 6 is independent but should run after Task 5 (since App.tsx will be its final shape).

Parallel wave 1: Tasks 1, 2, 3
Sequential wave 2: Task 4 → Task 5
Final wave 3: Task 6
