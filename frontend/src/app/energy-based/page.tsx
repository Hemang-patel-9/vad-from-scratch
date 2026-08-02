"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, CircleAlert, Mic, Waves } from "lucide-react";

import { LiveMicrophonePanel } from "@/components/LiveMicrophonePanel";
import { ParameterPanel } from "@/components/ParameterPanel";
import { RecordingExplorer } from "@/components/RecordingExplorer";
import { fetchSamples } from "@/lib/api";
import { DEFAULT_PARAMETERS, type SampleSummary, type VadParameters } from "@/lib/types";

type Source = "sample" | "microphone";

export default function EnergyBasedPage() {
  const [samples, setSamples] = useState<SampleSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("sample");
  const [parameters, setParameters] = useState<VadParameters>(DEFAULT_PARAMETERS);

  useEffect(() => {
    const controller = new AbortController();
    fetchSamples(controller.signal)
      .then(setSamples)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setLoadError(cause instanceof Error ? cause.message : "Could not reach the backend");
      });
    return () => controller.abort();
  }, []);

  const updateParameters = useCallback((next: VadParameters) => setParameters(next), []);

  return (
    <main className="w-full flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
      <Link
        href="/"
        className="inline-flex items-center gap-1.5 font-mono text-xs text-muted transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Back
      </Link>

      <header className="mt-6">
        <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted">
          <Waves className="size-3.5" aria-hidden />
          Rule-based · 01
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">Energy-based VAD</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">
          Slice the signal into short frames, measure how loud each one is, and call a frame speech
          when it rises far enough above the noise floor. Everything after that threshold exists to
          keep the decision from flickering. Move a slider and watch which stage reacts.
        </p>
      </header>

      <nav className="mt-8 flex gap-1 border-b border-line" aria-label="Audio source">
        <SourceTab active={source === "sample"} onClick={() => setSource("sample")}>
          <Waves className="size-3.5" aria-hidden />
          Sample
        </SourceTab>
        <SourceTab active={source === "microphone"} onClick={() => setSource("microphone")}>
          <Mic className="size-3.5" aria-hidden />
          Microphone
        </SourceTab>
      </nav>

      <div className="mt-6 space-y-6">
        {loadError && (
          <p className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-down">
            <CircleAlert className="size-3.5" aria-hidden />
            {loadError} — is the backend running?
          </p>
        )}

        {source === "sample" &&
          (samples === null ? (
            <p className="font-mono text-xs text-muted">Loading samples…</p>
          ) : samples.length === 0 ? (
            <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
              No audio found in <code className="font-mono">samples/</code>.
            </p>
          ) : (
            <RecordingExplorer samples={samples} parameters={parameters} />
          ))}

        {source === "microphone" && <LiveMicrophonePanel parameters={parameters} />}

        <ParameterPanel parameters={parameters} onChange={updateParameters} />

        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">What the stages mean</h2>
          <dl className="mt-3 space-y-3 text-sm">
            <Explanation term="Threshold">
              The noise floor is the {parameters.noise_percentile}th percentile of frame energy,
              {parameters.noise_window_s > 0
                ? ` re-estimated every ${parameters.noise_window_s} s so a drifting room is tracked`
                : " taken once across the whole file"}
              . A frame turns on above the enter line and only turns off once it falls below the
              exit line — the gap between them stops a frame hovering at the boundary from
              chattering.
            </Explanation>
            <Explanation term="Hangover">
              A frame only crosses the threshold once speech is well underway, so each segment is
              extended {parameters.pre_speech_ms} ms backwards. Speech also ends quietly, so the
              decision is held on for {parameters.hangover_ms} ms after energy drops — enough for a
              trailing <span className="font-mono">/s/</span> without swallowing the pause.
            </Explanation>
            <Explanation term="Duration filter">
              Gaps shorter than {parameters.min_silence_ms} ms are closed up, then anything left
              shorter than {parameters.min_speech_ms} ms is discarded as a click or a knock.
            </Explanation>
          </dl>
        </section>
      </div>
    </main>
  );
}

function SourceTab({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? "page" : undefined}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 font-mono text-xs transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground ${
        active
          ? "border-foreground text-foreground"
          : "border-transparent text-muted hover:text-foreground"
      }`}
    >
      {children}
    </button>
  );
}

function Explanation({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[130px_1fr] sm:gap-4">
      <dt className="font-mono text-xs uppercase tracking-[0.14em] text-muted">{term}</dt>
      <dd className="leading-relaxed text-muted">{children}</dd>
    </div>
  );
}
