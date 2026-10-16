import { parsePcmSampleRate, resampleToPcm16 } from "./pcm";
import { isElectronRuntime } from "@/desktop/host";
import type { AudioEngine, AudioEngineCallbacks, AudioPlaybackSource } from "./audio-engine-types";

import { createPlaybackQueue } from "./playback";
import { CAPTURE_TARGET_RATE, CAPTURE_WORKLET_NAME, loadCaptureWorklet } from "./capture-worklet";
import {
  applyAudioOutputDevice,
  getPreferredAudioOutputDevice,
  subscribeAudioOutputDevice,
} from "./output-device";

function getAudioContextCtor(): typeof AudioContext | null {
  if (typeof window === "undefined") {
    return null;
  }
  const browserWindow = window as typeof window & {
    webkitAudioContext?: typeof AudioContext;
  };
  return browserWindow.AudioContext ?? browserWindow.webkitAudioContext ?? null;
}

function pcm16LeToAudioBuffer(
  context: AudioContext,
  bytes: Uint8Array,
  sampleRate: number,
): AudioBuffer {
  const sampleCount = Math.floor(bytes.length / 2);
  const audioBuffer = context.createBuffer(1, sampleCount, sampleRate);
  const channel = audioBuffer.getChannelData(0);
  for (let i = 0; i < sampleCount; i += 1) {
    const lo = bytes[i * 2];
    const hi = bytes[i * 2 + 1];
    let value = (hi << 8) | lo;
    if (value & 0x8000) {
      value -= 0x10000;
    }
    channel[i] = value / 0x8000;
  }
  return audioBuffer;
}

async function decodeAudioData(context: AudioContext, buffer: ArrayBuffer): Promise<AudioBuffer> {
  const maybePromise = context.decodeAudioData(buffer.slice(0));
  if (maybePromise && typeof maybePromise.then === "function") {
    return maybePromise;
  }
  return await new Promise<AudioBuffer>((resolve, reject) => {
    context.decodeAudioData(buffer.slice(0), resolve, reject);
  });
}

export function createAudioEngine(
  callbacks: AudioEngineCallbacks,
  _options?: { traceLabel?: string },
): AudioEngine {
  const refs: {
    playbackContext: AudioContext | null;
    captureContext: AudioContext | null;
    stream: MediaStream | null;
    source: MediaStreamAudioSourceNode | null;
    processor: AudioNode | null;
    gain: GainNode | null;
    started: boolean;
    muted: boolean;
  } = {
    playbackContext: null,
    captureContext: null,
    stream: null,
    source: null,
    processor: null,
    gain: null,
    started: false,
    muted: false,
  };

  async function ensurePlaybackContext(): Promise<AudioContext> {
    if (!refs.playbackContext) {
      const AudioContextCtor = getAudioContextCtor();
      if (!AudioContextCtor) throw new Error("AudioContext unavailable");
      const created = new AudioContextCtor();
      refs.playbackContext = created;
      const deviceId = getPreferredAudioOutputDevice();
      if (deviceId !== "") {
        void applyAudioOutputDevice(created, deviceId);
      }
    }
    const context = refs.playbackContext;
    if (context.state === "suspended") {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          context.resume(),
          new Promise<never>((_resolve, reject) => {
            timeout = setTimeout(
              () => reject(new Error("Audio playback requires a user interaction")),
              2000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timeout);
      }
    }
    return context;
  }

  const unsubscribeOutputDevice = subscribeAudioOutputDevice((deviceId) => {
    if (refs.playbackContext) {
      void applyAudioOutputDevice(refs.playbackContext, deviceId);
    }
  });

  async function ensureCaptureContext(): Promise<AudioContext> {
    if (refs.captureContext) {
      if (refs.captureContext.state === "suspended") {
        await refs.captureContext.resume().catch(() => undefined);
      }
      return refs.captureContext;
    }

    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error("AudioContext unavailable");
    }

    const context = new AudioContextCtor();
    if (context.state === "suspended") {
      await context.resume().catch(() => undefined);
    }
    refs.captureContext = context;
    return context;
  }

  async function playAudio(audio: AudioPlaybackSource, signal: AbortSignal): Promise<number> {
    const context = await ensurePlaybackContext();
    const arrayBuffer = await audio.arrayBuffer();
    const type = (audio.type || "").toLowerCase();
    const audioBuffer = type.startsWith("audio/pcm")
      ? pcm16LeToAudioBuffer(
          context,
          new Uint8Array(arrayBuffer),
          parsePcmSampleRate(type) ?? 24000,
        )
      : await decodeAudioData(context, arrayBuffer);

    if (signal.aborted) throw new Error("Playback stopped");
    const durationSec = audioBuffer.duration;
    const source = context.createBufferSource();
    source.buffer = audioBuffer;
    source.connect(context.destination);

    return await new Promise<number>((resolve, reject) => {
      const abort = () => {
        source.stop();
        source.disconnect();
        reject(new Error("Playback stopped"));
      };
      signal.addEventListener("abort", abort, { once: true });
      source.addEventListener(
        "ended",
        () => {
          signal.removeEventListener("abort", abort);
          source.disconnect();
          resolve(durationSec);
        },
        { once: true },
      );
      try {
        source.start();
      } catch (error) {
        signal.removeEventListener("abort", abort);
        source.disconnect();
        reject(error);
      }
    });
  }

  const playback = createPlaybackQueue(playAudio);

  async function stopCapture(): Promise<void> {
    refs.started = false;

    try {
      const workletPort = (refs.processor as { port?: MessagePort } | null)?.port;
      if (workletPort) {
        workletPort.onmessage = null;
        workletPort.close();
      }
      refs.processor?.disconnect();
      refs.source?.disconnect();
      refs.gain?.disconnect();
    } catch {
      // Ignore best-effort teardown errors.
    }

    if (refs.stream) {
      for (const track of refs.stream.getTracks()) {
        try {
          track.stop();
        } catch {
          // Ignore best-effort teardown errors.
        }
      }
    }

    refs.stream = null;
    refs.source = null;
    refs.processor = null;
    refs.gain = null;
    refs.muted = false;
    callbacks.onVolumeLevel(0);

    const captureContext = refs.captureContext;
    refs.captureContext = null;
    if (captureContext && captureContext.state !== "closed") {
      await captureContext.close().catch(() => undefined);
    }
  }

  return {
    async initialize() {
      await ensurePlaybackContext();
    },

    async destroy() {
      unsubscribeOutputDevice();
      playback.destroy();
      await stopCapture();

      const playbackContext = refs.playbackContext;
      refs.playbackContext = null;
      if (playbackContext && playbackContext.state !== "closed") {
        await playbackContext.close().catch(() => undefined);
      }
    },

    async startCapture() {
      if (refs.started) {
        return;
      }

      const missingNavigator =
        typeof navigator === "undefined" ||
        !navigator.mediaDevices ||
        typeof navigator.mediaDevices.getUserMedia !== "function";
      const secureContext =
        typeof window !== "undefined" && typeof window.isSecureContext === "boolean"
          ? window.isSecureContext
          : true;
      const currentOrigin =
        typeof window !== "undefined" && window.location ? window.location.origin : "unknown";
      const isDesktopApp = isElectronRuntime();

      if (missingNavigator) {
        throw new Error("Microphone capture is not supported in this environment");
      }
      if (!secureContext && !isDesktopApp) {
        throw new Error(
          `Microphone access requires HTTPS or localhost. Current origin: ${currentOrigin}`,
        );
      }

      try {
        const context = await ensureCaptureContext();
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            channelCount: 1,
            noiseSuppression: true,
            echoCancellation: true,
            autoGainControl: true,
          },
        });
        const source = context.createMediaStreamSource(stream);
        const gain = context.createGain();
        gain.gain.value = 0;

        const handleVolume = (rms: number) => {
          callbacks.onVolumeLevel(Math.min(1, Math.max(0, rms * 2)));
        };

        let processor: AudioNode;
        if (await loadCaptureWorklet(context)) {
          const node = new AudioWorkletNode(context, CAPTURE_WORKLET_NAME, {
            numberOfInputs: 1,
            numberOfOutputs: 1,
            outputChannelCount: [1],
            processorOptions: { targetRate: CAPTURE_TARGET_RATE },
          });
          node.port.onmessage = (event: MessageEvent<{ pcm: ArrayBuffer; rms: number }>) => {
            if (!refs.started) {
              return;
            }
            handleVolume(event.data.rms);
            if (refs.muted) {
              return;
            }
            callbacks.onCaptureData(new Uint8Array(event.data.pcm));
          };
          processor = node;
        } else {
          const scriptProcessor = context.createScriptProcessor(4096, 1, 1);
          scriptProcessor.onaudioprocess = (event) => {
            if (!refs.started) {
              return;
            }

            const input = event.inputBuffer.getChannelData(0);
            let sumSquares = 0;
            for (let i = 0; i < input.length; i += 1) {
              const sample = input[i];
              sumSquares += sample * sample;
            }
            handleVolume(Math.sqrt(sumSquares / Math.max(1, input.length)));

            if (refs.muted) {
              return;
            }

            const pcm = resampleToPcm16(input, context.sampleRate, CAPTURE_TARGET_RATE);
            callbacks.onCaptureData(new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength));
          };
          processor = scriptProcessor;
        }

        source.connect(processor);
        processor.connect(gain);
        gain.connect(context.destination);

        refs.started = true;
        refs.stream = stream;
        refs.source = source;
        refs.processor = processor;
        refs.gain = gain;
      } catch (error) {
        await stopCapture();
        const wrapped = error instanceof Error ? error : new Error(String(error));
        callbacks.onError?.(wrapped);
        throw wrapped;
      }
    },

    async stopCapture() {
      await stopCapture();
    },

    toggleMute() {
      refs.muted = !refs.muted;
      if (refs.muted) {
        callbacks.onVolumeLevel(0);
      }
      return refs.muted;
    },

    isMuted() {
      return refs.muted;
    },

    play: playback.play,
    stop: playback.stop,
    clearQueue: playback.clearQueue,
    isPlaying: playback.isPlaying,
  };
}
