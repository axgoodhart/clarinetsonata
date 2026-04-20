import { useRef, useEffect, useCallback } from "react";
import type { Segment } from "./lib/segment-utils";

interface WaveformTimelineProps {
  audioBuffer: AudioBuffer | null;
  segments: Segment[];
  currentTime: number;
  totalDuration: number;
  selectedIdx: number;
  onScrub: (time: number) => void;
  onSelectSegment: (idx: number) => void;
  noteEntryMode?: boolean;
  onAddNoteAtTime?: (time: number) => void;
}

const BLOCK_PALETTE = [
  "rgba(96, 165, 250, 0.18)",
  "rgba(167, 139, 250, 0.18)",
  "rgba(52, 211, 153, 0.18)",
  "rgba(251, 191, 36, 0.18)",
  "rgba(244, 114, 182, 0.18)",
  "rgba(129, 140, 248, 0.18)",
  "rgba(45, 212, 191, 0.18)",
  "rgba(248, 113, 113, 0.18)",
];

const BLOCK_BORDER_PALETTE = [
  "rgba(96, 165, 250, 0.4)",
  "rgba(167, 139, 250, 0.4)",
  "rgba(52, 211, 153, 0.4)",
  "rgba(251, 191, 36, 0.4)",
  "rgba(244, 114, 182, 0.4)",
  "rgba(129, 140, 248, 0.4)",
  "rgba(45, 212, 191, 0.4)",
  "rgba(248, 113, 113, 0.4)",
];

const SELECTED_BORDER_PALETTE = [
  "rgba(96, 165, 250, 0.85)",
  "rgba(167, 139, 250, 0.85)",
  "rgba(52, 211, 153, 0.85)",
  "rgba(251, 191, 36, 0.85)",
  "rgba(244, 114, 182, 0.85)",
  "rgba(129, 140, 248, 0.85)",
  "rgba(45, 212, 191, 0.85)",
  "rgba(248, 113, 113, 0.85)",
];

const HEIGHT = 60;
const BG_COLOR = "#030712";
const WAVEFORM_FILL = "rgba(96, 165, 250, 0.15)";
const WAVEFORM_STROKE = "rgba(96, 165, 250, 0.3)";
const PLAYHEAD_COLOR = "#22d3ee";
const FONT = '9px "SF Mono", "Fira Code", monospace';

function computePeaks(audioBuffer: AudioBuffer, numPeaks: number): Float32Array {
  const peaks = new Float32Array(numPeaks);
  const channelData = audioBuffer.getChannelData(0);
  const samplesPerPeak = Math.floor(channelData.length / numPeaks);

  for (let i = 0; i < numPeaks; i++) {
    let max = 0;
    const start = i * samplesPerPeak;
    const end = Math.min(start + samplesPerPeak, channelData.length);
    for (let j = start; j < end; j++) {
      const abs = Math.abs(channelData[j]);
      if (abs > max) max = abs;
    }
    peaks[i] = max;
  }

  return peaks;
}

export default function WaveformTimeline({
  audioBuffer,
  segments,
  currentTime,
  totalDuration,
  selectedIdx,
  onScrub,
  onSelectSegment,
  noteEntryMode,
  onAddNoteAtTime,
}: WaveformTimelineProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);
  const rafId = useRef(0);
  const peaksCache = useRef<{ buffer: AudioBuffer; width: number; peaks: Float32Array } | null>(
    null
  );

  const timeToX = useCallback(
    (time: number, width: number) => {
      if (totalDuration <= 0) return 0;
      return (time / totalDuration) * width;
    },
    [totalDuration]
  );

  const xToTime = useCallback(
    (x: number, width: number) => {
      if (width <= 0) return 0;
      return Math.max(0, Math.min(totalDuration, (x / width) * totalDuration));
    },
    [totalDuration]
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = HEIGHT;

    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    // Background
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, w, h);

    // Waveform
    if (audioBuffer) {
      const numPeaks = Math.max(1, Math.floor(w / 2));
      let peaks: Float32Array;

      if (
        peaksCache.current &&
        peaksCache.current.buffer === audioBuffer &&
        peaksCache.current.width === numPeaks
      ) {
        peaks = peaksCache.current.peaks;
      } else {
        peaks = computePeaks(audioBuffer, numPeaks);
        peaksCache.current = { buffer: audioBuffer, width: numPeaks, peaks };
      }

      const midY = h / 2;
      const pxPerPeak = w / numPeaks;

      // Fill
      ctx.beginPath();
      ctx.moveTo(0, midY);
      for (let i = 0; i < numPeaks; i++) {
        const x = i * pxPerPeak;
        const amp = peaks[i] * midY * 0.9;
        ctx.lineTo(x, midY - amp);
      }
      ctx.lineTo(w, midY);
      for (let i = numPeaks - 1; i >= 0; i--) {
        const x = i * pxPerPeak;
        const amp = peaks[i] * midY * 0.9;
        ctx.lineTo(x, midY + amp);
      }
      ctx.closePath();
      ctx.fillStyle = WAVEFORM_FILL;
      ctx.fill();

      // Stroke top edge
      ctx.beginPath();
      ctx.moveTo(0, midY);
      for (let i = 0; i < numPeaks; i++) {
        const x = i * pxPerPeak;
        const amp = peaks[i] * midY * 0.9;
        ctx.lineTo(x, midY - amp);
      }
      ctx.strokeStyle = WAVEFORM_STROKE;
      ctx.lineWidth = 1;
      ctx.stroke();

      // Stroke bottom edge
      ctx.beginPath();
      ctx.moveTo(0, midY);
      for (let i = 0; i < numPeaks; i++) {
        const x = i * pxPerPeak;
        const amp = peaks[i] * midY * 0.9;
        ctx.lineTo(x, midY + amp);
      }
      ctx.stroke();
    }

    // Phase blocks
    segments.forEach((seg, idx) => {
      const x1 = timeToX(seg.startTime, w);
      const x2 = timeToX(seg.endTime, w);
      const blockW = x2 - x1;
      const colorIdx = idx % BLOCK_PALETTE.length;

      // Fill
      ctx.fillStyle = BLOCK_PALETTE[colorIdx];
      ctx.fillRect(x1, 0, blockW, h);

      // Border
      const isSelected = idx === selectedIdx;
      ctx.strokeStyle = isSelected
        ? SELECTED_BORDER_PALETTE[colorIdx]
        : BLOCK_BORDER_PALETTE[colorIdx];
      ctx.lineWidth = isSelected ? 2 : 1;
      ctx.strokeRect(x1 + 0.5, 0.5, blockW - 1, h - 1);

      // Label
      if (blockW > 20) {
        ctx.font = FONT;
        ctx.fillStyle = "rgba(255, 255, 255, 0.55)";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";

        const label = seg.name || `#${idx}`;
        const maxChars = Math.floor(blockW / 6);
        const truncated = label.length > maxChars ? label.slice(0, maxChars - 1) + "\u2026" : label;
        ctx.fillText(truncated, x1 + blockW / 2, h / 2);
      }
    });

    // Playhead
    const px = timeToX(currentTime, w);
    ctx.beginPath();
    ctx.moveTo(px, 0);
    ctx.lineTo(px, h);
    ctx.strokeStyle = PLAYHEAD_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Triangle handle at top
    ctx.beginPath();
    ctx.moveTo(px - 5, 0);
    ctx.lineTo(px + 5, 0);
    ctx.lineTo(px, 7);
    ctx.closePath();
    ctx.fillStyle = PLAYHEAD_COLOR;
    ctx.fill();
  }, [audioBuffer, segments, currentTime, selectedIdx, timeToX]);

  // Draw on prop changes
  useEffect(() => {
    draw();
  }, [draw]);

  // Resize observer
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      peaksCache.current = null;
      draw();
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, [draw]);

  // Mouse interaction
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const getTimeFromEvent = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      return xToTime(x, rect.width);
    };

    const handleMouseDown = (e: MouseEvent) => {
      const time = getTimeFromEvent(e);

      isDragging.current = true;
      onScrub(time);

      // Check if click is inside a segment block
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      for (let i = 0; i < segments.length; i++) {
        const x1 = timeToX(segments[i].startTime, rect.width);
        const x2 = timeToX(segments[i].endTime, rect.width);
        if (x >= x1 && x <= x2) {
          onSelectSegment(i);
          break;
        }
      }
    };

    const handleDoubleClick = (e: MouseEvent) => {
      if (noteEntryMode && onAddNoteAtTime) {
        const time = getTimeFromEvent(e);
        onAddNoteAtTime(time);
      }
    };

    const handleMouseMove = (e: MouseEvent) => {
      if (!isDragging.current) return;
      cancelAnimationFrame(rafId.current);
      rafId.current = requestAnimationFrame(() => {
        const time = getTimeFromEvent(e);
        onScrub(time);
      });
    };

    const handleMouseUp = () => {
      isDragging.current = false;
      cancelAnimationFrame(rafId.current);
    };

    canvas.addEventListener("mousedown", handleMouseDown);
    canvas.addEventListener("dblclick", handleDoubleClick);
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);

    return () => {
      canvas.removeEventListener("mousedown", handleMouseDown);
      canvas.removeEventListener("dblclick", handleDoubleClick);
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
      cancelAnimationFrame(rafId.current);
    };
  }, [segments, totalDuration, onScrub, onSelectSegment, xToTime, timeToX, noteEntryMode, onAddNoteAtTime]);

  return (
    <div ref={containerRef} className={`waveform-container${noteEntryMode ? " note-entry" : ""}`}>
      <canvas
        ref={canvasRef}
        className="waveform-canvas"
      />
    </div>
  );
}
