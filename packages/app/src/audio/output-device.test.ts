import { afterEach, describe, expect, it, vi } from "vitest";
import {
  applyAudioOutputDevice,
  getPreferredAudioOutputDevice,
  listAudioOutputDevices,
  setPreferredAudioOutputDevice,
  subscribeAudioOutputDevice,
} from "./output-device";

describe("preferred audio output device", () => {
  afterEach(() => setPreferredAudioOutputDevice(""));

  it("notifies subscribers only when the device changes", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeAudioOutputDevice(listener);
    setPreferredAudioOutputDevice("speakers");
    setPreferredAudioOutputDevice("speakers");
    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith("speakers");
    expect(getPreferredAudioOutputDevice()).toBe("speakers");
    unsubscribe();
    setPreferredAudioOutputDevice("headset");
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe("applyAudioOutputDevice", () => {
  it("routes the context to the chosen device", async () => {
    const setSinkId = vi.fn(async () => {});
    expect(await applyAudioOutputDevice({ setSinkId }, "speakers")).toBe(true);
    expect(setSinkId).toHaveBeenCalledWith("speakers");
  });

  it("falls back to the system default when the device is gone", async () => {
    const setSinkId = vi.fn(async (id: string) => {
      if (id !== "") throw new Error("NotFoundError");
    });
    expect(await applyAudioOutputDevice({ setSinkId }, "unplugged")).toBe(false);
    expect(setSinkId).toHaveBeenLastCalledWith("");
  });

  it("does nothing where the browser cannot choose a device", async () => {
    expect(await applyAudioOutputDevice({}, "speakers")).toBe(false);
  });
});

describe("listAudioOutputDevices", () => {
  it("keeps only real output devices", async () => {
    const devices = await listAudioOutputDevices({
      enumerateDevices: async () =>
        [
          { kind: "audioinput", deviceId: "mic", label: "Mic" },
          { kind: "audiooutput", deviceId: "default", label: "Default" },
          { kind: "audiooutput", deviceId: "communications", label: "Comms" },
          { kind: "audiooutput", deviceId: "speakers", label: "Speakers" },
        ] as MediaDeviceInfo[],
    });
    expect(devices).toEqual([{ deviceId: "speakers", label: "Speakers" }]);
  });

  it("returns nothing without media devices", async () => {
    expect(await listAudioOutputDevices(undefined)).toEqual([]);
  });
});
