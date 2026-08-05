/**
 * One descriptor per approach.
 *
 * The pages, the parameter panel, the explorer and the microphone panel are all
 * shared; everything that makes an approach itself — what it measures, what you
 * can turn, and how to read the plot — is described here.
 */

import type { PlotRange } from "./draw";
import type { Parameters } from "./types";

export type RangeControl = {
  kind: "range";
  key: string;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

export type ToggleControl = {
  kind: "toggle";
  key: string;
  label: string;
  hint: string;
};

export type Control = RangeControl | ToggleControl;

export type ControlGroup = { title: string; controls: Control[] };

export type Note = { term: string; body: (parameters: Parameters) => string };

export type Detector = {
  /** Also the API path: /api/vad/{slug} and /api/vad/{slug}/stream. */
  slug: string;
  href: string;
  eyebrow: string;
  title: string;
  blurb: string;
  live: { title: string; legend: string; range: PlotRange; decimals: number };
  groups: ControlGroup[];
  notes: Note[];
};

const FRAMING: ControlGroup = {
  title: "Measure",
  controls: [
    {
      kind: "range",
      key: "frame_ms",
      label: "Frame",
      hint: "Window each reading is measured over.",
      min: 5,
      max: 100,
      step: 5,
      unit: "ms",
    },
    {
      kind: "range",
      key: "hop_ms",
      label: "Hop",
      hint: "Distance between consecutive frames.",
      min: 1,
      max: 50,
      step: 1,
      unit: "ms",
    },
    {
      kind: "range",
      key: "smoothing_ms",
      label: "Median smoothing",
      hint: "Removes single-frame spikes without smearing onsets.",
      min: 0,
      max: 200,
      step: 10,
      unit: "ms",
    },
  ],
};

// Identical for every approach, because it runs on the decision rather than the
// measurement that produced it.
const DECISION: ControlGroup = {
  title: "Smooth the decision",
  controls: [
    {
      kind: "range",
      key: "pre_speech_ms",
      label: "Onset backtrack",
      hint: "Extends a segment backwards, since onsets cross the threshold late.",
      min: 0,
      max: 500,
      step: 10,
      unit: "ms",
    },
    {
      kind: "range",
      key: "hangover_ms",
      label: "Hangover",
      hint: "How long a decision stays on after the measurement falls back.",
      min: 0,
      max: 1000,
      step: 10,
      unit: "ms",
    },
    {
      kind: "range",
      key: "min_speech_ms",
      label: "Min speech",
      hint: "Segments shorter than this are discarded.",
      min: 0,
      max: 2000,
      step: 10,
      unit: "ms",
    },
    {
      kind: "range",
      key: "min_silence_ms",
      label: "Min silence",
      hint: "Gaps shorter than this are closed up.",
      min: 0,
      max: 2000,
      step: 10,
      unit: "ms",
    },
  ],
};

const DECISION_NOTES: Note[] = [
  {
    term: "Hangover",
    body: (p) =>
      `A frame only crosses the threshold once speech is well underway, so each segment is extended ${p.pre_speech_ms} ms backwards. Speech also ends quietly, so the decision is held on for ${p.hangover_ms} ms after the measurement falls back — enough for a trailing /s/ without swallowing the pause.`,
  },
  {
    term: "Duration filter",
    body: (p) =>
      `Gaps shorter than ${p.min_silence_ms} ms are closed up, then anything left shorter than ${p.min_speech_ms} ms is discarded as a click or a knock.`,
  },
];

export const ENERGY: Detector = {
  slug: "energy",
  href: "/energy-based",
  eyebrow: "Rule-based · 01",
  title: "Energy-based VAD",
  blurb:
    "Slice the signal into short frames, measure how loud each one is, and call a frame speech when it rises far enough above the noise floor. Everything after that threshold exists to keep the decision from flickering. Move a slider and watch which stage reacts.",
  live: {
    title: "Live energy",
    legend: "solid = enter threshold · dotted = adapting noise floor",
    range: { top: 0, bottom: -90 },
    decimals: 1,
  },
  groups: [
    FRAMING,
    {
      title: "Threshold",
      controls: [
        {
          kind: "range",
          key: "noise_percentile",
          label: "Noise percentile",
          hint: "Quantile of frame energy taken as the noise floor.",
          min: 1,
          max: 50,
          step: 1,
          unit: "%",
        },
        {
          kind: "range",
          key: "noise_window_s",
          label: "Noise window",
          hint: "Floor is re-estimated per window. 0 uses one floor for the whole file.",
          min: 0,
          max: 30,
          step: 1,
          unit: "s",
        },
        {
          kind: "range",
          key: "threshold_offset_db",
          label: "Threshold offset",
          hint: "How far above the noise floor speech must rise.",
          min: 0,
          max: 40,
          step: 0.5,
          unit: "dB",
        },
        {
          kind: "range",
          key: "hysteresis_db",
          label: "Hysteresis",
          hint: "Gap between the enter and exit thresholds.",
          min: 0,
          max: 20,
          step: 0.5,
          unit: "dB",
        },
      ],
    },
    DECISION,
  ],
  notes: [
    {
      term: "Threshold",
      body: (p) =>
        `The noise floor is the ${p.noise_percentile}th percentile of frame energy, ${
          Number(p.noise_window_s) > 0
            ? `re-estimated every ${p.noise_window_s} s so a drifting room is tracked`
            : "taken once across the whole file"
        }. A frame turns on above the enter line and only turns off once it falls below the exit line — the gap between them stops a frame hovering at the boundary from chattering.`,
    },
    ...DECISION_NOTES,
  ],
};

export const ZERO_CROSSING: Detector = {
  slug: "zero-crossing",
  href: "/zero-crossing",
  eyebrow: "Rule-based · 02",
  title: "Zero-crossing VAD",
  blurb:
    "Count how often the waveform changes sign. A voiced vowel is carried by a low-frequency buzz and crosses zero slowly; hiss, fans and clicks are broadband and cross it constantly. So the comparison runs the other way round — speech is what stays below the line. Turn the energy gate off to see why counting alone is not enough.",
  live: {
    title: "Live crossing rate",
    legend: "solid = enter threshold · dotted = the voiced reference",
    range: { top: 8000, bottom: 0 },
    decimals: 0,
  },
  groups: [
    FRAMING,
    {
      title: "Threshold",
      controls: [
        {
          kind: "range",
          key: "zcr_percentile",
          label: "Voiced percentile",
          hint: "Quantile of the crossing rate taken as the voiced reference.",
          min: 1,
          max: 90,
          step: 1,
          unit: "%",
        },
        {
          kind: "range",
          key: "zcr_window_s",
          label: "Reference window",
          hint: "Reference is re-estimated per window. 0 uses one for the whole file.",
          min: 0,
          max: 30,
          step: 1,
          unit: "s",
        },
        {
          kind: "range",
          key: "zcr_margin_hz",
          label: "Margin",
          hint: "How far above the voiced reference a frame may still count as speech.",
          min: 0,
          max: 4000,
          step: 50,
          unit: "/s",
        },
        {
          kind: "range",
          key: "hysteresis_hz",
          label: "Hysteresis",
          hint: "Gap between the enter and exit thresholds.",
          min: 0,
          max: 1500,
          step: 25,
          unit: "/s",
        },
      ],
    },
    {
      title: "Energy gate",
      controls: [
        {
          kind: "toggle",
          key: "energy_gate",
          label: "Energy gate",
          hint: "Silence crosses zero almost never, which reads as perfectly voiced. Turn this off to watch that happen.",
        },
        {
          kind: "range",
          key: "gate_offset_db",
          label: "Gate offset",
          hint: "How far above the noise floor a frame must be to be considered at all.",
          min: 0,
          max: 30,
          step: 0.5,
          unit: "dB",
        },
      ],
    },
    DECISION,
  ],
  notes: [
    {
      term: "Threshold",
      body: (p) =>
        `The reference is the ${p.zcr_percentile}th percentile of the crossing rate over audible frames — the rate the most voiced part of this recording runs at. A frame counts as speech while it stays within ${p.zcr_margin_hz} crossings per second of that, and only stops once it climbs ${p.hysteresis_hz}/s past the line.`,
    },
    {
      term: "Energy gate",
      body: (p) =>
        p.energy_gate
          ? `Frames less than ${p.gate_offset_db} dB above the noise floor are refused before the rate is even consulted. Without this, digital silence — which never changes sign — would score as the most voiced thing in the file.`
          : "The gate is off, so the crossing rate decides alone. Anything quiet enough to cross zero rarely now counts as speech, silence included.",
    },
    ...DECISION_NOTES,
  ],
};

export const SPECTRAL: Detector = {
  slug: "spectral",
  href: "/spectral",
  eyebrow: "Rule-based · 03",
  title: "Spectral VAD",
  blurb:
    "Ask how the energy in a frame is arranged rather than how much of it there is. Voiced speech is harmonic — a few tall peaks over a quiet background — while a fan or a hiss spreads itself evenly. Flatness and entropy both put a number on that, and both are ratios, so a whisper and a shout score the same.",
  live: {
    title: "Live tonality",
    legend: "solid = enter threshold · dotted = the room's own score",
    range: { top: 1, bottom: 0 },
    decimals: 3,
  },
  groups: [
    {
      ...FRAMING,
      controls: [
        ...FRAMING.controls,
        {
          kind: "range",
          key: "flatness_weight",
          label: "Flatness vs entropy",
          hint: "0 is pure entropy, 1 is pure flatness. Anything between crossfades the two.",
          min: 0,
          max: 1,
          step: 0.05,
          unit: "",
        },
      ],
    },
    {
      title: "Band and threshold",
      controls: [
        {
          kind: "range",
          key: "band_low_hz",
          label: "Band low",
          hint: "Bins below this are ignored, along with rumble and mains hum.",
          min: 0,
          max: 2000,
          step: 50,
          unit: "Hz",
        },
        {
          kind: "range",
          key: "band_high_hz",
          label: "Band high",
          hint: "Bins above this are ignored. Speech has little structure up there.",
          min: 1000,
          max: 8000,
          step: 250,
          unit: "Hz",
        },
        {
          kind: "range",
          key: "noise_percentile",
          label: "Room percentile",
          hint: "Quantile of the score taken as the room's own structure.",
          min: 1,
          max: 50,
          step: 1,
          unit: "%",
        },
        {
          kind: "range",
          key: "reference_window_s",
          label: "Reference window",
          hint: "Reference is re-estimated per window. 0 uses one for the whole file.",
          min: 0,
          max: 30,
          step: 1,
          unit: "s",
        },
        {
          kind: "range",
          key: "margin",
          label: "Margin",
          hint: "How far from the room toward the most structured frame the threshold sits.",
          min: 0.05,
          max: 0.9,
          step: 0.05,
          unit: "",
        },
        {
          kind: "range",
          key: "hysteresis",
          label: "Hysteresis",
          hint: "Gap between the enter and exit thresholds, on the same scale.",
          min: 0,
          max: 0.5,
          step: 0.05,
          unit: "",
        },
      ],
    },
    DECISION,
  ],
  notes: [
    {
      term: "Score",
      body: (p) =>
        `Each frame's spectrum is taken between ${p.band_low_hz} and ${p.band_high_hz} Hz, then reduced to how far it is from flat. Flatness and entropy are blended ${Math.round(
          Number(p.flatness_weight) * 100,
        )}/${Math.round(
          (1 - Number(p.flatness_weight)) * 100,
        )}. Both are 1 for noise and fall as structure appears, so inverting them puts each on the same 0-to-1 scale.`,
    },
    {
      term: "Threshold",
      body: (p) =>
        `The score is unitless, so the threshold is placed proportionally: ${Math.round(
          Number(p.margin) * 100,
        )}% of the way from the ${p.noise_percentile}th percentile — the room — toward the most structured frames in the window. That is what keeps one setting working across recordings with very different amounts of separation.`,
    },
    ...DECISION_NOTES,
  ],
};

export const NEURAL: Detector = {
  slug: "neural",
  href: "/dl-based",
  eyebrow: "DL-based · 04",
  title: "Neural VAD",
  blurb:
    "Stop choosing the measurement. A small causal network reads 64 log-mel bands per frame and emits a probability directly, and the same hysteresis, hangover and duration filters as the other three turn it into segments. Note what is missing from the panel: there is no noise percentile, no reference window, no margin. Nothing here adapts to the recording, because the network already learned what a room sounds like.",
  live: {
    title: "Live speech probability",
    legend: "solid = enter threshold · dashed = exit threshold",
    range: { top: 1, bottom: 0 },
    decimals: 3,
  },
  groups: [
    // Frame and hop are absent on purpose: the model was trained on a 30 ms
    // window at a 10 ms hop and the backend refuses anything else, so offering
    // them as sliders would only offer a way to get a 400 back.
    {
      title: "Measure",
      controls: [
        {
          kind: "range",
          key: "smoothing_ms",
          label: "Median smoothing",
          hint: "Usually unnecessary here — the network's output barely flickers.",
          min: 0,
          max: 200,
          step: 10,
          unit: "ms",
        },
      ],
    },
    {
      title: "Threshold",
      controls: [
        {
          kind: "range",
          key: "enter_probability",
          label: "Enter at",
          hint: "Probability a frame must reach before speech starts.",
          min: 0.05,
          max: 0.95,
          step: 0.05,
          unit: "",
        },
        {
          kind: "range",
          key: "exit_probability",
          label: "Exit at",
          hint: "Probability it must fall below before speech ends.",
          min: 0.05,
          max: 0.95,
          step: 0.05,
          unit: "",
        },
      ],
    },
    DECISION,
  ],
  notes: [
    {
      term: "Probability",
      body: () =>
        "Each frame's 64 log-mel bands go through five stacks of time-channel separable convolutions and then a GRU. Every convolution pads on the left only, so a frame is judged on what came before it and never on what follows — which is what lets the microphone tab return exactly the numbers the file tab does, rather than an approximation of them. About 1.7 s of history reaches each decision.",
    },
    {
      term: "Threshold",
      body: (p) =>
        `Unlike the other three, this line is absolute: ${p.enter_probability} means the network is ${Math.round(
          Number(p.enter_probability) * 100,
        )}% sure, not a fraction of the way from some reference to some peak. It was chosen on held-out audio and deliberately set a little low, because a clipped word costs more than a little extra audio does. Speech ends only once confidence drops under ${p.exit_probability}.`,
    },
    ...DECISION_NOTES,
  ],
};

export const DETECTORS = [ENERGY, ZERO_CROSSING, SPECTRAL, NEURAL];

/** Mirrors the pydantic defaults; the panel reads them for its reset button. */
export const DEFAULTS: Record<string, Parameters> = {
  energy: {
    frame_ms: 30,
    hop_ms: 10,
    smoothing_ms: 30,
    noise_percentile: 10,
    noise_window_s: 5,
    threshold_offset_db: 8,
    hysteresis_db: 3,
    pre_speech_ms: 30,
    hangover_ms: 60,
    min_speech_ms: 120,
    min_silence_ms: 100,
  },
  "zero-crossing": {
    frame_ms: 30,
    hop_ms: 10,
    smoothing_ms: 30,
    zcr_percentile: 25,
    zcr_window_s: 5,
    zcr_margin_hz: 1400,
    hysteresis_hz: 250,
    energy_gate: true,
    gate_offset_db: 3,
    pre_speech_ms: 30,
    hangover_ms: 60,
    min_speech_ms: 120,
    min_silence_ms: 100,
  },
  spectral: {
    frame_ms: 30,
    hop_ms: 10,
    smoothing_ms: 30,
    flatness_weight: 0.5,
    band_low_hz: 200,
    band_high_hz: 4000,
    noise_percentile: 15,
    reference_window_s: 5,
    margin: 0.35,
    hysteresis: 0.1,
    pre_speech_ms: 30,
    hangover_ms: 60,
    min_speech_ms: 120,
    min_silence_ms: 100,
  },
  // frame_ms and hop_ms are sent but not adjustable — the model's grid. The
  // decision stages are shorter than the rule-based defaults because the GRU
  // has already absorbed most of the flicker they exist to remove.
  neural: {
    frame_ms: 30,
    hop_ms: 10,
    smoothing_ms: 0,
    enter_probability: 0.6,
    exit_probability: 0.4,
    pre_speech_ms: 30,
    hangover_ms: 40,
    min_speech_ms: 80,
    min_silence_ms: 100,
  },
};
