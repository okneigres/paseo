// The playback device is chosen in settings but used deep inside the audio
// engine, so the choice lives here: the engine applies it to the context it
// plays through and follows later changes.

type Listener = (deviceId: string) => void;

let preferredDeviceId = "";
const listeners = new Set<Listener>();

export function getPreferredAudioOutputDevice(): string {
  return preferredDeviceId;
}

export function setPreferredAudioOutputDevice(deviceId: string): void {
  if (deviceId === preferredDeviceId) {
    return;
  }
  preferredDeviceId = deviceId;
  for (const listener of Array.from(listeners)) {
    listener(deviceId);
  }
}

export function subscribeAudioOutputDevice(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

interface SinkSelectableContext {
  setSinkId?: (sinkId: string) => Promise<void>;
}

/**
 * Route a context to a device. An unplugged or unknown device falls back to the
 * system default instead of leaving the voice silent.
 */
export async function applyAudioOutputDevice(context: object, deviceId: string): Promise<boolean> {
  // The DOM typings of some toolchains predate AudioContext.setSinkId.
  const target = context as SinkSelectableContext;
  if (typeof target.setSinkId !== "function") {
    return false;
  }
  try {
    await target.setSinkId(deviceId);
    return true;
  } catch {
    if (deviceId === "") {
      return false;
    }
    try {
      await target.setSinkId("");
    } catch {
      // Keep whatever the context was already using.
    }
    return false;
  }
}

export interface AudioOutputDevice {
  deviceId: string;
  label: string;
}

/** Output devices the browser can see; labels stay empty until microphone access is granted. */
export async function listAudioOutputDevices(
  mediaDevices: Pick<MediaDevices, "enumerateDevices"> | undefined = typeof navigator !==
  "undefined"
    ? navigator.mediaDevices
    : undefined,
): Promise<AudioOutputDevice[]> {
  if (!mediaDevices?.enumerateDevices) {
    return [];
  }
  const devices = await mediaDevices.enumerateDevices();
  return devices
    .filter((device) => device.kind === "audiooutput" && device.deviceId !== "default")
    .filter((device) => device.deviceId !== "communications")
    .map((device) => ({ deviceId: device.deviceId, label: device.label }));
}
