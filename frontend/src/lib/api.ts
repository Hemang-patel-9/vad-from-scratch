import type { Parameters, SampleSummary, VadAnalysis } from "./types";

export async function fetchSamples(signal?: AbortSignal): Promise<SampleSummary[]> {
  const response = await fetch("/api/samples", { signal, cache: "no-store" });
  if (!response.ok) throw new Error(`Could not list samples (HTTP ${response.status})`);
  return response.json();
}

export async function analyseSample(
  slug: string,
  sample: string,
  parameters: Parameters,
  includeWaveform: boolean,
  signal?: AbortSignal,
): Promise<VadAnalysis> {
  const response = await fetch(`/api/vad/${slug}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sample, include_waveform: includeWaveform, ...parameters }),
    signal,
  });
  if (!response.ok) {
    throw new Error(`Analysis failed (HTTP ${response.status})`);
  }
  return response.json();
}

export function sampleAudioUrl(sample: string): string {
  return `/api/samples/${encodeURIComponent(sample)}/audio`;
}

export function streamUrl(slug: string): string {
  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}/api/vad/${slug}/stream`;
}
