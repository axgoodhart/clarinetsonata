# Generate Panel Enhancements

Three additions to the Generate from Audio modal and surrounding UI: a master attenuation slider, a 2D frequency/drama XY pad, and a hitpoint system that locks timeline notes as forced segment boundaries with per-note intensity.

## Modifier Application Order

All three features produce modifiers that stack in this order:
1. **Drama** — adjusts normalized feature values (contrast curve) before range mapping
2. **Master** — scales the effective min/max ranges used during mapping
3. **Hitpoint attenuation** — scales the final mapped output values per-arc

## 1. Master Slider

### What
A single slider (range 0–1, default 1.0) that multiplies every per-parameter min/max value proportionally.

### Where
Top of the generate modal body, below the XY pad (section 2), above the per-parameter rows.

### Behavior
- Acts as a multiplier on the "base" values stored in `genRanges`.
- Slider handles on per-param rows stay at their base positions. The numeric label next to each slider shows the effective (attenuated) value when master is not 1.0, formatted as the attenuated value with reduced opacity to distinguish from base.
- The base values themselves are not mutated — only the effective values passed to `arcsToSequence` are scaled.
- At 1.0: no attenuation. At 0.5: all mins and maxes halved. At 0.0: everything zeroes out.
- Effective range computation: `effectiveRange[param] = { min: base.min * master, max: base.max * master }`, clamped per-param to `[PARAM_LIMITS[param].min, PARAM_LIMITS[param].max]`.
- If effective min > effective max after scaling (possible when base min is close to base max and master is very low), clamp effective min to effective max.
- The existing footer Reset button resets master to 1.0 alongside resetting `genRanges` and sensitivity (augments existing reset, no new button).

### State
- New state: `genMaster: number` (default 1.0).

### Files touched
- `src/App.tsx`: new state, UI row, pass effective ranges to `runGenerate`.

## 2. XY Pad (Frequency / Drama)

### What
A square draggable pad where X = frequency (segment granularity) and Y = drama (contrast between consecutive segments).

### Where
Replaces the current standalone sensitivity slider in the generate modal. Sits below the modal header, above the master slider.

### Axes
- **X — Frequency (0–1):** Maps directly to the existing `genSensitivity` value. Left = fewer, longer segments. Right = more, shorter segments. This is passed to `analyzeAudioAsync` as `sensitivity`.
- **Y — Drama (0–1, default 0.5):** Controls how much contrast exists between consecutive segments. At 0 (bottom), values are smoothed so adjacent segments look similar. At 1 (top), differences are exaggerated for maximum contrast.

### Drama implementation
Drama is applied in `arcsToSequence` after normalization and before range mapping:
- A `drama` parameter (0–1) is added to the function signature.
- For each normalized feature array, apply a linear contrast expansion: `adjusted = 0.5 + (norm - 0.5) * (drama * 2)`, clamped to 0–1.
- At drama=0.5 (default): identity (no change). At drama=0: all values collapse to 0.5 (flat/uniform). At drama=1: values outside [0.25, 0.75] are hard-clipped to 0 or 1; values near center still have some gradient. This is a linear contrast stretch, not a binary threshold.

### UI
- Square element (~160x160px) with a subtle grid/crosshair. CSS classes: `.gen-xy-pad`, `.gen-xy-dot`, `.gen-xy-label`.
- A dot that tracks pointer drag, constrained within the pad.
- Uses `pointerdown` on the pad + `pointermove`/`pointerup` on `window` to handle drag-outside-pad correctly.
- X/Y values displayed as small labels below the pad (e.g. "freq 0.50 / drama 0.50").
- Styled to match the existing modal aesthetic (dark background, accent-colored dot).

### State
- `genSensitivity` continues to exist but is now driven by the pad's X value.
- New state: `genDrama: number` (default 0.5).
- The existing footer Reset button resets the pad position to center (sensitivity=0.5, drama=0.5).

### Files touched
- `src/App.tsx`: replace sensitivity slider with XY pad, add `genDrama` state, pass drama to `arcsToSequence`.
- `src/lib/audio-analyzer.ts`: add `drama` parameter to `arcsToSequence`, apply contrast curve after normalization.
- `src/index.css`: styles for the XY pad (`.gen-xy-pad`, `.gen-xy-dot`, `.gen-xy-label`).

## 3. Hitpoint Panel

### What
A floating panel that turns existing timeline notes into forced segment boundaries with per-note attenuation sliders.

### Where
Separate floating panel to the left of the generate modal. Visible whenever the generate modal is open AND notes exist. Contains an enable/disable toggle that controls whether hitpoints affect generation.

### UI Elements
- **Toggle:** A small switch in the panel header. Controls whether hitpoints are used during `runGenerate`. Panel is always visible (when modal open + notes exist) so the toggle is always accessible.
- **Note display:** "HITPOINT: note #N (M:SS.ss)" showing the currently selected note.
- **Attenuation slider:** A single slider (labeled with −/+ endpoints) per note, range 0–2 (default 1.0). This is a per-note master that scales all generated parameter values at that note's boundary. Below 1 = quieter/subtler. Above 1 = louder/more intense.
- **LAST / NEXT buttons:** Cycle through notes sorted by time.
- Notes without text still work as hitpoints (the timestamp is what matters).
- If no notes exist, the panel is hidden entirely.

### Behavior
When hitpoints are enabled and `runGenerate` runs:

1. **Forced boundaries:** Note timestamps are injected into the arc boundary list alongside the auto-detected peaks. The analyzer still runs its FFT analysis, but the final arc list includes note times as non-negotiable cut points. If a note timestamp is within 0.5s of an auto-detected peak, the auto-detected peak is dropped in favor of the note boundary (notes win ties). Deduplication uses a 25ms tolerance window to account for HOP-quantized frame times.
2. **Per-note attenuation:** Inside `arcsToSequence`, after computing each arc's final parameter values, arcs whose start time matches a note timestamp (within ±25ms tolerance) have all values multiplied by that note's attenuation factor, then clamped to `PARAM_LIMITS`.
3. At runtime, if `hitpointsEnabled && notes.length === 0`, treat as hitpoints-disabled (no forced boundaries, no attenuation).

### State
- New state: `hitpointsEnabled: boolean` (default false).
- New state: `hitpointAttenuations: Record<string, number>` — maps note ID to attenuation factor (default 1.0 per note).
- New state: `activeHitpointIdx: number` (default 0) — index into time-sorted notes array for LAST/NEXT cycling. Clamped to `Math.min(idx, sortedNotes.length - 1)` whenever notes change (deletion/reorder).

### Data flow
- `runGenerate` collects note timestamps and builds a time-keyed attenuation map: `Record<number, number>` mapping `note.time → hitpointAttenuations[note.id]` (defaults to 1.0 if not set).
- Passes forced boundary times to `analyzeAudioAsync` via an updated worker message: `{ channelData, sampleRate, duration, sensitivity, forcedBoundaries?: number[] }`.
- The worker's `self.onmessage` destructures `forcedBoundaries`, merges them into the `times` array (with dedup/priority logic), then proceeds as normal.
- `arcsToSequence` gains an optional `attenuationMap?: Record<number, number>` parameter. For each arc, if `attenuationMap` has a key within ±25ms of the arc's `startTime`, multiply all output values by that factor (clamped to param limits).

### Files touched
- `src/App.tsx`: hitpoint panel UI, new state, modified `runGenerate` to build forced boundaries + attenuation map.
- `src/lib/audio-analyzer.ts`: `analyzeAudio` accepts optional `forcedBoundaries: number[]`; `arcsToSequence` accepts optional `attenuationMap: Record<number, number>`.
- `src/lib/audio-analyzer.worker.ts`: `self.onmessage` accepts `forcedBoundaries` in message data, merges into boundary list.
- `src/index.css`: hitpoint panel styles.

## File Change Summary

| File | Changes |
|------|---------|
| `src/App.tsx` | Master slider state + UI, XY pad replacing sensitivity slider, hitpoint panel UI + state, modified `runGenerate` |
| `src/lib/audio-analyzer.ts` | `drama` param in `arcsToSequence`, `forcedBoundaries` param in `analyzeAudio`, `attenuationMap` param in `arcsToSequence` |
| `src/lib/audio-analyzer.worker.ts` | Accept `forcedBoundaries` in message, merge into boundary list before arc construction |
| `src/index.css` | Styles for XY pad (`.gen-xy-*`), master slider, hitpoint panel |

## Edge Cases

- **No notes + hitpoint toggle:** Panel hidden entirely. If `hitpointsEnabled` is true but notes array is empty at run time, treat as disabled.
- **Master at 0 + hitpoint attenuation at 2:** Result is still 0 (master scales ranges first → all ranges zero → attenuation on zero is zero).
- **Note at exact same time as auto-detected boundary:** Note wins; auto-detected peak dropped.
- **Note within 0.5s of auto-detected boundary:** Auto-detected boundary dropped to prevent the minimum-gap filter from silently discarding the resulting arc.
- **Notes outside audio duration:** Ignored (filtered before injection).
- **Drama at extremes:** Linear contrast expansion clamped 0–1. At drama=1, values near 0.5 still have gradient; only extreme inputs hit 0/1.
- **Inverted effective range (min > max):** Clamp effective min to effective max.
- **Active hitpoint index after note deletion:** Clamped to bounds of sorted notes array.
- **Floating-point time matching:** Arc start times matched to note times with ±25ms tolerance.
