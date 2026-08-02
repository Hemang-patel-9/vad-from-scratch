"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Mic, Square } from "lucide-react";

import { AnimatedCanvas, useThemeTokens, type Painter } from "@/components/canvas";
import { streamUrl } from "@/lib/api";
import { GUIDE_DASH, valueToY, type PlotRange } from "@/lib/draw";
import type { Detector } from "@/lib/detectors";
import type { GuideLevel, Parameters, StreamUpdate } from "@/lib/types";

const HISTORY_FRAMES = 1000;
const WORKLET_URL = "/vad-capture.js";
const PROCESSOR_NAME = "vad-capture";

type LiveFrame = {
  value: number;
  speaking: boolean;
  guides: GuideLevel[];
};

type Status = "idle" | "starting" | "running" | "error";

export function LiveMicrophonePanel({
  detector,
  parameters,
}: {
  detector: Detector;
  parameters: Parameters;
}) {
  const tokens = useThemeTokens();
  const historyRef = useRef<LiveFrame[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [utterances, setUtterances] = useState(0);
  const [latest, setLatest] = useState<LiveFrame | null>(null);

  const teardown = useCallback(() => {
    socketRef.current?.close();
    socketRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    void contextRef.current?.close();
    contextRef.current = null;
  }, []);

  useEffect(() => teardown, [teardown]);

  const start = useCallback(async () => {
    setStatus("starting");
    setError(null);
    historyRef.current = [];
    setLatest(null);
    setUtterances(0);

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = media;

      const context = new AudioContext({ sampleRate: 16000 });
      contextRef.current = context;
      await context.audioWorklet.addModule(WORKLET_URL);

      const socket = new WebSocket(streamUrl(detector.slug));
      socket.binaryType = "arraybuffer";
      socketRef.current = socket;

      await new Promise<void>((resolve, reject) => {
        socket.addEventListener("open", () => resolve(), { once: true });
        socket.addEventListener("error", () => reject(new Error("Could not reach the detector")), {
          once: true,
        });
      });
      socket.send(JSON.stringify(parameters));

      socket.addEventListener("message", (event) => {
        const message = JSON.parse(event.data as string) as StreamUpdate | { type: string };
        if (message.type !== "update") return;
        const update = message as StreamUpdate;

        const incoming = update.measurements.map((value, index) => ({
          value,
          speaking: update.flags[index] ?? false,
          guides: update.guides,
        }));
        const merged = historyRef.current.concat(incoming);
        historyRef.current = merged.slice(Math.max(0, merged.length - HISTORY_FRAMES));

        if (update.speech_started) setUtterances((count) => count + 1);
        const last = incoming.at(-1);
        if (last) {
          setIsSpeaking(last.speaking);
          setLatest(last);
        }
      });

      socket.addEventListener("close", () => setStatus("idle"));

      const source = context.createMediaStreamSource(media);
      const capture = new AudioWorkletNode(context, PROCESSOR_NAME);
      capture.port.onmessage = (event: MessageEvent<Float32Array>) => {
        if (socket.readyState === WebSocket.OPEN) socket.send(event.data);
      };

      // A worklet with no path to the destination is not guaranteed to be pulled,
      // so route it through a silent gain node rather than echoing the microphone.
      const silence = context.createGain();
      silence.gain.value = 0;
      source.connect(capture).connect(silence).connect(context.destination);

      await context.resume();
      setStatus("running");
    } catch (cause) {
      teardown();
      setError(cause instanceof Error ? cause.message : "Could not start the microphone");
      setStatus("error");
    }
  }, [detector.slug, parameters, teardown]);

  const stop = useCallback(() => {
    teardown();
    setStatus("idle");
    setIsSpeaking(false);
  }, [teardown]);

  useEffect(() => {
    const socket = socketRef.current;
    if (status === "running" && socket?.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(parameters));
    }
  }, [parameters, status]);

  const range: PlotRange = detector.live.range;

  const paint = useMemo<Painter>(
    () => (context, width, height) => {
      if (!tokens) return;
      const frames = historyRef.current;

      context.fillStyle = tokens["--grid"];
      context.fillRect(0, 0, width, 1);

      if (frames.length === 0) {
        context.fillStyle = tokens["--muted"];
        context.font = "12px ui-monospace, monospace";
        context.textAlign = "center";
        context.fillText("Waiting for audio", width / 2, height / 2);
        context.textAlign = "left";
        return;
      }

      const columnWidth = width / HISTORY_FRAMES;
      const offset = HISTORY_FRAMES - frames.length;

      context.fillStyle = tokens["--speech-wash"];
      for (let index = 0; index < frames.length; index += 1) {
        if (frames[index].speaking) {
          context.fillRect((offset + index) * columnWidth, 0, Math.max(1, columnWidth), height);
        }
      }

      drawTrace(
        context,
        frames,
        offset,
        columnWidth,
        range,
        height,
        (frame) => frame.value,
        tokens["--energy"],
        1.25,
        [],
      );

      // Each frame carries the thresholds that were in force when it was
      // decided, so the guides move with the detector rather than being redrawn
      // flat at whatever the latest value happens to be.
      for (const guide of frames.at(-1)?.guides ?? []) {
        drawTrace(
          context,
          frames,
          offset,
          columnWidth,
          range,
          height,
          (frame) => frame.guides.find((entry) => entry.key === guide.key)?.value ?? guide.value,
          guide.emphasis === "primary" ? tokens["--speech"] : tokens["--muted"],
          guide.style === "solid" ? 1.25 : 1,
          GUIDE_DASH[guide.style],
        );
      }
    },
    [tokens, range],
  );

  const format = (value: number) => value.toFixed(detector.live.decimals);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        {status === "running" ? (
          <button
            type="button"
            onClick={stop}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground"
          >
            <Square className="size-3.5" aria-hidden />
            Stop
          </button>
        ) : (
          <button
            type="button"
            onClick={() => void start()}
            disabled={status === "starting"}
            className="flex items-center gap-1.5 rounded-md border border-line px-2.5 py-1.5 font-mono text-xs transition-colors hover:bg-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-foreground disabled:opacity-40"
          >
            <Mic className="size-3.5" aria-hidden />
            {status === "starting" ? "Starting" : "Start microphone"}
          </button>
        )}

        {status === "running" && (
          <span
            className={`flex items-center gap-1.5 font-mono text-xs ${isSpeaking ? "text-ok" : "text-muted"}`}
          >
            <span className={`size-2 rounded-full ${isSpeaking ? "bg-ok" : "bg-muted"}`} />
            {isSpeaking ? "Speech" : "Silence"}
          </span>
        )}

        <span className="text-xs text-muted">
          Audio is analysed by the same detector, one 100 ms block at a time.
        </span>
      </div>

      {error && (
        <p className="flex items-center gap-2 rounded-md border border-line bg-surface px-3 py-2 font-mono text-xs text-down">
          <CircleAlert className="size-3.5" aria-hidden />
          {error}
        </p>
      )}

      <div className="rounded-lg border border-line bg-surface p-3">
        <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3">
          <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">
            {detector.live.title} · last 10 s
          </span>
          <span className="text-[10px] text-muted">{detector.live.legend}</span>
        </div>
        <AnimatedCanvas
          paint={paint}
          active={status === "running"}
          label={`${detector.live.title} from the microphone`}
          className="h-40 w-full"
        />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-5">
        <Readout label="Utterances" value={`${utterances}`} />
        <Readout
          label="Level"
          value={status === "running" && latest ? format(latest.value) : "—"}
        />
        {(latest?.guides ?? []).map((guide) => (
          <Readout
            key={guide.key}
            label={guide.label}
            value={status === "running" ? format(guide.value) : "—"}
          />
        ))}
      </dl>
    </div>
  );
}

function drawTrace(
  context: CanvasRenderingContext2D,
  frames: LiveFrame[],
  offset: number,
  columnWidth: number,
  range: PlotRange,
  height: number,
  pick: (frame: LiveFrame) => number,
  color: string,
  lineWidth: number,
  dash: number[],
) {
  context.save();
  context.setLineDash(dash);
  context.beginPath();
  for (let index = 0; index < frames.length; index += 1) {
    const x = (offset + index) * columnWidth;
    const y = valueToY(pick(frames[index]), range, height);
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.strokeStyle = color;
  context.lineWidth = lineWidth;
  context.stroke();
  context.restore();
}

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-surface px-4 py-3">
      <dt className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted">{label}</dt>
      <dd className="mt-1 font-mono text-sm tabular-nums">{value}</dd>
    </div>
  );
}
