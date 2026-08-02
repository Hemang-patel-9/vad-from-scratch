"use client";

import { RotateCcw } from "lucide-react";

import { DEFAULT_PARAMETERS, type VadParameters } from "@/lib/types";

type Control = {
  key: keyof VadParameters;
  label: string;
  hint: string;
  min: number;
  max: number;
  step: number;
  unit: string;
};

type Group = { title: string; controls: Control[] };

const GROUPS: Group[] = [
  {
    title: "Measure",
    controls: [
      {
        key: "frame_ms",
        label: "Frame",
        hint: "Window each energy reading is measured over.",
        min: 5,
        max: 100,
        step: 5,
        unit: "ms",
      },
      {
        key: "hop_ms",
        label: "Hop",
        hint: "Distance between consecutive frames.",
        min: 1,
        max: 50,
        step: 1,
        unit: "ms",
      },
      {
        key: "smoothing_ms",
        label: "Median smoothing",
        hint: "Removes single-frame spikes without smearing onsets.",
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
        key: "noise_percentile",
        label: "Noise percentile",
        hint: "Quantile of frame energy taken as the noise floor.",
        min: 1,
        max: 50,
        step: 1,
        unit: "%",
      },
      {
        key: "noise_window_s",
        label: "Noise window",
        hint: "Floor is re-estimated per window. 0 uses one floor for the whole file.",
        min: 0,
        max: 30,
        step: 1,
        unit: "s",
      },
      {
        key: "threshold_offset_db",
        label: "Threshold offset",
        hint: "How far above the noise floor speech must rise.",
        min: 0,
        max: 40,
        step: 0.5,
        unit: "dB",
      },
      {
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
  {
    title: "Smooth the decision",
    controls: [
      {
        key: "pre_speech_ms",
        label: "Onset backtrack",
        hint: "Extends a segment backwards, since onsets cross the threshold late.",
        min: 0,
        max: 500,
        step: 10,
        unit: "ms",
      },
      {
        key: "hangover_ms",
        label: "Hangover",
        hint: "How long a decision stays on after energy drops.",
        min: 0,
        max: 1000,
        step: 10,
        unit: "ms",
      },
      {
        key: "min_speech_ms",
        label: "Min speech",
        hint: "Segments shorter than this are discarded.",
        min: 0,
        max: 2000,
        step: 10,
        unit: "ms",
      },
      {
        key: "min_silence_ms",
        label: "Min silence",
        hint: "Gaps shorter than this are closed up.",
        min: 0,
        max: 2000,
        step: 10,
        unit: "ms",
      },
    ],
  },
];

const ALL_CONTROLS = GROUPS.flatMap((group) => group.controls);

export function ParameterPanel({
  parameters,
  onChange,
  disabled,
}: {
  parameters: VadParameters;
  onChange: (next: VadParameters) => void;
  disabled?: boolean;
}) {
  const isDefault = ALL_CONTROLS.every(
    (control) => parameters[control.key] === DEFAULT_PARAMETERS[control.key],
  );

  return (
    <section aria-labelledby="parameters-heading" className="rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="parameters-heading" className="text-sm font-medium">
          Parameters
        </h2>
        <button
          type="button"
          onClick={() => onChange(DEFAULT_PARAMETERS)}
          disabled={isDefault}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset
        </button>
      </header>

      <div className="grid gap-x-8 gap-y-6 p-4 lg:grid-cols-3">
        {GROUPS.map((group) => (
          <div key={group.title}>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              {group.title}
            </h3>
            <div className="mt-3 space-y-5">
              {group.controls.map((control) => (
                <div key={control.key}>
                  <div className="flex items-baseline justify-between gap-3">
                    <label htmlFor={control.key} className="text-sm">
                      {control.label}
                    </label>
                    <output
                      htmlFor={control.key}
                      className="font-mono text-xs tabular-nums text-muted"
                    >
                      {parameters[control.key]}
                      {control.unit}
                    </output>
                  </div>
                  <input
                    id={control.key}
                    type="range"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    value={parameters[control.key]}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange({ ...parameters, [control.key]: Number(event.target.value) })
                    }
                    className="mt-2 w-full accent-speech disabled:opacity-40"
                  />
                  <p className="mt-1 text-xs leading-snug text-muted">{control.hint}</p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
