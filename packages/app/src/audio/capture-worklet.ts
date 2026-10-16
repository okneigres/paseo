// Microphone capture runs on the audio thread. A ScriptProcessorNode runs on
// the page's main thread, and when the interface is busy (playback decoding,
// rendering) its buffers arrive late or are dropped. The worklet also does the
// 16 kHz conversion itself: it averages the input over each output sample,
// which weakens content above 8 kHz (a 12 kHz tone drops to a third) instead of
// folding it back at full strength like plain decimation, and it carries its
// position across blocks, so there are no clicks at block edges.

export const CAPTURE_WORKLET_NAME = "paseo-capture";
export const CAPTURE_TARGET_RATE = 16000;

export const CAPTURE_WORKLET_SOURCE = `
class PaseoCaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const settings = (options && options.processorOptions) || {};
    this.ratio = sampleRate / (settings.targetRate || ${CAPTURE_TARGET_RATE});
    this.flushSamples = settings.flushSamples || 640;
    this.out = new Int16Array(this.flushSamples);
    this.outLength = 0;
    this.sum = 0;
    this.phase = 0;
    this.sumSquares = 0;
    this.sumCount = 0;
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      return true;
    }
    const ratio = this.ratio;
    for (let i = 0; i < channel.length; i += 1) {
      const x = channel[i];
      this.sumSquares += x * x;
      this.sumCount += 1;
      const remaining = ratio - this.phase;
      if (remaining > 1) {
        this.sum += x;
        this.phase += 1;
      } else {
        this.sum += x * remaining;
        this.push(this.sum / ratio);
        const left = 1 - remaining;
        this.sum = x * left;
        this.phase = left;
      }
    }
    return true;
  }

  push(value) {
    const clamped = value < -1 ? -1 : value > 1 ? 1 : value;
    this.out[this.outLength] = clamped < 0 ? Math.round(clamped * 0x8000) : Math.round(clamped * 0x7fff);
    this.outLength += 1;
    if (this.outLength === this.out.length) {
      this.flush();
    }
  }

  flush() {
    const rms = this.sumCount > 0 ? Math.sqrt(this.sumSquares / this.sumCount) : 0;
    const buffer = this.out.buffer;
    this.port.postMessage({ pcm: buffer, rms }, [buffer]);
    this.out = new Int16Array(this.flushSamples);
    this.outLength = 0;
    this.sumSquares = 0;
    this.sumCount = 0;
  }
}
registerProcessor(${JSON.stringify(CAPTURE_WORKLET_NAME)}, PaseoCaptureProcessor);
`;

const loadedContexts = new WeakSet<BaseAudioContext>();

/** Registers the capture processor on a context; resolves false where worklets are unavailable. */
export async function loadCaptureWorklet(context: AudioContext): Promise<boolean> {
  if (loadedContexts.has(context)) {
    return true;
  }
  if (
    typeof AudioWorkletNode === "undefined" ||
    !context.audioWorklet ||
    typeof Blob === "undefined" ||
    typeof URL === "undefined" ||
    context.sampleRate < CAPTURE_TARGET_RATE
  ) {
    return false;
  }
  const url = URL.createObjectURL(new Blob([CAPTURE_WORKLET_SOURCE], { type: "text/javascript" }));
  try {
    await context.audioWorklet.addModule(url);
    loadedContexts.add(context);
    return true;
  } catch (error) {
    console.warn("[AudioEngine] Capture worklet unavailable, using the main thread:", error);
    return false;
  } finally {
    URL.revokeObjectURL(url);
  }
}
