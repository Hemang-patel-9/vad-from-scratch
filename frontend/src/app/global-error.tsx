"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "ui-monospace, monospace",
          padding: "3rem 1.5rem",
          maxWidth: "44rem",
          margin: "0 auto",
          lineHeight: 1.6,
        }}
      >
        <h1 style={{ fontSize: "1.1rem", marginBottom: "0.75rem" }}>
          The application failed to render.
        </h1>
        <pre
          style={{
            whiteSpace: "pre-wrap",
            padding: "1rem",
            border: "1px solid #8884",
            borderRadius: "0.5rem",
            fontSize: "0.8rem",
          }}
        >
          {error.message || "No message"}
          {error.digest ? `\n\ndigest: ${error.digest}` : ""}
        </pre>
        <button type="button" onClick={reset} style={{ marginTop: "1rem", padding: "0.5rem 0.9rem" }}>
          Try again
        </button>
      </body>
    </html>
  );
}
