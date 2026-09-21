import { memo, useCallback, useMemo, useState, type Ref } from "react";
import { useTranslation } from "react-i18next";
import {
  Text,
  View,
  type GestureResponderEvent,
  type PressableStateCallbackType,
} from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { MoreVertical, Pencil, SeparatorHorizontal, Trash2 } from "lucide-react-native";
import { AdaptiveRenameModal } from "@/components/rename-modal";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PressHighlight } from "@/components/ui/press-highlight";
import { isWeb } from "@/constants/platform";
import { useLongPressDragInteraction } from "@/components/sidebar/use-long-press-drag-interaction";
import type { DraggableListDragHandleProps } from "@/components/draggable-list.types";
import type { SidebarSeparator } from "@/stores/sidebar-separators-store";
import type { Theme } from "@/styles/theme";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundColorMapping = (theme: Theme) => ({ color: theme.colors.foreground });

const ThemedMoreVertical = withUnistyles(MoreVertical);
const ThemedSeparatorHorizontal = withUnistyles(SeparatorHorizontal);
const ThemedPencil = withUnistyles(Pencil);
const ThemedTrash2 = withUnistyles(Trash2);

const renameLeadingIcon = <ThemedPencil size={14} uniProps={foregroundMutedColorMapping} />;
const removeLeadingIcon = <ThemedTrash2 size={14} uniProps={foregroundMutedColorMapping} />;

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }) {
  return (
    <ThemedMoreVertical
      size={14}
      uniProps={hovered ? foregroundColorMapping : foregroundMutedColorMapping}
    />
  );
}

/**
 * A separator between projects: a rule with the user's own label on it.
 *
 * It is a row like any other in the project list, so it takes that list's pitch, its drag
 * interaction, and its hover fills — a separator that only looked draggable would be worse than
 * no separator at all.
 */
export const SidebarSeparatorRow = memo(function SidebarSeparatorRow({
  separator,
  drag,
  isDragging = false,
  dragHandleProps,
  onRename,
  onRemove,
}: {
  separator: SidebarSeparator;
  drag?: () => void;
  isDragging?: boolean;
  dragHandleProps?: DraggableListDragHandleProps;
  onRename: (id: string, label: string) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  const [isHovered, setIsHovered] = useState(false);
  const [isPressed, setIsPressed] = useState(false);
  const [isRenameOpen, setIsRenameOpen] = useState(false);
  const interaction = useLongPressDragInteraction({ drag: drag ?? noop, menuController: null });
  const {
    role: _dragRole,
    tabIndex: _dragTabIndex,
    "aria-roledescription": _dragRoleDescription,
    ...dragAttributes
  } = dragHandleProps?.attributes ?? {};

  const handlePress = useCallback(() => {
    if (interaction.didLongPressRef.current) {
      interaction.didLongPressRef.current = false;
      return;
    }
    setIsRenameOpen(true);
  }, [interaction.didLongPressRef]);
  const handlePressIn = useCallback(
    (event: GestureResponderEvent) => {
      setIsPressed(true);
      if (drag) {
        interaction.handlePressIn(event);
      }
    },
    [drag, interaction],
  );
  const handlePressOut = useCallback(() => {
    setIsPressed(false);
    if (drag) {
      interaction.handlePressOut();
    }
  }, [drag, interaction]);
  const handleSubmitRename = useCallback(
    (label: string) => {
      onRename(separator.id, label);
    },
    [onRename, separator.id],
  );
  const handleCloseRename = useCallback(() => setIsRenameOpen(false), []);
  const handleOpenRename = useCallback(() => setIsRenameOpen(true), []);
  const handlePointerEnter = useCallback(() => setIsHovered(true), []);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleSubmit = useCallback(
    (value: string) => {
      handleSubmitRename(value);
      setIsRenameOpen(false);
    },
    [handleSubmitRename],
  );
  const handleRemove = useCallback(() => {
    onRemove(separator.id);
  }, [onRemove, separator.id]);

  const rowStyle = useCallback(
    ({ hovered = false, pressed }: PressableStateCallbackType & { hovered?: boolean }) => [
      styles.row,
      isDragging && styles.rowDragging,
      (hovered || isHovered) && !pressed && styles.rowHovered,
      (pressed || isPressed) && styles.rowPressed,
    ],
    [isDragging, isHovered, isPressed],
  );

  const label = useMemo(
    () =>
      separator.label.trim().length > 0 ? separator.label : t("sidebar.separator.defaultLabel"),
    [separator.label, t],
  );

  return (
    <>
      <View
        {...dragAttributes}
        {...dragHandleProps?.listeners}
        ref={dragHandleProps?.setActivatorNodeRef as unknown as Ref<View>}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
      >
        <PressHighlight
          accessibilityRole={isWeb ? undefined : "button"}
          accessibilityLabel={label}
          style={rowStyle}
          highlightStyle={styles.rowPressed}
          onPressIn={handlePressIn}
          onTouchMove={drag ? interaction.handleTouchMove : undefined}
          onPressOut={handlePressOut}
          onPress={handlePress}
          testID={`sidebar-separator-row-${separator.id}`}
        >
          <View style={styles.leadingSlot}>
            <ThemedSeparatorHorizontal size={14} uniProps={foregroundMutedColorMapping} />
          </View>
          <Text style={styles.label} numberOfLines={1}>
            {label}
          </Text>
          <View style={styles.rule} />
          <View
            style={!isHovered && styles.kebabHidden}
            pointerEvents={isHovered ? "auto" : "none"}
          >
            <DropdownMenu compactMode="sheet">
              <DropdownMenuTrigger
                hitSlop={8}
                style={styles.kebab}
                accessibilityRole={isWeb ? undefined : "button"}
                accessibilityLabel={t("sidebar.separator.actions.menu")}
                testID={`sidebar-separator-kebab-${separator.id}`}
              >
                {renderKebabTriggerIcon}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                width={220}
                sheetTitle={t("sidebar.separator.actions.menu")}
              >
                <DropdownMenuItem
                  leading={renameLeadingIcon}
                  testID={`sidebar-separator-rename-${separator.id}`}
                  onSelect={handleOpenRename}
                >
                  {t("sidebar.separator.actions.rename")}
                </DropdownMenuItem>
                <DropdownMenuItem
                  leading={removeLeadingIcon}
                  testID={`sidebar-separator-remove-${separator.id}`}
                  onSelect={handleRemove}
                >
                  {t("sidebar.separator.actions.remove")}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        </PressHighlight>
      </View>
      <AdaptiveRenameModal
        visible={isRenameOpen}
        title={t("sidebar.separator.renameTitle")}
        initialValue={separator.label}
        placeholder={t("sidebar.separator.defaultLabel")}
        onClose={handleCloseRename}
        onSubmit={handleSubmit}
        testID={`sidebar-separator-rename-modal-${separator.id}`}
      />
    </>
  );
});

function noop() {}

const styles = StyleSheet.create((theme) => ({
  // Kept in step with `workspaceRow` in sidebar-workspace-list.tsx: a separator sits in the same
  // list as the project blocks, so it takes that row's geometry, fills, and pitch.
  row: {
    minHeight: 24,
    marginBottom: 0,
    paddingVertical: theme.spacing[0.5],
    paddingLeft: theme.spacing[2],
    paddingRight: theme.spacing[3],
    borderRadius: theme.borderRadius.lg,
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    userSelect: "none",
  },
  rowHovered: {
    backgroundColor: theme.colors.surfaceSidebarHover,
  },
  rowPressed: {
    backgroundColor: theme.colors.surface2,
  },
  rowDragging: {
    backgroundColor: theme.colors.surface2,
    borderWidth: 1,
    borderColor: theme.colors.border,
    transform: [{ scale: 1.02 }],
    zIndex: 3,
    ...theme.shadow.md,
  },
  // The same width as a workspace row's leading glyph, so the label starts on the rail the
  // project names use.
  leadingSlot: {
    width: theme.iconSize.md,
    height: 20,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  label: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    lineHeight: 20,
    flexShrink: 0,
    maxWidth: "70%",
  },
  rule: {
    flex: 1,
    minWidth: 0,
    height: 1,
    backgroundColor: theme.colors.border,
  },
  kebab: {
    width: 20,
    height: 20,
    borderRadius: theme.borderRadius.md,
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
    marginRight: -6,
  },
  kebabHidden: {
    opacity: 0,
  },
}));
