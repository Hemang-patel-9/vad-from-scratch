"use client";

import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, MotionConfig, motion, type Variants } from "framer-motion";
import { CircleAlert, Loader2, Mic, Waves } from "lucide-react";

import { LiveMicrophonePanel } from "@/components/LiveMicrophonePanel";
import { ParameterPanel } from "@/components/ParameterPanel";
import { RecordingExplorer } from "@/components/RecordingExplorer";
import { fetchSamples } from "@/lib/api";
import { DEFAULTS, type Detector } from "@/lib/detectors";
import type { Parameters, SampleSummary } from "@/lib/types";

type Source = "sample" | "microphone";

const stack: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.06, delayChildren: 0.03 } },
};

const rise: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.42, ease: [0.22, 1, 0.36, 1] } },
};

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
    <MotionConfig reducedMotion="user">
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8 sm:px-6 lg:px-8 lg:py-12">
        <motion.header variants={stack} initial="hidden" animate="show">
          <motion.div
            variants={rise}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted"
          >
            <Waves className="size-3.5" aria-hidden />
            {detector.eyebrow}
          </motion.div>
          <motion.h1
            variants={rise}
            className="mt-4 text-2xl font-semibold tracking-tight text-balance sm:text-3xl"
          >
            {detector.title}
          </motion.h1>
          <motion.p
            variants={rise}
            className="mt-3 max-w-3xl text-sm leading-relaxed text-pretty text-muted"
          >
            {detector.blurb}
          </motion.p>
        </motion.header>

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
          <AnimatePresence>
            {loadError && (
              <motion.p
                initial={{ opacity: 0, y: -6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                className="flex items-center gap-2 rounded-lg border border-line bg-surface px-3 py-2 font-mono text-xs text-down"
              >
                <CircleAlert className="size-3.5 shrink-0" aria-hidden />
                {loadError} — is the backend running?
              </motion.p>
            )}
          </AnimatePresence>

          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={source}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
            >
              {source === "sample" ? (
                samples === null ? (
                  <p className="flex items-center gap-2 font-mono text-xs text-muted">
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                    Loading samples…
                  </p>
                ) : samples.length === 0 ? (
                  <p className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-muted">
                    No audio found in <code className="font-mono">samples/</code>.
                  </p>
                ) : (
                  <RecordingExplorer
                    slug={detector.slug}
                    samples={samples}
                    parameters={parameters}
                  />
                )
              ) : (
                <LiveMicrophonePanel detector={detector} parameters={parameters} />
              )}
            </motion.div>
          </AnimatePresence>

          <ParameterPanel
            groups={detector.groups}
            parameters={parameters}
            defaults={defaults}
            onChange={updateParameters}
          />

          <section className="rounded-lg border border-line bg-surface p-4 sm:p-5">
            <h2 className="text-sm font-medium">What the stages mean</h2>
            <dl className="mt-4 space-y-3 text-sm">
              {detector.notes.map((note) => (
                <Explanation key={note.term} term={note.term}>
                  {note.body(parameters)}
                </Explanation>
              ))}
            </dl>
          </section>
        </div>
      </main>
    </MotionConfig>
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
      className={`relative -mb-px flex items-center gap-1.5 px-3 py-2 font-mono text-xs transition-colors ${
        active ? "text-foreground" : "text-muted hover:text-foreground"
      }`}
    >
      {children}
      {active && (
        <motion.span
          layoutId="source-underline"
          transition={{ type: "spring", stiffness: 400, damping: 34 }}
          className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-foreground"
        />
      )}
    </button>
  );
}

function Explanation({ term, children }: { term: string; children: ReactNode }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[140px_1fr] sm:gap-4">
      <dt className="font-mono text-xs uppercase tracking-[0.14em] text-muted">{term}</dt>
      <dd className="leading-relaxed text-pretty text-muted">{children}</dd>
    </div>
  );
}
