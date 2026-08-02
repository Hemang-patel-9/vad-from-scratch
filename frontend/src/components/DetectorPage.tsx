"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { ArrowLeft, CircleAlert, Mic, Waves } from "lucide-react";

import { LiveMicrophonePanel } from "@/components/LiveMicrophonePanel";
import { ParameterPanel } from "@/components/ParameterPanel";
import { RecordingExplorer } from "@/components/RecordingExplorer";
import { fetchSamples } from "@/lib/api";
import { DEFAULTS, type Detector } from "@/lib/detectors";
import type { Parameters, SampleSummary } from "@/lib/types";

type Source = "sample" | "microphone";

export function DetectorPage({ detector }: { detector: Detector }) {
  const defaults = DEFAULTS[detector.slug];

  const [samples, setSamples] = useState<SampleSummary[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [source, setSource] = useState<Source>("sample");
  const [parameters, setParameters] = useState<Parameters>(defaults);

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

  const updateParameters = useCallback((next: Parameters) => setParameters(next), []);

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
          {detector.eyebrow}
        </div>
        <h1 className="mt-4 text-2xl font-semibold tracking-tight sm:text-3xl">{detector.title}</h1>
        <p className="mt-3 max-w-3xl text-sm leading-relaxed text-muted">{detector.blurb}</p>
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
            <RecordingExplorer slug={detector.slug} samples={samples} parameters={parameters} />
          ))}

        {source === "microphone" && (
          <LiveMicrophonePanel detector={detector} parameters={parameters} />
        )}

        <ParameterPanel
          groups={detector.groups}
          parameters={parameters}
          defaults={defaults}
          onChange={updateParameters}
        />

        <section className="rounded-lg border border-line bg-surface p-4">
          <h2 className="text-sm font-medium">What the stages mean</h2>
          <dl className="mt-3 space-y-3 text-sm">
            {detector.notes.map((note) => (
              <Explanation key={note.term} term={note.term}>
                {note.body(parameters)}
              </Explanation>
            ))}
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
