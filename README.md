# Clarinet Sonata — Sonoscape Explorer

A sequenced, audio-reactive particle soundscape. You write a timeline of visual states in a simple DSL, and the particle field smoothly transitions between them in sync with audio playback.

## Quick Start

```bash
npm install
npm run dev
```

Open the local URL, click to start. The demo sequence runs automatically.

Audio loads automatically from `src/mvt2.mp3`. You can also drag-and-drop a different audio file onto the page to override.

## How It Works

The system has four parts:

1. **Sequence** (`src/sequence.ts`) — a timeline you write in a small DSL
2. **Engine** — interpolates between your keyframes over time
3. **Particle Field** — renders the visual state each frame on canvas
4. **Audio Player** — syncs playback time and feeds FFT data back into the visuals

Without audio, the sequence runs on a wall-clock timer. With audio, it locks to playback time and the frequency spectrum adds energy on top of your scripted values (bass boosts intensity/size, mids add turbulence, highs extend connectivity).

## Sequence DSL

Edit `src/sequence.ts`. The sequence is a series of **phrases**, each defining a begin and end state over a time range. Every parameter gets its own line with `begin | end` values, and the phrase closes with a `|||` time line:

```
# Phrase name
density(0.01 | 0.15)
connect(20 | 60)
drift(down, slow | right, medium)
intensity(0.1 | 0.3)
spread(0.8 | 0.5)
size(0.3 | 0.4)
turbulence(0.05 | 0.1)
opacity(0.3 | 0.6)
palette(cool | cool)
||| 0s 4.99s
```

Values **lerp smoothly** from begin to end over the time range. Add `snap` after the end time for an instant jump:

```
||| 32s 32.01s snap
```

Lines starting with `#` are comments. Blank lines are ignored.

### Parameters

| Parameter | Range | Description |
|-----------|-------|-------------|
| `density(n)` | 0–1 | Fraction of max particles (350) |
| `connect(px)` | 0+ | Max pixel distance for drawing connection lines |
| `drift(dir, speed)` | — | Direction and speed of particle movement. **Directions:** `up`, `down`, `left`, `right`, `upleft`, `upright`, `downleft`, `downright`, `outward` (radial from center), `inward` (toward center), `still`. **Speeds:** `still`, `slow`, `medium`, `fast`, or a raw number (e.g., `drift(up, 1.5)`) |
| `intensity(n)` | 0–1 | Visual depth. Controls trail persistence (high = long glowing trails), particle glow (shadowBlur), and overall visual weight |
| `spread(n)` | 0–1 | 0 = clustered at center, 1 = dispersed across canvas |
| `size(n)` | 0–1 | Particle size multiplier |
| `turbulence(n)` | 0–1 | Random motion / jitter |
| `opacity(n)` | 0–1 | Overall opacity of particles and connections |
| `palette(name)` | — | Color scheme. **Named:** `cool` (blue+purple, default), `warm` (amber+red), `mono` (slate grays), `ember` (red+orange), `forest` (emerald+cyan), `void` (dark slate), `rose` (rose+pink), `aurora` (cyan+purple). **Custom hex:** `palette(#ff4488, #4488ff)` |

**Attenuating and intensifying:** combine parameters for depth control. Intensify with high `density` + `connect` + `intensity` + `spread` + `size`. Attenuate with low values on those plus low `opacity` and `turbulence`.

### Minimal Example

```
# Fade in from nothing
density(0.05 | 1.0)
intensity(0.1 | 1.0)
opacity(0.3 | 1.0)
||| 0s 20s

# Cut to black
density(1.0 | 0)
opacity(1.0 | 0)
||| 20s 20.01s snap
```

## Audio Integration

When an audio file is loaded:

- The sequence timeline locks to audio playback time (pause audio = pause sequence)
- Real-time FFT analysis modulates the visual state on top of your scripted values:
  - **Bass** (20–200 Hz) → boosts `intensity` and `size`
  - **Mids** (200–2000 Hz) → boosts `turbulence`
  - **Highs** (2000+ Hz) → extends `connect` distance

This means your sequence sets the baseline mood, and the actual audio adds life and responsiveness.

## File Structure

```
src/
  sequence.ts            ← your sequence (edit this)
  mvt2.mp3               ← audio file (auto-loaded)
  App.tsx                ← main component, wires everything together
  lib/
    types.ts             ← shared types, palettes, constants
    sequence-parser.ts   ← DSL parser
    sequence-engine.ts   ← keyframe interpolation
    particle-field.ts    ← canvas renderer
    audio-player.ts      ← Web Audio API wrapper
```
