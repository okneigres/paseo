import { useCallback } from "react";
import { Text, View } from "react-native";
import { Minus, Plus } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { extraMutedIconColorMapping } from "@/components/ui/icon-button-chrome";
import { LoadingSpinner } from "@/components/ui/loading-spinner";
import {
  paneContentToolbarIconSize,
  PaneContentToolbar,
  ToolbarButton,
} from "@/components/ui/pane-content-toolbar";
import { SegmentedControl } from "@/components/ui/segmented-control";
import { MAX_PROSE_FONT_SIZE, MIN_PROSE_FONT_SIZE } from "@/hooks/use-settings";
import type { Theme } from "@/styles/theme";
import { FileConflictAlert, type FileConflictAlertState } from "./conflict-alert";
import type { FileEditorStatus } from "./editor/model";

const ThemedSpinner = withUnistyles(LoadingSpinner);
const ThemedMinus = withUnistyles(Minus);
const ThemedPlus = withUnistyles(Plus);
const spinnerMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });

/** Steps the size the prose files read at, within the bounds the setting is kept in. */
function ProseSizeStepper({ size, onChange }: { size: number; onChange: (size: number) => void }) {
  const { t } = useTranslation();
  const iconSize = paneContentToolbarIconSize(false);
  const decrease = useCallback(() => onChange(size - 1), [onChange, size]);
  const increase = useCallback(() => onChange(size + 1), [onChange, size]);
  return (
    <View style={styles.proseSize}>
      <ToolbarButton
        label={t("panels.file.editor.decreaseProseSize")}
        testID="file-prose-size-decrease"
        disabled={size <= MIN_PROSE_FONT_SIZE}
        onPress={decrease}
      >
        <ThemedMinus size={iconSize} uniProps={extraMutedIconColorMapping} />
      </ToolbarButton>
      <Text
        style={styles.whisper}
        accessibilityLabel={t("panels.file.editor.proseSize", { size })}
        testID="file-prose-size"
      >
        {size}
      </Text>
      <ToolbarButton
        label={t("panels.file.editor.increaseProseSize")}
        testID="file-prose-size-increase"
        disabled={size >= MAX_PROSE_FONT_SIZE}
        onPress={increase}
      >
        <ThemedPlus size={iconSize} uniProps={extraMutedIconColorMapping} />
      </ToolbarButton>
    </View>
  );
}

export function FilePanelBar({
  size,
  lineCount,
  mode,
  onModeChange,
  editorStatus,
  cursor,
  vimMode,
  conflict,
  proseSize,
  onProseSizeChange,
}: {
  size: number;
  lineCount?: number;
  mode?: "preview" | "source";
  onModeChange?(mode: "preview" | "source"): void;
  editorStatus?: FileEditorStatus;
  cursor?: { line: number; column: number };
  vimMode?: string | null;
  conflict?: FileConflictAlertState;
  /** Set for the files that read as prose, which is where the size applies. */
  proseSize?: number;
  onProseSizeChange?(size: number): void;
}) {
  const { t } = useTranslation();
  const previewModes = [
    {
      value: "preview" as const,
      label: t("panels.file.editor.preview"),
      testID: "file-mode-preview",
    },
    { value: "source" as const, label: t("panels.file.editor.source"), testID: "file-mode-source" },
  ];
  return (
    <View style={styles.chrome}>
      <PaneContentToolbar testID="file-panel-bar">
        <View style={styles.row}>
          <View style={styles.metadata}>
            <Text
              style={styles.whisper}
              accessibilityLabel={t("panels.file.editor.fileSize", { size: formatFileSize(size) })}
            >
              {formatFileSize(size)}
            </Text>
            {lineCount !== undefined ? (
              <Text
                style={styles.whisper}
                accessibilityLabel={t("panels.file.editor.lines", { count: lineCount })}
              >
                {t("panels.file.editor.lines", { count: lineCount })}
              </Text>
            ) : null}
          </View>
          <View
            style={styles.status}
            accessibilityLabel={
              editorStatus
                ? t("panels.file.editor.editorStatus", { status: editorStatus })
                : undefined
            }
          >
            {editorStatus === "dirty" ? (
              <View
                style={styles.dirtyDot}
                accessibilityLabel={t("panels.file.editor.unsavedChanges")}
              />
            ) : null}
            {editorStatus === "saving" ? (
              <>
                <ThemedSpinner size={14} uniProps={spinnerMapping} />
                <Text style={styles.secondary}>{t("panels.file.editor.saving")}</Text>
              </>
            ) : null}
            {editorStatus === "error" ? (
              <Text style={styles.error}>{t("panels.file.editor.saveFailed")}</Text>
            ) : null}
            {vimMode ? (
              <Text
                style={styles.vim}
                accessibilityLabel={t("panels.file.editor.vimMode", { mode: vimMode })}
              >
                {vimMode}
              </Text>
            ) : null}
            {cursor ? (
              <Text
                style={styles.whisper}
                accessibilityLabel={t("panels.file.editor.cursor", cursor)}
              >
                Ln {cursor.line}, Col {cursor.column}
              </Text>
            ) : null}
          </View>
          {proseSize !== undefined && onProseSizeChange ? (
            <ProseSizeStepper size={proseSize} onChange={onProseSizeChange} />
          ) : null}
          {mode && onModeChange ? (
            <SegmentedControl
              size="xs"
              value={mode}
              onValueChange={onModeChange}
              testID="file-preview-mode"
              options={previewModes}
            />
          ) : null}
        </View>
      </PaneContentToolbar>
      {conflict ? <FileConflictAlert state={conflict} /> : null}
    </View>
  );
}

function formatFileSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const styles = StyleSheet.create((theme) => ({
  chrome: {
    flexShrink: 0,
  },
  row: {
    height: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    paddingHorizontal: theme.spacing[3],
  },
  metadata: {
    flex: 1,
    minWidth: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  secondary: { color: theme.colors.foregroundMuted, fontSize: theme.fontSize.sm },
  whisper: { color: theme.colors.foregroundExtraMuted, fontSize: theme.fontSize.sm },
  error: { color: theme.colors.palette.red[300], fontSize: theme.fontSize.sm },
  dirtyDot: {
    width: 6,
    height: 6,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundExtraMuted,
  },
  status: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
  proseSize: {
    flexShrink: 0,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  vim: {
    color: theme.colors.foregroundMuted,
    fontFamily: theme.fontFamily.mono,
    fontSize: theme.fontSize.sm,
  },
}));
