"use client";

import { RotateCcw } from "lucide-react";

import type { Control, ControlGroup } from "@/lib/detectors";
import type { Parameters } from "@/lib/types";

export function ParameterPanel({
  groups,
  parameters,
  defaults,
  onChange,
  disabled,
}: {
  groups: ControlGroup[];
  parameters: Parameters;
  defaults: Parameters;
  onChange: (next: Parameters) => void;
  disabled?: boolean;
}) {
  const controls = groups.flatMap((group) => group.controls);
  const isDefault = controls.every((control) => parameters[control.key] === defaults[control.key]);

  return (
    <section aria-labelledby="parameters-heading" className="rounded-lg border border-line bg-surface">
      <header className="flex items-center justify-between border-b border-line px-4 py-3">
        <h2 id="parameters-heading" className="text-sm font-medium">
          Parameters
        </h2>
        <button
          type="button"
          onClick={() => onChange(defaults)}
          disabled={isDefault}
          className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs text-muted transition-colors hover:bg-background hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-40"
        >
          <RotateCcw className="size-3.5" aria-hidden />
          Reset
        </button>
      </header>

      <div className="grid gap-x-8 gap-y-6 p-4 lg:grid-cols-3">
        {groups.map((group) => (
          <div key={group.title}>
            <h3 className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted">
              {group.title}
            </h3>
            <div className="mt-3 space-y-5">
              {group.controls.map((control) => (
                <ControlField
                  key={control.key}
                  control={control}
                  parameters={parameters}
                  onChange={onChange}
                  disabled={disabled}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function ControlField({
  control,
  parameters,
  onChange,
  disabled,
}: {
  control: Control;
  parameters: Parameters;
  onChange: (next: Parameters) => void;
  disabled?: boolean;
}) {
  if (control.kind === "toggle") {
    const checked = Boolean(parameters[control.key]);
    return (
      <div>
        <label htmlFor={control.key} className="flex items-center justify-between gap-3 text-sm">
          {control.label}
          <input
            id={control.key}
            type="checkbox"
            checked={checked}
            disabled={disabled}
            onChange={(event) => onChange({ ...parameters, [control.key]: event.target.checked })}
            className="size-4 accent-speech disabled:opacity-40"
          />
        </label>
        <p className="mt-1 text-xs leading-snug text-muted">{control.hint}</p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={control.key} className="text-sm">
          {control.label}
        </label>
        <output htmlFor={control.key} className="font-mono text-xs tabular-nums text-muted">
          {Number(parameters[control.key])}
          {control.unit}
        </output>
      </div>
      <input
        id={control.key}
        type="range"
        min={control.min}
        max={control.max}
        step={control.step}
        value={Number(parameters[control.key])}
        disabled={disabled}
        onChange={(event) => onChange({ ...parameters, [control.key]: Number(event.target.value) })}
        className="mt-2 w-full accent-speech disabled:opacity-40"
      />
      <p className="mt-1 text-xs leading-snug text-muted">{control.hint}</p>
    </div>
  );
}
