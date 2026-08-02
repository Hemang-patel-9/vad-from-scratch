export type SampleSummary = {
  name: string;
  duration: number;
  source_sample_rate: number;
  channels: number;
};

/** A detector's tuning, keyed by the same names the backend uses. */
export type Parameters = Record<string, number | boolean>;

export type TimeSegment = {
  start: number;
  end: number;
};

export type PipelineStage = {
  key: string;
  label: string;
  description: string;
  segments: TimeSegment[];
};

export type GuideStyle = "solid" | "dashed" | "dotted";
export type GuideEmphasis = "primary" | "secondary";

/** A threshold drawn across the whole recording, under the measurement it applies to. */
export type GuideCurve = {
  key: string;
  label: string;
  style: GuideStyle;
  emphasis: GuideEmphasis;
  values: number[];
};

/** One per-frame measurement and the lines it is compared against. */
export type MeasurementTrace = {
  key: string;
  label: string;
  unit: string;
  hint: string;
  top: number;
  bottom: number;
  values: number[];
  guides: GuideCurve[];
};

export type Statistic = { label: string; value: string };

export type WaveformEnvelope = { low: number[]; high: number[] };

/** What every detector answers with. Only the traces differ between approaches. */
export type VadAnalysis = {
  sample: string;
  sample_rate: number;
  duration: number;
  frame_seconds: number;
  hop_seconds: number;
  traces: MeasurementTrace[];
  stages: PipelineStage[];
  segments: TimeSegment[];
  speech_ratio: number;
  statistics: Statistic[];
  waveform: WaveformEnvelope | null;
  elapsed_ms: number;
};

export type GuideLevel = {
  key: string;
  label: string;
  value: number;
  style: GuideStyle;
  emphasis: GuideEmphasis;
};

export type StreamUpdate = {
  type: "update";
  time: number;
  hop_seconds: number;
  measurements: number[];
  flags: boolean[];
  guides: GuideLevel[];
  speech_started: boolean;
  speech_ended: boolean;
};
