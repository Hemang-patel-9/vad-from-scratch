"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from "react";
import { CircleAlert, Loader2, Pause, Play } from "lucide-react";

import { PaintedCanvas, renderOnto, useThemeTokens, type Painter } from "@/components/canvas";
import { analyseSample, sampleAudioUrl } from "@/lib/api";
import {
  drawDecibelGrid,
  drawEnergyCurve,
  drawPlayhead,
  drawSampledCurve,
  drawTimeAxis,
  drawWaveform,
  fillSegments,
  plotGutter,
  type DecibelRange,
} from "@/lib/draw";
import type {
  EnergyVadAnalysis,
  SampleSummary,
  TimeSegment,
  VadParameters,
  WaveformEnvelope,
} from "@/lib/types";

const DEBOUNCE_MS = 160;
const ARROW_SEEK_SECONDS = 1;

export function RecordingExplorer({
  samples,
  parameters,
}: {
  samples: SampleSummary[];
  parameters: VadParameters;
}) {
  const tokens = useThemeTokens();
  const audioRef = useRef<HTMLAudioElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const waveformCache = useRef(new Map<string, WaveformEnvelope>());

  const [selected, setSelected] = useState(samples[0]?.name ?? "");
  const [analysis, setAnalysis] = useState<EnergyVadAnalysis | null>(null);
  const [waveform, setWaveform] = useState<WaveformEnvelope | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isRecomputing, setIsRecomputing] = useState(true);
  const [isPlaying, setIsPlaying] = useState(false);
  const [seekTick, setSeekTick] = useState(0);

  useEffect(() => {
    if (!selected) return;
    const controller = new AbortController();
    const cache = waveformCache.current;

    // Debounced so dragging a slider issues one request, not one per pixel. The
    // envelope only depends on the sample, so it is fetched once and reused.
    const timer = window.setTimeout(() => {
      setIsRecomputing(true);
      analyseSample(selected, parameters, !cache.has(selected), controller.signal)
        .then((result) => {
          if (result.waveform) cache.set(selected, result.waveform);
          setWaveform(cache.get(selected) ?? null);
          setAnalysis(result);
          setError(null);
          setIsRecomputing(false);
        })
        .catch((cause: unknown) => {
          if (controller.signal.aborted) return;
          setError(cause instanceof Error ? cause.message : "Analysis failed");
          setIsRecomputing(false);
        });
    }, DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [selected, parameters]);

  const range: DecibelRange = useMemo(() => {
    if (!analysis) return { top: 0, bottom: -80 };
    let loudest = -Infinity;
    for (const value of analysis.energy_db) if (value > loudest) loudest = value;
    let quietestFloor = Infinity;
    for (const value of analysis.noise_floor_curve_db) if (value < quietestFloor) quietestFloor = value;
    const bottom = Math.min(quietestFloor, analysis.exit_threshold_db) - 12;
    return {
      top: Math.min(6, Math.ceil((loudest + 4) / 5) * 5),
      bottom: Math.max(analysis.silence_floor_db - 2, Math.floor(bottom / 5) * 5),
    };
  }, [analysis]);

  const paintWaveform = useMemo<Painter>(
    () =>
      insidePlotArea((context, width, height) => {
        if (!tokens) return;
        if (analysis) {
          fillSegments(context, width, height, analysis.segments, analysis.duration, tokens["--speech-wash"]);
        }
        if (waveform) {
          drawWaveform(context, width, height, waveform.low, waveform.high, tokens["--wave"]);
        }
      }),
    [analysis, waveform, tokens],
  );

  const paintEnergy = useMemo<Painter>(
    () =>
      insidePlotArea((context, width, height, gutter) => {
        if (!analysis || !tokens) return;
        fillSegments(context, width, height, analysis.segments, analysis.duration, tokens["--speech-wash"]);
        drawDecibelGrid(context, width, height, range, tokens["--grid"], tokens["--muted"], 4 - gutter);
        drawEnergyCurve(
          context,
          width,
          height,
          analysis.energy_db,
          analysis.hop_seconds,
          analysis.frame_seconds,
          analysis.duration,
          range,
          tokens["--energy"],
        );

        const floor = analysis.noise_floor_curve_db;
        const enterOffset = analysis.threshold_offset_db;
        drawSampledCurve(context, width, height, floor, range, tokens["--muted"], 1, [2, 3]);
        drawSampledCurve(context, width, height, floor, range, tokens["--speech"], 1, [4, 4], enterOffset - analysis.hysteresis_db);
        drawSampledCurve(context, width, height, floor, range, tokens["--speech"], 1.5, [], enterOffset);
      }),
    [analysis, tokens, range],
  );

  const paintAxis = useMemo<Painter>(
    () =>
      insidePlotArea((context, width, height) => {
        if (!analysis || !tokens) return;
        drawTimeAxis(context, width, height, analysis.duration, tokens["--line"], tokens["--muted"]);
      }),
    [analysis, tokens],
  );

  const paintPlayhead = useMemo<Painter>(
    () =>
      insidePlotArea((context, width, height) => {
        if (!analysis || !tokens) return;
        drawPlayhead(context, width, height, audioRef.current?.currentTime ?? 0, analysis.duration, tokens["--foreground"]);
      }),
    [analysis, tokens],
  );

  useEffect(() => {
    const canvas = overlayRef.current;
    if (!canvas) return;

    renderOnto(canvas, paintPlayhead);
    if (!isPlaying) return;
    let handle = requestAnimationFrame(function step() {
      renderOnto(canvas, paintPlayhead);
      handle = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(handle);
  }, [paintPlayhead, isPlaying, seekTick]);

  const seekTo = useCallback(
    (time: number) => {
      const audio = audioRef.current;
      if (!audio || !analysis) return;
      audio.currentTime = Math.min(analysis.duration, Math.max(0, time));
      setSeekTick((tick) => tick + 1);
    },
    [analysis],
  );

  const seekFromPointer = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>) => {
      // The overlay spans exactly the plot area, so it is the honest ruler here.
      const canvas = overlayRef.current;
      if (!canvas || !analysis) return;
      const bounds = canvas.getBoundingClientRect();
      const gutter = plotGutter(bounds.width);
      const plotWidth = Math.max(1, bounds.width - gutter);
      const position = (event.clientX - bounds.left - gutter) / plotWidth;
      seekTo(position * analysis.duration);
    },
    [analysis, seekTo],
  );

  const seekFromKeyboard = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const audio = audioRef.current;
      if (!audio) return;
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        seekTo(audio.currentTime - ARROW_SEEK_SECONDS);
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        seekTo(audio.currentTime + ARROW_SEEK_SECONDS);
      }
    },
    [seekTo],
  );

  const togglePlayback = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    if (audio.paused) {
      // A rejected play() must not become an unhandled rejection.
      audio.play().catch((cause: unknown) => {
        setError(cause instanceof Error ? `Playback blocked: ${cause.message}` : "Playback blocked");
      });
    } else {
      audio.pause();
    }
  }, []);

  const changeSample = useCallback((name: string) => {
    audioRef.current?.pause();
    setSelected(name);
  }, []);

  const activeSample = samples.find((sample) => sample.name === selected);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label htmlFor="sample" className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
          Sample
        </label>
        <select
          id="sample"
          value={selected}
          onChange={(event) => changeSample(event.target.value)}
          className="rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-xs focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          {samples.map((sample) => (
            <option key={sample.name} value={sample.name}>
              {sample.name}
            </option>
          ))}
        </select>

        <button
          type="button"
          onClick={togglePlayback}
          disabled={!analysis}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-40"
        >
          {isPlaying ? <Pause className="size-3.5" aria-hidden /> : <Play className="size-3.5" aria-hidden />}
          {isPlaying ? "Pause" : "Play"}
        </button>

        {activeSample && (
          <span className="hidden font-mono text-xs text-muted sm:inline">
            {activeSample.source_sample_rate.toLocaleString()} Hz ·{" "}
            {activeSample.channels === 1 ? "mono" : "stereo"} → 16 kHz mono
          </span>
        )}

        {isRecomputing && (
          <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
            Recomputing
          </span>
        )}
      </div>

      <audio
        ref={audioRef}
        src={selected ? sampleAudioUrl(selected) : undefined}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onEnded={() => setIsPlaying(false)}
        preload="metadata"
        className="hidden"
      />

      {error && (
        <p className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-down">
          <CircleAlert className="size-3.5" aria-hidden />
          {error}
        </p>
      )}

      <div className="rounded-lg border border-line bg-surface p-2 sm:p-3">
        <div
          role="button"
          tabIndex={0}
          aria-label="Analysis plots. Click to seek, arrow keys to step through the recording."
          onClick={seekFromPointer}
          onKeyDown={seekFromKeyboard}
          className="relative cursor-crosshair touch-manipulation rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          <PlotRow label="Waveform" hint="speech regions shaded">
            <PaintedCanvas
              paint={paintWaveform}
              label="Waveform with detected speech shaded"
              className="h-20 w-full sm:h-24"
            />
          </PlotRow>

          <PlotRow label="Frame energy (dB)" hint="solid = enter · dashed = exit · dotted = noise floor">
            <PaintedCanvas
              paint={paintEnergy}
              label="Frame energy in decibels with thresholds"
              className="h-32 w-full sm:h-44"
            />
          </PlotRow>

          {analysis?.stages.map((stage) => (
            <PlotRow key={stage.key} label={stage.label} hint={stage.description}>
              <StageStrip
                segments={stage.segments}
                duration={analysis.duration}
                label={`${stage.label}: ${stage.description}`}
              />
            </PlotRow>
          ))}

          <canvas
            ref={overlayRef}
            aria-hidden
            className="pointer-events-none absolute inset-0 h-full w-full"
          />
        </div>

        <PaintedCanvas paint={paintAxis} label="Time axis" className="h-6 w-full" />
      </div>

      {analysis && (
        <>
          <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
            <Statistic label="Segments" value={`${analysis.segments.length}`} />
            <Statistic label="Speech" value={`${Math.round(analysis.speech_ratio * 100)}%`} />
            <Statistic label="Noise floor" value={`${analysis.noise_floor_db.toFixed(1)} dB`} />
            <Statistic label="Detector" value={`${analysis.elapsed_ms.toFixed(1)} ms`} />
          </dl>

          <SegmentTable segments={analysis.segments} onSeek={seekTo} />
        </>
      )}
    </div>
  );
}

function insidePlotArea(
  drawInside: (
    context: CanvasRenderingContext2D,
    width: number,
    height: number,
    gutter: number,
  ) => void,
): Painter {
  return (context, width, height) => {
    const gutter = plotGutter(width);
    context.save();
    context.translate(gutter, 0);
    drawInside(context, Math.max(1, width - gutter), height, gutter);
    context.restore();
  };
}

function PlotRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <div className="mb-3">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 pl-[26px] sm:pl-[38px]">
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</span>
        <span className="hidden text-[10px] text-muted sm:inline">{hint}</span>
      </div>
      {children}
    </div>
  );
}

function StageStrip({
  segments,
  duration,
  label,
}: {
  segments: TimeSegment[];
  duration: number;
  label: string;
}) {
  const tokens = useThemeTokens();

  const paint = useMemo<Painter>(
    () =>
      insidePlotArea((context, width, height) => {
        if (!tokens) return;
        context.fillStyle = tokens["--grid"];
        context.fillRect(0, 0, width, height);
        fillSegments(context, width, height, segments, duration, tokens["--speech"]);
      }),
    [segments, duration, tokens],
  );

  return <PaintedCanvas paint={paint} label={label} className="h-4 w-full" />;
}

function Statistic({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-3 py-2.5 sm:px-4 sm:py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}

function SegmentTable({
  segments,
  onSeek,
}: {
  segments: TimeSegment[];
  onSeek: (time: number) => void;
}) {
  if (segments.length === 0) {
    return (
      <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
        No speech survived the current settings. Lower the threshold offset or shorten the minimum
        speech duration.
      </p>
    );
  }

  return (
    <div className="max-h-72 overflow-auto rounded-lg border border-line">
      <table className="w-full text-left font-mono text-xs">
        <thead className="sticky top-0 bg-surface text-muted">
          <tr>
            <th scope="col" className="px-4 py-2 font-normal">#</th>
            <th scope="col" className="px-4 py-2 font-normal">Start</th>
            <th scope="col" className="px-4 py-2 font-normal">End</th>
            <th scope="col" className="px-4 py-2 font-normal">Duration</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {segments.map((segment, index) => (
            <tr key={`${segment.start}-${segment.end}`} className="tabular-nums">
              <td className="px-4 py-2 text-muted">{index + 1}</td>
              <td className="px-4 py-2">
                <button
                  type="button"
                  onClick={() => onSeek(segment.start)}
                  className="underline decoration-line underline-offset-4 transition-colors hover:decoration-foreground"
                >
                  {segment.start.toFixed(2)}s
                </button>
              </td>
              <td className="px-4 py-2">{segment.end.toFixed(2)}s</td>
              <td className="px-4 py-2 text-muted">{(segment.end - segment.start).toFixed(2)}s</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
