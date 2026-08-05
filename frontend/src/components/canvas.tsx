"use client";

import { useEffect, useRef, useState } from "react";

const TOKEN_NAMES = [
  "--foreground",
  "--muted",
  "--line",
  "--surface",
  "--background",
  "--speech",
  "--speech-wash",
  "--wave",
  "--energy",
  "--grid",
  "--ok",
  "--down",
] as const;

export type ThemeTokens = Record<(typeof TOKEN_NAMES)[number], string>;

export function useThemeTokens(): ThemeTokens | null {
  const [tokens, setTokens] = useState<ThemeTokens | null>(null);

  useEffect(() => {
    const read = () => {
      const style = getComputedStyle(document.documentElement);
      const next = {} as ThemeTokens;
      for (const name of TOKEN_NAMES) next[name] = style.getPropertyValue(name).trim();
      setTokens(next);
    };

    // A canvas cannot read CSS variables, so the palette is sampled out of the
    // DOM. The toggle works by setting data-theme on <html>, so watching that
    // attribute is what keeps the plots from staying on the old palette.
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    return () => observer.disconnect();
  }, []);

  return tokens;
}

export type Painter = (
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
) => void;

export function renderOnto(canvas: HTMLCanvasElement, paint: Painter) {
  const bounds = canvas.getBoundingClientRect();
  const width = Math.max(1, Math.floor(bounds.width));
  const height = Math.max(1, Math.floor(bounds.height));
  const ratio = window.devicePixelRatio || 1;
  const backingWidth = Math.floor(width * ratio);
  const backingHeight = Math.floor(height * ratio);

  // Assigning width/height clears the canvas, so only touch it on a real resize.
  if (canvas.width !== backingWidth || canvas.height !== backingHeight) {
    canvas.width = backingWidth;
    canvas.height = backingHeight;
  }

  const context = canvas.getContext("2d");
  if (!context) return;
  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  context.clearRect(0, 0, width, height);
  paint(context, width, height);
}

export function PaintedCanvas({
  paint,
  className,
  label,
}: {
  paint: Painter;
  className?: string;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const render = () => renderOnto(canvas, paint);
    render();
    const observer = new ResizeObserver(render);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  return <canvas ref={canvasRef} role="img" aria-label={label} className={className} />;
}

/** For canvases whose source data lives in a ref and changes faster than React renders. */
export function AnimatedCanvas({
  paint,
  active,
  className,
  label,
}: {
  paint: Painter;
  active: boolean;
  className?: string;
  label: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    renderOnto(canvas, paint);
    if (!active) {
      const observer = new ResizeObserver(() => renderOnto(canvas, paint));
      observer.observe(canvas);
      return () => observer.disconnect();
    }

    let handle = requestAnimationFrame(function step() {
      renderOnto(canvas, paint);
      handle = requestAnimationFrame(step);
    });
    return () => cancelAnimationFrame(handle);
  }, [paint, active]);

  return <canvas ref={canvasRef} role="img" aria-label={label} className={className} />;
}
