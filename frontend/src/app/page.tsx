"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, MotionConfig, motion, type Variants } from "framer-motion";
import {
  ArrowRight,
  CircleAlert,
  CircleCheck,
  RefreshCw,
  ServerCog,
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
  },
  {
    name: "Zero-crossing rate",
    family: "Rule-based",
    summary: "Counts sign changes to separate voiced speech from broadband noise.",
    href: "/zero-crossing",
  },
  {
    name: "Spectral",
    family: "Rule-based",
    summary: "Flatness and entropy of the spectrum rather than raw loudness.",
    href: "/spectral",
  },
  {
    name: "Neural",
    family: "DL-based",
    summary: "A causal convolutional network with a GRU, trained on synthesised scenes.",
    href: "/dl-based",
  },
];

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.07, delayChildren: 0.04 } },
};

const item: Variants = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: 0.45, ease: [0.22, 1, 0.36, 1] } },
};

export default function Home() {
  const [probe, setProbe] = useState<Probe>({ phase: "loading" });

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
    // A static export has no server render, so the first probe has to happen
    // here. State only settles after the await, so the mount stays render-safe.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void runProbe();
  }, [runProbe]);

  const recheck = useCallback(() => {
    setProbe({ phase: "loading" });
    void runProbe();
  }, [runProbe]);

  return (
    <MotionConfig reducedMotion="user">
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-12 sm:px-6 sm:py-16">
        <motion.div variants={container} initial="hidden" animate="show">
          <motion.h1
            variants={item}
            className="text-3xl font-semibold tracking-tight text-balance sm:text-4xl"
          >
            Voice activity detection, built from scratch.
          </motion.h1>

          <motion.p variants={item} className="mt-3 text-sm text-muted sm:text-base">
            Four detectors, one pipeline. Next.js and FastAPI, served together on one port.
          </motion.p>

          <motion.section
            variants={item}
            aria-labelledby="backend-heading"
            className="mt-10 overflow-hidden rounded-xl border border-line bg-surface"
          >
            <header className="flex items-center justify-between border-b border-line px-4 py-3">
              <h2 id="backend-heading" className="flex items-center gap-2 text-sm font-medium">
                <ServerCog className="size-4 text-muted" aria-hidden />
                Backend
              </h2>
              <StatusPill probe={probe} />
            </header>

            <dl className="grid grid-cols-2 gap-px bg-line sm:grid-cols-4">
              <Field label="Status" value={probe.phase === "ok" ? probe.data.status : "—"} />
              <Field label="Service" value={probe.phase === "ok" ? probe.data.service : "—"} />
              <Field label="Version" value={probe.phase === "ok" ? probe.data.version : "—"} />
              <Field
                label="Latency"
                value={probe.phase === "ok" ? `${probe.latency} ms` : "—"}
              />
            </dl>

            <footer className="flex items-center justify-between gap-3 border-t border-line px-4 py-3">
              <code className="truncate font-mono text-xs text-muted">GET /api/health</code>
              <motion.button
                type="button"
                onClick={recheck}
                disabled={probe.phase === "loading"}
                whileTap={{ scale: 0.96 }}
                className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:bg-background hover:text-foreground disabled:opacity-50"
              >
                <RefreshCw
                  className={`size-3.5 ${probe.phase === "loading" ? "animate-spin" : ""}`}
                  aria-hidden
                />
                Recheck
              </motion.button>
            </footer>
          </motion.section>

          <AnimatePresence>
            {probe.phase === "error" && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 font-mono text-xs text-down"
              >
                {probe.message} — is the backend running?
              </motion.p>
            )}
          </AnimatePresence>

          <motion.section variants={item} className="mt-12">
            <h2 className="font-mono text-xs uppercase tracking-[0.18em] text-muted">
              Approaches
            </h2>
            <ul className="mt-4 grid gap-3 sm:grid-cols-2">
              {APPROACHES.map((approach) => (
                <motion.li
                  key={approach.name}
                  whileHover={{ y: -2 }}
                  transition={{ type: "spring", stiffness: 400, damping: 28 }}
                >
                  <Link
                    href={approach.href}
                    className="group flex h-full flex-col rounded-xl border border-line bg-surface p-4 transition-colors hover:border-muted/50"
                  >
                    <span className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">{approach.name}</span>
                      <ArrowRight
                        className="size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-foreground"
                        aria-hidden
                      />
                    </span>
                    <span className="mt-2 block text-xs leading-relaxed text-pretty text-muted">
                      {approach.summary}
                    </span>
                    <span className="mt-3 w-fit rounded-sm border border-line px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-muted">
                      {approach.family}
                    </span>
                  </Link>
                </motion.li>
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
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-1 truncate font-mono text-sm">{value}</dd>
    </div>
  );
}

function StatusPill({ probe }: { probe: Probe }) {
  if (probe.phase === "loading") {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs text-muted">
        <motion.span
          animate={{ opacity: [1, 0.3, 1] }}
          transition={{ duration: 1.3, repeat: Infinity, ease: "easeInOut" }}
          className="size-1.5 rounded-full bg-muted"
        />
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
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      className="flex items-center gap-1.5 font-mono text-xs text-ok"
    >
      <CircleCheck className="size-3.5" aria-hidden />
      Healthy
    </motion.span>
  );
}
