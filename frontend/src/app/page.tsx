"use client";

import { useCallback, useEffect, useState } from "react";
import { MotionConfig, motion, type Variants } from "framer-motion";
import {
  CircleAlert,
  CircleCheck,
  FileText,
  RefreshCw,
  ServerCog,
  Waves,
} from "lucide-react";

type Health = { status: string; service: string; version: string };

type Probe =
  | { phase: "loading" }
  | { phase: "ok"; data: Health; latency: number }
  | { phase: "error"; message: string };

const DOCS = [
  { name: "Rule-based", path: "docs/rule-based.md" },
  { name: "DL-based", path: "docs/dl-based.md" },
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
      <main className="flex flex-1 items-center justify-center px-6 py-16">
        <motion.div
          variants={container}
          initial="hidden"
          animate="show"
          className="w-full max-w-xl"
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
              Docs
            </h2>
            <ul className="mt-3 divide-y divide-line border-y border-line">
              {DOCS.map((doc) => (
                <li
                  key={doc.path}
                  className="flex items-center justify-between py-2.5 text-sm"
                >
                  <span className="flex items-center gap-2">
                    <FileText className="size-3.5 text-muted" aria-hidden />
                    {doc.name}
                  </span>
                  <code className="font-mono text-xs text-muted">{doc.path}</code>
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
