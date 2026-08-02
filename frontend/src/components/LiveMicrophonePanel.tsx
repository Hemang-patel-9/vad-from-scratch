"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Mic, Square } from "lucide-react";

import { AnimatedCanvas, useThemeTokens, type Painter } from "@/components/canvas";
import { streamUrl } from "@/lib/api";
import { decibelToY, type DecibelRange } from "@/lib/draw";
import type { StreamUpdate, VadParameters } from "@/lib/types";

const HISTORY_FRAMES = 1000;
const WORKLET_URL = "/energy-vad-capture.js";

type LiveFrame = {
  energy: number;
  speaking: boolean;
  enter: number;
  floor: number;
};

type Status = "idle" | "starting" | "running" | "error";

export function LiveMicrophonePanel({ parameters }: { parameters: VadParameters }) {
  const tokens = useThemeTokens();
  const historyRef = useRef<LiveFrame[]>([]);
  const socketRef = useRef<WebSocket | null>(null);
  const contextRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [utterances, setUtterances] = useState(0);
  const [readout, setReadout] = useState({ floor: 0, enter: 0, level: 0 });

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
    setUtterances(0);

    try {
      const media = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = media;

      const context = new AudioContext({ sampleRate: 16000 });
      contextRef.current = context;
      await context.audioWorklet.addModule(WORKLET_URL);

      const socket = new WebSocket(streamUrl());
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

        const incoming = update.energy_db.map((energy, index) => ({
          energy,
          speaking: update.flags[index] ?? false,
          enter: update.enter_threshold_db,
          floor: update.noise_floor_db,
        }));
        const merged = historyRef.current.concat(incoming);
        historyRef.current = merged.slice(Math.max(0, merged.length - HISTORY_FRAMES));

        if (update.speech_started) setUtterances((count) => count + 1);
        const last = incoming.at(-1);
        if (last) {
          setIsSpeaking(last.speaking);
          setReadout({ floor: last.floor, enter: last.enter, level: last.energy });
        }
      });

      socket.addEventListener("close", () => setStatus("idle"));

      const source = context.createMediaStreamSource(media);
      const capture = new AudioWorkletNode(context, "energy-vad-capture");
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
  }, [parameters, teardown]);

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

  const range: DecibelRange = useMemo(() => ({ top: 0, bottom: -90 }), []);

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

      drawTrace(context, frames, offset, columnWidth, range, height, (frame) => frame.energy, tokens["--energy"], 1.25, []);
      drawTrace(context, frames, offset, columnWidth, range, height, (frame) => frame.enter, tokens["--speech"], 1, []);
      drawTrace(context, frames, offset, columnWidth, range, height, (frame) => frame.floor, tokens["--muted"], 1, [2, 3]);
    },
    [tokens, range],
  );

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
            Live energy · last 10 s
          </span>
          <span className="text-[10px] text-muted">
            solid = enter threshold · dotted = adapting noise floor
          </span>
        </div>
        <AnimatedCanvas
          paint={paint}
          active={status === "running"}
          label="Live microphone energy"
          className="h-40 w-full"
        />
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Readout label="Utterances" value={`${utterances}`} />
        <Readout label="Level" value={status === "running" ? `${readout.level.toFixed(1)} dB` : "—"} />
        <Readout label="Noise floor" value={status === "running" ? `${readout.floor.toFixed(1)} dB` : "—"} />
        <Readout label="Enter at" value={status === "running" ? `${readout.enter.toFixed(1)} dB` : "—"} />
      </dl>
    </div>
  );
}

function drawTrace(
  context: CanvasRenderingContext2D,
  frames: LiveFrame[],
  offset: number,
  columnWidth: number,
  range: DecibelRange,
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
    const y = decibelToY(pick(frames[index]), range, height);
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
