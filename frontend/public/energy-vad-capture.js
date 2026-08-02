// Collects microphone audio into fixed 100 ms blocks (1600 frames at 16 kHz)
// and hands each one to the main thread, which forwards it to the backend.
const CHUNK_SAMPLES = 1600;

class EnergyVadCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(CHUNK_SAMPLES);
    this.filled = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) return true;

    for (let index = 0; index < channel.length; index += 1) {
      this.buffer[this.filled] = channel[index];
      this.filled += 1;

      if (this.filled === CHUNK_SAMPLES) {
        const block = this.buffer.slice();
        this.port.postMessage(block, [block.buffer]);
        this.filled = 0;
      }
    }

    return true;
  }
}

registerProcessor("energy-vad-capture", EnergyVadCaptureProcessor);
