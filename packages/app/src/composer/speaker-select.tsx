import { ChevronDown } from "lucide-react-native";
import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Theme } from "@/styles/theme";
import {
  COMPOSER_SPEAKERS,
  useComposerSpeaker,
  useComposerSpeakerStore,
  type ComposerSpeaker,
} from "@/stores/composer-speaker-store";

const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedChevronMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * Names who the next message comes from. The speaker is a prefix on what the composer sends, so a
 * transcript written on one machine can carry several people's remarks and be read apart later.
 */
export function ComposerSpeakerSelect() {
  const { t } = useTranslation();
  const speaker = useComposerSpeaker();
  const setSpeaker = useComposerSpeakerStore((state) => state.setSpeaker);

  return (
    <DropdownMenu compactMode="sheet">
      <DropdownMenuTrigger
        hitSlop={8}
        accessibilityLabel={t("composer.speaker.label")}
        testID="composer-speaker-trigger"
        style={styles.trigger}
      >
        <Text style={styles.label} numberOfLines={1}>
          {t("composer.speaker.label")}
        </Text>
        <Text style={styles.value} numberOfLines={1}>
          {speaker ?? t("composer.speaker.empty")}
        </Text>
        <ThemedChevronDown size={12} uniProps={mutedChevronMapping} />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" width={180} sheetTitle={t("composer.speaker.label")}>
        <SpeakerOption value={null} label={t("composer.speaker.empty")} onSelect={setSpeaker} />
        {COMPOSER_SPEAKERS.map((value) => (
          <SpeakerOption key={value} value={value} label={value} onSelect={setSpeaker} />
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SpeakerOption({
  value,
  label,
  onSelect,
}: {
  value: ComposerSpeaker | null;
  label: string;
  onSelect: (speaker: ComposerSpeaker | null) => void;
}) {
  const handleSelect = useCallback(() => {
    onSelect(value);
  }, [onSelect, value]);

  return (
    <DropdownMenuItem testID={`composer-speaker-${value ?? "empty"}`} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    height: 24,
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.sm,
    flexShrink: 0,
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
  },
  value: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
    lineHeight: 16,
    fontWeight: theme.fontWeight.medium,
  },
}));
