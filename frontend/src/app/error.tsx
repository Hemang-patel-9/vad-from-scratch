"use client";

import { useEffect } from "react";
import { CircleAlert, RefreshCw } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Unhandled UI error:", error);
  }, [error]);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <div className="flex items-center gap-2 font-mono text-xs uppercase tracking-[0.18em] text-down">
        <CircleAlert className="size-3.5" aria-hidden />
        Something broke
      </div>

      <h1 className="mt-4 text-xl font-semibold tracking-tight">
        The page hit an error instead of rendering.
      </h1>
      <p className="mt-2 text-sm text-muted">
        The message below is the actual failure — it is far more useful than a blank page.
      </p>

      <pre className="mt-5 overflow-x-auto rounded-lg border border-line bg-surface p-4 font-mono text-xs text-down">
        {error.message || "No message"}
        {error.digest ? `\n\ndigest: ${error.digest}` : ""}
      </pre>

      <div className="mt-5 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={reset}
          className="flex items-center gap-1.5 rounded-md border border-line px-3 py-1.5 font-mono text-xs transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          <RefreshCw className="size-3.5" aria-hidden />
          Try again
        </button>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="rounded-md border border-line px-3 py-1.5 font-mono text-xs text-muted transition-colors hover:bg-surface hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
        >
          Hard reload
        </button>
      </div>
    </main>
  );
}
