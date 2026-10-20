import { useCallback, useRef, useState, type ReactElement } from "react";
import {
  Text,
  View,
  type NativeSyntheticEvent,
  type TextInputKeyPressEventData,
} from "react-native";
import { ChevronDown, ChevronUp, Search } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { EditingTextInput, type EditingTextInputHandle } from "@/components/ui/text-input";
import { ToolbarButton } from "@/components/ui/pane-content-toolbar";
import { useSidebarFind } from "@/components/sidebar/sidebar-find";
import { isImeComposingKeyboardEvent } from "@/utils/keyboard-ime";
import type { Theme } from "@/styles/theme";

const ThemedSearch = withUnistyles(Search);
const ThemedTextInput = withUnistyles(EditingTextInput, (theme: Theme) => ({
  placeholderTextColor: theme.colors.foregroundMuted,
  selectionColor: theme.colors.foreground,
}));
const ThemedChevronUp = withUnistyles(ChevronUp);
const ThemedChevronDown = withUnistyles(ChevronDown);
const mutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/**
 * The find row pinned above the workspace list. It never filters: it points at the first row whose
 * project or workspace name holds the text, and each further Enter walks to the next one.
 */
export function SidebarFindBar(): ReactElement | null {
  const find = useSidebarFind();
  const { t } = useTranslation();
  const inputRef = useRef<EditingTextInputHandle>(null);
  const [isFocused, setIsFocused] = useState(false);

  const handleFocus = useCallback(() => setIsFocused(true), []);
  const handleBlur = useCallback(() => setIsFocused(false), []);
  const handlePrevious = useCallback(() => find?.step(-1), [find]);
  const handleNext = useCallback(() => find?.step(1), [find]);

  const handleKeyPress = useCallback(
    (event: NativeSyntheticEvent<TextInputKeyPressEventData>) => {
      const key = event.nativeEvent as TextInputKeyPressEventData & {
        shiftKey?: boolean;
        isComposing?: boolean;
      };
      if (isImeComposingKeyboardEvent(key)) return;
      if (key.key === "Escape") {
        event.preventDefault();
        inputRef.current?.replaceText("");
        find?.clear();
      } else if (key.key === "Enter") {
        event.preventDefault();
        find?.step(key.shiftKey ? -1 : 1);
      }
    },
    [find],
  );

  if (!find) return null;

  const hasQuery = find.query.trim().length > 0;
  const hasMatches = find.matches.length > 0;

  return (
    <View style={styles.bar}>
      <View style={[styles.field, isFocused && styles.fieldFocused]}>
        <ThemedSearch size={13} uniProps={mutedColorMapping} />
        <ThemedTextInput
          ref={inputRef}
          initialValue=""
          onChangeText={find.setQuery}
          onKeyPress={handleKeyPress}
          onFocus={handleFocus}
          onBlur={handleBlur}
          placeholder={t("sidebar.find.placeholder")}
          accessibilityLabel={t("sidebar.find.label")}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="off"
          spellCheck={false}
          testID="sidebar-find-input"
          style={styles.input}
        />
        {hasQuery ? (
          <Text style={styles.count} testID="sidebar-find-count">
            {hasMatches
              ? t("sidebar.find.count", {
                  index: find.activeIndex + 1,
                  total: find.matches.length,
                })
              : t("sidebar.find.noMatches")}
          </Text>
        ) : null}
        {hasQuery ? (
          <>
            <ToolbarButton
              label={t("sidebar.find.previous")}
              onPress={handlePrevious}
              compact
              testID="sidebar-find-previous"
            >
              <ThemedChevronUp size={13} uniProps={mutedColorMapping} />
            </ToolbarButton>
            <ToolbarButton
              label={t("sidebar.find.next")}
              onPress={handleNext}
              compact
              testID="sidebar-find-next"
            >
              <ThemedChevronDown size={13} uniProps={mutedColorMapping} />
            </ToolbarButton>
          </>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  bar: {
    paddingHorizontal: theme.spacing[2],
    paddingTop: theme.spacing[1],
    paddingBottom: theme.spacing[1],
  },
  field: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[1.5],
    borderRadius: theme.borderRadius.md,
    borderWidth: theme.borderWidth[1],
    borderColor: theme.colors.border,
  },
  fieldFocused: {
    borderColor: theme.colors.borderAccent,
  },
  input: {
    flex: 1,
    minWidth: 0,
    padding: 0,
    height: 18,
    // The browser's focus ring would sit inside the field's own focus border.
    outlineWidth: 0,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.sm,
  },
  count: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontVariant: ["tabular-nums"],
  },
}));
