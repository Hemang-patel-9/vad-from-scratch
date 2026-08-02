import type { GuideStyle, TimeSegment } from "./types";

/** Top and bottom of a plot, in whatever unit the trace is measured in. */
export type PlotRange = { top: number; bottom: number };

export const GUIDE_DASH: Record<GuideStyle, number[]> = {
  solid: [],
  dashed: [4, 4],
  dotted: [2, 3],
};

/** Left gutter reserved for axis labels. Narrower on small screens. */
export function plotGutter(width: number): number {
  return width < 520 ? 26 : 38;
}

export function timeToX(time: number, duration: number, width: number): number {
  return duration <= 0 ? 0 : (time / duration) * width;
}

export function valueToY(value: number, range: PlotRange, height: number): number {
  const span = range.top - range.bottom;
  if (span <= 0) return height / 2;
  const clamped = Math.min(range.top, Math.max(range.bottom, value));
  return height - ((clamped - range.bottom) / span) * height;
}

export function fillSegments(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  segments: TimeSegment[],
  duration: number,
  color: string,
) {
  context.fillStyle = color;
  for (const segment of segments) {
    const left = timeToX(segment.start, duration, width);
    const right = timeToX(segment.end, duration, width);
    context.fillRect(left, 0, Math.max(1, right - left), height);
  }
}

export function drawWaveform(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  low: number[],
  high: number[],
  color: string,
) {
  if (low.length === 0) return;
  const middle = height / 2;
  let peak = 1e-6;
  for (let index = 0; index < low.length; index += 1) {
    const extent = Math.max(Math.abs(low[index]), Math.abs(high[index]));
    if (extent > peak) peak = extent;
  }
  const scale = (height / 2 - 2) / peak;

  context.fillStyle = color;
  const columnWidth = width / low.length;
  for (let index = 0; index < low.length; index += 1) {
    const x = index * columnWidth;
    const top = middle - high[index] * scale;
    const bottom = middle - low[index] * scale;
    context.fillRect(x, top, Math.max(0.75, columnWidth), Math.max(1, bottom - top));
  }
}

/** The per-frame measurement itself, plotted at frame centres. */
export function drawMeasurementCurve(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  values: number[],
  hopSeconds: number,
  frameSeconds: number,
  duration: number,
  range: PlotRange,
  color: string,
) {
  if (values.length === 0) return;
  context.beginPath();
  for (let index = 0; index < values.length; index += 1) {
    const centre = index * hopSeconds + frameSeconds / 2;
    const x = timeToX(centre, duration, width);
    const y = valueToY(values[index], range, height);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.strokeStyle = color;
  context.lineWidth = 1.25;
  context.lineJoin = "round";
  context.stroke();
}

/** Draws a guide sampled evenly across the whole width, e.g. an adaptive threshold. */
export function drawSampledCurve(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  values: number[],
  range: PlotRange,
  color: string,
  lineWidth: number,
  dash: number[],
) {
  if (values.length === 0) return;
  context.save();
  context.setLineDash(dash);
  context.beginPath();

  if (values.length === 1) {
    const y = valueToY(values[0], range, height);
    context.moveTo(0, y);
    context.lineTo(width, y);
  } else {
    for (let index = 0; index < values.length; index += 1) {
      const x = (index / (values.length - 1)) * width;
      const y = valueToY(values[index], range, height);
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    }
  }

  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

export function drawValueGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  range: PlotRange,
  gridColor: string,
  labelColor: string,
  labelX: number,
) {
  const step = chooseStep(range.top - range.bottom, Math.max(3, Math.floor(height / 44)));
  const first = Math.ceil(range.bottom / step) * step;

  context.save();
  context.font = "10px ui-monospace, monospace";
  context.textBaseline = "middle";
  for (let value = first; value <= range.top; value += step) {
    const y = valueToY(value, range, height);
    context.strokeStyle = gridColor;
    context.lineWidth = 1;
    context.beginPath();
    context.moveTo(0, y);
    context.lineTo(width, y);
    context.stroke();
    context.fillStyle = labelColor;
    // Keep the topmost and bottommost labels off the canvas edge.
    context.fillText(formatTick(value, step), labelX, Math.min(height - 6, Math.max(6, y)));
  }
  context.restore();
}

export function drawTimeAxis(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  duration: number,
  tickColor: string,
  labelColor: string,
) {
  if (duration <= 0) return;
  // Roughly one label per 90 px, so narrow screens do not overlap their labels.
  const step = chooseStep(duration, Math.max(2, Math.floor(width / 90)));

  context.save();
  context.font = "10px ui-monospace, monospace";
  context.textBaseline = "top";
  context.fillStyle = labelColor;
  context.strokeStyle = tickColor;
  context.lineWidth = 1;

  let previousRight = -Infinity;
  for (let time = 0; time <= duration + 1e-9; time += step) {
    const x = Math.min(width - 1, timeToX(time, duration, width));
    context.beginPath();
    context.moveTo(x, 0);
    context.lineTo(x, 4);
    context.stroke();

    const label = formatSeconds(time);
    const metrics = context.measureText(label);
    const anchor = Math.min(width - metrics.width, Math.max(0, x - metrics.width / 2));
    if (anchor >= previousRight + 6) {
      context.fillText(label, anchor, 6);
      previousRight = anchor + metrics.width;
    }
  }
  context.restore();
}

export function drawPlayhead(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  duration: number,
  color: string,
) {
  const x = timeToX(time, duration, width);
  context.strokeStyle = color;
  context.lineWidth = 1.5;
  context.beginPath();
  context.moveTo(x, 0);
  context.lineTo(x, height);
  context.stroke();
}

export function formatSeconds(value: number): string {
  if (value < 10) return `${value.toFixed(1)}s`;
  const minutes = Math.floor(value / 60);
  const seconds = value - minutes * 60;
  if (minutes === 0) return `${seconds.toFixed(0)}s`;
  return `${minutes}:${seconds.toFixed(0).padStart(2, "0")}`;
}

/** One axis serves decibels, crossings per second and a 0-to-1 score, so the
 *  step decides how a tick is written rather than the caller. */
export function formatTick(value: number, step: number): string {
  if (step >= 100 && Math.abs(value) >= 1000) {
    return `${Number((value / 1000).toFixed(1))}k`;
  }
  const decimals = step >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(step)));
  // Accumulating a fractional step drifts, so round before printing.
  return value.toFixed(decimals);
}

function chooseStep(span: number, targetCount: number): number {
  if (span <= 0) return 1;
  const rough = span / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const normalised = rough / magnitude;
  const factor = normalised >= 5 ? 5 : normalised >= 2 ? 2 : 1;
  return factor * magnitude;
}
