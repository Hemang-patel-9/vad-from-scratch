"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { MotionConfig, motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  RefreshCw,
  ServerCog,
  Waves,
} from "lucide-react";

type Health = { status: string; service: string; version: string };

type Probe =
  | { phase: "loading" }
  | { phase: "ok"; data: Health; latency: number }
  | { phase: "error"; message: string };

const APPROACHES = [
  {
    name: "Energy-based",
    family: "Rule-based",
    summary: "Frame energy against an adaptive noise floor, with hysteresis and hangover.",
    href: "/energy-based",
    docs: "docs/rule-based/energy-based.md",
  },
  {
    name: "Zero-crossing rate",
    family: "Rule-based",
    summary: "Counts sign changes to separate voiced speech from broadband noise.",
    href: "/zero-crossing",
    docs: "docs/rule-based/zero-crossing.md",
  },
  {
    name: "Spectral",
    family: "Rule-based",
    summary: "Flatness and entropy of the spectrum rather than raw loudness.",
    href: "/spectral",
    docs: "docs/rule-based/spectral.md",
  },
  {
    name: "Neural",
    family: "DL-based",
    summary: "A causal convolutional network with a GRU, trained on synthesised scenes.",
    href: "/dl-based",
    docs: "docs/dl-based/README.md",
  },
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 8 },
  show: { opacity: 1, y: 0, transition: { duration: 0.4, ease: "easeOut" } },
};

export default function Home() {
  const [probe, setProbe] = useState<Probe>({ phase: "loading" });

  // State is only set after the await, so the mount effect stays render-safe.
  const runProbe = useCallback(async () => {
    const started = performance.now();
    try {
      const res = await fetch("/api/health", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data: Health = await res.json();
      setProbe({
        phase: "ok",
        data,
        latency: Math.round(performance.now() - started),
      });
    } catch (err) {
      setProbe({
        phase: "error",
        message: err instanceof Error ? err.message : "Unreachable",
      });
    }
  }, []);

  useEffect(() => {
    // One-shot probe on mount. A static export has no server render, so the
    // first fetch has to happen here; state settles after the await.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runProbe();
  }, [runProbe]);

  const recheck = useCallback(() => {
    setProbe({ phase: "loading" });
    void runProbe();
  }, [runProbe]);

  return (
    <MotionConfig reducedMotion="user">
      <main className="flex flex-1 items-center justify-center px-4 py-12 sm:px-6 sm:py-16">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="w-full max-w-2xl"
        >
          <motion.div
            variants={item}
            className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-muted"
          >
            <Waves className="size-3.5" aria-hidden />
            VAD from scratch
          </motion.div>

          <motion.h1
            variants={item}
            className="mt-5 text-2xl font-semibold tracking-tight sm:text-3xl"
          >
            Voice activity detection, built from scratch.
          </motion.h1>

          <motion.p variants={item} className="mt-2 text-sm text-muted">
            Next.js and FastAPI, served together on one port.
          </motion.p>

          <motion.section
            variants={item}
            aria-labelledby="backend-heading"
            className="mt-10 rounded-lg border border-line bg-surface"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2
                id="backend-heading"
                className="flex items-center gap-2 text-sm font-medium"
              >
                <ServerCog className="size-4 text-muted" aria-hidden />
                Backend
              </h2>
              <StatusPill probe={probe} />
            </header>

            <dl className="grid grid-cols-2 gap-px bg-line">
              <Field label="Status" value={probe.phase === "ok" ? probe.data.status : "—"} />
              <Field label="Service" value={probe.phase === "ok" ? probe.data.service : "—"} />
              <Field label="Version" value={probe.phase === "ok" ? probe.data.version : "—"} />
              <Field
                label="Latency"
                value={probe.phase === "ok" ? `${probe.latency} ms` : "—"}
              />
            </dl>

            <footer className="flex items-center justify-between border-t border-line px-4 py-3">
              <code className="font-mono text-xs text-muted">GET /api/health</code>
              <button
                type="button"
                onClick={recheck}
                disabled={probe.phase === "loading"}
                className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-50"
              >
                <RefreshCw
                  className={`size-3.5 ${probe.phase === "loading" ? "animate-spin" : ""}`}
                  aria-hidden
                />
                Recheck
              </button>
            </footer>
          </motion.section>

          {probe.phase === "error" && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="mt-3 font-mono text-xs text-down"
            >
              {probe.message} — is the backend running?
            </motion.p>
          )}

          <motion.section variants={item} className="mt-10">
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
              Approaches
            </h2>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {APPROACHES.map((approach) => (
                <li key={approach.name}>
                  {approach.href ? (
                    <Link
                      href={approach.href}
                      className="group flex items-center justify-between gap-4 py-3 transition-colors hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
                    >
                      <span>
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {approach.name}
                          <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                            {approach.family}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs text-muted">{approach.summary}</span>
                      </span>
                      <ArrowRight
                        className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                        aria-hidden
                      />
                    </Link>
                  ) : (
                    <div className="flex items-center justify-between gap-4 py-3 opacity-55">
                      <span>
                        <span className="flex items-center gap-2 text-sm font-medium">
                          {approach.name}
                          <span className="rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                            {approach.family}
                          </span>
                        </span>
                        <span className="mt-1 block text-xs text-muted">{approach.summary}</span>
                      </span>
                      <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                        Planned
                      </span>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </motion.section>
        </motion.div>
      </main>
    </MotionConfig>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
        {label}
      </dt>
      <dd className="mt-1 font-mono text-sm">{value}</dd>
    </div>
  );
}

function StatusPill({ probe }: { probe: Probe }) {
  if (probe.phase === "loading") {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
        <span className="size-1.5 rounded-full bg-muted" />
        Checking
      </span>
    );
  }

  if (probe.phase === "error") {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs text-down">
        <CircleAlert className="size-3.5" aria-hidden />
        Unreachable
      </span>
    );
  }

  return (
    <span className="flex items-center gap-1.5 font-mono text-xs text-ok">
      <CircleCheck className="size-3.5" aria-hidden />
      Healthy
    </span>
  );
}
