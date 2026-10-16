import { useCallback, useEffect, useMemo, useState } from "react";
import { Platform } from "react-native";
import { useTranslation } from "react-i18next";
import { SettingsCard, SettingsSection, SettingsSelect } from "@/components/settings";
import { useAppSettings } from "@/hooks/use-settings";
import { listAudioOutputDevices, type AudioOutputDevice } from "@/audio/output-device";

function useAudioOutputDevices(): AudioOutputDevice[] | null {
  const [devices, setDevices] = useState<AudioOutputDevice[] | null>(null);
  useEffect(() => {
    if (Platform.OS !== "web" || typeof navigator === "undefined" || !navigator.mediaDevices) {
      return undefined;
    }
    let cancelled = false;
    const refresh = () => {
      listAudioOutputDevices()
        .then((next) => {
          if (!cancelled) setDevices(next);
        })
        .catch(() => {
          if (!cancelled) setDevices([]);
        });
    };
    refresh();
    navigator.mediaDevices.addEventListener?.("devicechange", refresh);
    return () => {
      cancelled = true;
      navigator.mediaDevices.removeEventListener?.("devicechange", refresh);
    };
  }, []);
  return devices;
}

export function AudioOutputSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useAppSettings();
  const devices = useAudioOutputDevices();
  const selected = settings.audioOutputDeviceId;

  const options = useMemo(() => {
    const list = [{ value: "", label: t("settings.general.audioOutput.systemDefault") }];
    (devices ?? []).forEach((device, index) => {
      list.push({
        value: device.deviceId,
        label:
          device.label || t("settings.general.audioOutput.deviceFallback", { number: index + 1 }),
      });
    });
    if (selected !== "" && !list.some((option) => option.value === selected)) {
      list.push({ value: selected, label: t("settings.general.audioOutput.unavailable") });
    }
    return list;
  }, [devices, selected, t]);

  const change = useCallback(
    (audioOutputDeviceId: string) => void updateSettings({ audioOutputDeviceId }),
    [updateSettings],
  );

  if (devices === null) {
    return null;
  }

  return (
    <SettingsSection title={t("settings.general.audioOutput.title")}>
      <SettingsCard>
        <SettingsSelect
          label={t("settings.general.audioOutput.label")}
          hint={t("settings.general.audioOutput.hint")}
          value={selected}
          options={options}
          onValueChange={change}
        />
      </SettingsCard>
    </SettingsSection>
  );
}
