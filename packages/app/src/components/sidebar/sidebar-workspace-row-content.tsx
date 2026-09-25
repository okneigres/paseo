import { memo, useMemo, useCallback, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Pressable, Text, View, type GestureResponderEvent, type ViewStyle } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import {
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Folder,
  FolderGit2,
  Monitor,
} from "lucide-react-native";
import type { SidebarSurfaceBackdrop } from "@/styles/surface-backdrop";
import {
  WorkspaceMetaRow,
  type WorkspaceServiceSummary,
} from "@/components/sidebar/workspace-meta-row";
import { WorkspaceHoverCard } from "@/components/workspace-hover-card";
import type { HostBadgeModel } from "@/hosts/appearance";
import type { SidebarWorkspaceEntry } from "@/hooks/use-sidebar-workspaces-list";
import {
  hasSidebarWorkspaceTrailing,
  type SidebarWorkspaceTrailing,
} from "@/components/sidebar/workspace-trailing";
import { useAppSettings } from "@/hooks/use-settings";
import { useIsSidebarProjectMarked } from "@/stores/sidebar-project-marks-store";
import { useHosts } from "@/runtime/host-runtime";
import { isWeb } from "@/constants/platform";
import type { Theme } from "@/styles/theme";
import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { getProjectMarkDotColor, getStatusDotColor } from "@/utils/status-dot-color";
import {
  STATUS_INDICATOR_ALERT_SIZE,
  STATUS_INDICATOR_DOT_SIZE,
  STATUS_INDICATOR_FILLED_DOT_SIZE,
} from "@/utils/status-indicator-geometry";
import { resolveWorkspaceStatusVisual } from "@/utils/workspace-status-visual";
import { StatusRing } from "@/components/status-ring";
import { resolveSidebarWorkspacePrimaryLabel } from "@/components/sidebar/sidebar-workspace-title";
import { TrailingActionScrim } from "@/components/ui/trailing-action-scrim";
import { useWorkspaceLabelDefinitions } from "@/workspace-labels";

const foregroundMutedColorMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const needsInputColorMapping = (theme: Theme) => ({
  color: theme.colors.surface0,
  fill: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
});

const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);
const ThemedCircleAlert = withUnistyles(CircleAlert);
const ThemedMonitor = withUnistyles(Monitor);
const ThemedFolder = withUnistyles(Folder);
const ThemedFolderGit2 = withUnistyles(FolderGit2);

export function SidebarWorkspaceRowFrame({
  workspace,
  isDragging = false,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  isDragging?: boolean;
  children: (input: {
    isHovered: boolean;
    contextMenuOpen: boolean;
    onContextMenuOpenChange: (open: boolean) => void;
    hoverHandlers: { onPointerEnter: () => void; onPointerLeave: () => void };
  }) => ReactNode;
}) {
  const [isHovered, setIsHovered] = useState(false);
  const [contextMenuOpen, setContextMenuOpen] = useState(false);
  const handlePointerEnter = useCallback(() => {
    if (!contextMenuOpen) setIsHovered(true);
  }, [contextMenuOpen]);
  const handlePointerLeave = useCallback(() => setIsHovered(false), []);
  const handleContextMenuOpenChange = useCallback((open: boolean) => {
    setContextMenuOpen(open);
    if (open) setIsHovered(false);
  }, []);
  const hoverHandlers = useMemo(
    () => ({ onPointerEnter: handlePointerEnter, onPointerLeave: handlePointerLeave }),
    [handlePointerEnter, handlePointerLeave],
  );

  return (
    <WorkspaceHoverCard
      workspace={workspace}
      prHint={workspace.prHint}
      isDragging={isDragging}
      disabled={contextMenuOpen}
    >
      {children({
        isHovered: isHovered && !contextMenuOpen && !isDragging,
        contextMenuOpen,
        onContextMenuOpenChange: handleContextMenuOpenChange,
        hoverHandlers,
      })}
    </WorkspaceHoverCard>
  );
}

/**
 * The collapse control a project row used to own. A header workspace row stands in for its
 * project row, so it carries the control instead.
 */
export interface SidebarProjectCollapseControl {
  collapsed: boolean;
  onToggle: () => void;
}

export const SidebarWorkspaceRowContent = memo(function SidebarWorkspaceRowContent({
  workspace,
  hostBadge,
  leadingProjectName = null,
  projectCollapse = null,
  projectNamePrefix = null,
  serviceSummary = null,
  isHovered,
  isLoading,
  isCreating = false,
  shortcutNumber = null,
  showShortcutBadge = false,
  reserveIdleStatusIndicatorSpace = true,
  children,
}: {
  workspace: SidebarWorkspaceEntry;
  hostBadge?: HostBadgeModel | null;
  /** Project a hoisted row belongs to; it names that project in the meta line. */
  leadingProjectName?: string | null;
  /** Set on the workspace row that stands in for its project row: hover swaps the icon for the chevron. */
  projectCollapse?: SidebarProjectCollapseControl | null;
  /** Project name shown ahead of the workspace title, for that same row. */
  projectNamePrefix?: string | null;
  serviceSummary?: WorkspaceServiceSummary | null;
  isHovered: boolean;
  isLoading: boolean;
  isCreating?: boolean;
  shortcutNumber?: number | null;
  showShortcutBadge?: boolean;
  /** Keep the empty leading slot when the workspace has no active status. */
  reserveIdleStatusIndicatorSpace?: boolean;
  children?: ReactNode;
}) {
  const {
    settings: { workspaceTitleSource },
  } = useAppSettings();
  const workspaceLabel = resolveSidebarWorkspacePrimaryLabel({ workspace, workspaceTitleSource });
  // The workspace carries label names; their colors live in its host's catalog, so the row is
  // where the two meet — the meta line is handed finished definitions.
  const labels = useWorkspaceLabelDefinitions(workspace.serverId, workspace.labels);
  const workspaceBranchTextStyle = useMemo(
    () => [
      styles.workspaceBranchText,
      isHovered && styles.workspaceBranchTextHovered,
      isCreating && styles.workspaceBranchTextCreating,
    ],
    [isHovered, isCreating],
  );

  // Every row leads with the workspace's own status; the row that stands in for its project row
  // puts the collapse triangle ahead of it, which is what makes that row read as the header it is.
  const leadingVisual = (
    <SidebarWorkspaceLeadingVisual
      workspace={workspace}
      leadingProjectName={leadingProjectName}
      projectCollapse={projectCollapse}
      isLoading={isLoading}
      reserveIdleStatusIndicatorSpace={reserveIdleStatusIndicatorSpace}
    />
  );

  // The row that stands in for its project row names the project and the host its workspace lives
  // on, so the title reads "project · host · workspace". The host name comes from the registry
  // rather than from the row's badge: the local host's badge is hidden by default, and this line
  // names it regardless.
  const hostLabel = useHostLabel(projectNamePrefix ? workspace.serverId : null);
  // The host rides along at half size: the same string for every workspace on a machine, so it
  // reads as a note beside the project name rather than as a third name.
  const titlePrefix = projectNamePrefix ?? null;

  return (
    <View style={styles.workspaceRowContent}>
      <View style={styles.workspaceRowMain}>
        <View style={styles.workspaceLeadingGroup}>{leadingVisual}</View>
        <View style={styles.workspaceContentColumn}>
          <View style={styles.workspaceTitleRow}>
            <Text style={workspaceBranchTextStyle} numberOfLines={1}>
              {titlePrefix ? (
                <WorkspaceTitlePrefix projectName={titlePrefix} hostLabel={hostLabel} />
              ) : null}
              {workspaceLabel}
            </Text>
            <View style={sidebarWorkspaceRowStyles.rowRight}>{children}</View>
          </View>
          <WorkspaceMetaRow
            currentBranch={workspace.currentBranch}
            // The header row names its project and host in the title, so repeating either under
            // the title would be the same string twice on one row.
            projectName={projectNamePrefix ? null : leadingProjectName}
            hostBadge={projectNamePrefix ? null : (hostBadge ?? null)}
            prHint={workspace.prHint}
            serviceSummary={serviceSummary}
            labels={labels}
          />
        </View>
      </View>
      {showShortcutBadge && shortcutNumber !== null ? (
        <View style={styles.shortcutBadgeOverlay} pointerEvents="none">
          <SidebarWorkspaceShortcutBadge number={shortcutNumber} />
        </View>
      ) : null}
    </View>
  );
});

/** The host's display name, or null while its row is not naming a host. */
function useHostLabel(serverId: string | null): string | null {
  const hosts = useHosts();
  return useMemo(() => {
    if (!serverId) {
      return null;
    }
    const label = hosts.find((host) => host.serverId === serverId)?.label.trim();
    return label ? label : null;
  }, [hosts, serverId]);
}

/**
 * The start of a title on the row that stands in for its project row: the project's name, then the
 * host that workspace lives on at half size — the same string for every workspace on a machine, so
 * it reads as a note beside the project name rather than as a third name.
 */
function WorkspaceTitlePrefix({
  projectName,
  hostLabel,
}: {
  projectName: string;
  hostLabel: string | null;
}): ReactNode {
  return (
    <>
      <Text style={styles.workspaceTitleProjectPrefix}>{projectName}</Text>
      {hostLabel ? <Text style={styles.workspaceTitleSeparator}> · </Text> : null}
      {hostLabel ? <Text style={styles.workspaceTitleHost}>{hostLabel}</Text> : null}
      {hostLabel ? <Text style={styles.workspaceTitleSeparator}> · </Text> : null}
    </>
  );
}

function ProjectCollapseControl({
  collapsed,
  onToggle,
  projectViewKey,
}: {
  collapsed: boolean;
  onToggle: () => void;
  projectViewKey: string;
}) {
  const { t } = useTranslation();
  // The row press opens the workspace, so the control has to keep the press to itself.
  const handlePress = useCallback(
    (event: GestureResponderEvent) => {
      event.stopPropagation();
      onToggle();
    },
    [onToggle],
  );

  return (
    <Pressable
      // Not a button on web: this control sits inside the row's own button, and a nested <button>
      // is invalid DOM that React rejects. Same convention the row's trailing controls use.
      accessibilityRole={isWeb ? undefined : "button"}
      accessibilityLabel={t(
        collapsed ? "sidebar.project.actions.expand" : "sidebar.project.actions.collapse",
      )}
      hitSlop={8}
      onPress={handlePress}
      style={styles.projectCollapseControl}
      testID={`sidebar-project-collapse-${projectViewKey}`}
    >
      {collapsed ? (
        <ThemedChevronRight size={14} uniProps={foregroundMutedColorMapping} />
      ) : (
        <ThemedChevronDown size={14} uniProps={foregroundMutedColorMapping} />
      )}
    </Pressable>
  );
}

/**
 * The leading slot of a row: the collapse control, when the row stands in for its project row, and
 * the status dot every row carries. Only that project row reports the project's mark, so the
 * workspaces under it keep their own status.
 */
function SidebarWorkspaceLeadingVisual({
  workspace,
  leadingProjectName,
  projectCollapse,
  isLoading,
  reserveIdleStatusIndicatorSpace,
}: {
  workspace: SidebarWorkspaceEntry;
  leadingProjectName: string | null;
  projectCollapse: SidebarProjectCollapseControl | null;
  isLoading: boolean;
  reserveIdleStatusIndicatorSpace: boolean;
}) {
  const isProjectHeaderRow = Boolean(leadingProjectName && projectCollapse);
  const isProjectMarked = useIsSidebarProjectMarked(
    isProjectHeaderRow ? workspace.projectViewKey : null,
  );

  return (
    <>
      {isProjectHeaderRow && projectCollapse ? (
        <ProjectCollapseControl
          collapsed={projectCollapse.collapsed}
          onToggle={projectCollapse.onToggle}
          projectViewKey={workspace.projectViewKey}
        />
      ) : null}
      <WorkspaceStatusIndicator
        bucket={workspace.statusBucket}
        workspaceKind={workspace.workspaceKind}
        loading={isLoading}
        reserveIdleSpace={reserveIdleStatusIndicatorSpace}
        marked={isProjectMarked}
      />
    </>
  );
}

function WorkspaceStatusIndicator({
  bucket,
  workspaceKind,
  loading = false,
  reserveIdleSpace = true,
  marked = false,
}: {
  bucket: SidebarWorkspaceEntry["statusBucket"];
  workspaceKind: SidebarWorkspaceEntry["workspaceKind"];
  loading?: boolean;
  reserveIdleSpace?: boolean;
  /** The row stands in for a project the user marked: its idle dot carries the mark's color. */
  marked?: boolean;
}) {
  // Which shape the slot takes is decided outside this component: the rule, the project mark
  // included, is then testable without rendering a row.
  const visual = resolveWorkspaceStatusVisual({ bucket, loading, marked });

  switch (visual) {
    // Busy is the only status that moves, and it is the ring rather than a dot for the same
    // reason it is a dot elsewhere: every status in the sidebar sits in this one slot, so busy
    // has to fill it without displacing anything. A row starting up and a row working are both
    // busy, so they share the ring and differ only in testID.
    case "loading":
      return (
        <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-loading">
          <StatusRing />
        </View>
      );
    case "running":
      return (
        <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-running">
          <StatusRing />
        </View>
      );
    case "needs_input":
      return (
        <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-needs_input">
          <ThemedCircleAlert size={STATUS_INDICATOR_ALERT_SIZE} uniProps={needsInputColorMapping} />
        </View>
      );
    case "attention":
      return (
        <View style={styles.workspaceStatusDot} testID="workspace-status-indicator-attention">
          <View style={styles.standaloneStatusDot} />
        </View>
      );
    case "idle":
    case "marked":
      // An idle row still gets a dot rather than an empty slot. Nested rows are marked as
      // workspaces by indentation alone, and with nothing in the leading slot the rail has no
      // edge to read against — a workspace carrying its own glyph starts looking like a project
      // header. The dot is muted to half opacity so it holds the rail without reporting status;
      // a marked project takes the mark's color instead, because the dot is the one place the
      // sidebar has to say where the user's attention is, and an idle project is what the mark
      // is for.
      if (!reserveIdleSpace) {
        return null;
      }
      return (
        <View
          style={styles.workspaceStatusDot}
          testID={
            visual === "marked"
              ? "workspace-status-indicator-marked"
              : "workspace-status-indicator-done"
          }
        >
          <View style={visual === "marked" ? styles.markedStatusDot : styles.idleStatusDot} />
        </View>
      );
    case "kind": {
      let KindIcon: typeof ThemedMonitor;
      if (workspaceKind === "local_checkout") KindIcon = ThemedMonitor;
      else if (workspaceKind === "worktree") KindIcon = ThemedFolderGit2;
      else KindIcon = ThemedFolder;

      const dotColorStyle = getStatusDotColorStyle(bucket);
      return (
        <View style={styles.workspaceStatusDot} testID={`workspace-status-indicator-${bucket}`}>
          <KindIcon size={14} uniProps={foregroundMutedColorMapping} />
          {dotColorStyle ? <StatusDotOverlay dotColorStyle={dotColorStyle} /> : null}
        </View>
      );
    }
  }
}

function StatusDotOverlay({ dotColorStyle }: { dotColorStyle: ViewStyle }) {
  return <View style={[styles.statusDotOverlay, dotColorStyle]} />;
}

function getStatusDotColorStyle(bucket: SidebarStateBucket) {
  switch (bucket) {
    case "needs_input":
      return styles.statusDotNeedsInput;
    case "failed":
      return styles.statusDotFailed;
    case "running":
      return styles.statusDotRunning;
    case "attention":
      return styles.statusDotAttention;
    case "done":
      return null;
  }
}

export const sidebarWorkspaceRowStyles = StyleSheet.create((theme) => ({
  // How far a workspace row sits inside the group header above it — a project row or a
  // status group header. Both groupings share this one indent, so every grouped workspace row
  // in the sidebar sits on the same rail regardless of how the list is grouped. Pinned rows
  // are not grouped and stay flush.
  //
  // It is row padding rather than a margin on the list, because the row's hover and selected
  // backgrounds have to keep spanning the group's full width. Indenting the container instead
  // pulls the highlight in with the content and the row stops lining up with its header.
  rowIndented: {
    paddingLeft: theme.spacing[2] + theme.spacing[2],
  },
  rowRight: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  shortcutBadge: {
    minWidth: 18,
    height: 18,
    paddingHorizontal: theme.spacing[1],
    alignItems: "center",
    justifyContent: "center",
    borderRadius: theme.borderRadius.sm,
    borderWidth: 1,
    borderColor: theme.colors.surface2,
    backgroundColor: theme.colors.surface0,
    flexShrink: 0,
  },
  shortcutBadgeText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
    fontWeight: theme.fontWeight.medium,
    lineHeight: 14,
  },
  hidden: { opacity: 0 },
  // Stays position:relative at zero width so the absolutely-positioned kebab keeps
  // anchoring to the same right edge whether or not the slot holds anything.
  trailingActionSlot: {
    position: "relative",
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionSlotReserved: {
    position: "relative",
    minWidth: 18,
    minHeight: 20,
    flexShrink: 0,
    alignItems: "flex-end",
    justifyContent: "flex-start",
  },
  trailingActionOverlay: {
    position: "absolute",
    top: 0,
    right: 0,
  },
}));

export function SidebarWorkspaceShortcutBadge({ number }: { number: number }) {
  return (
    <View style={sidebarWorkspaceRowStyles.shortcutBadge}>
      <Text style={sidebarWorkspaceRowStyles.shortcutBadgeText}>{number}</Text>
    </View>
  );
}

export type SidebarWorkspaceTrailingPresentation = "visible" | "hidden" | "absent";

/**
 * What the trailing slot shows for a row. Derived in one place because three row renderers
 * share it: the two project-mode rows and the status-mode row. The rule used to be copied
 * into each of them and immediately drifted — one call site kept hiding the diff after the
 * others stopped.
 *
 * The trailing content survives the kebab on hover and fades under the scrim instead of
 * blinking out. Touch has no hover, so its permanent kebab still hides the content outright
 * rather than scrimming an unhovered row whose background doesn't match the gradient.
 */
export function resolveTrailingActionVisibility({
  workspace,
  trailing,
  hasArchiveAction,
  isHovered,
  isTouchPlatform,
  showShortcut,
}: {
  workspace: SidebarWorkspaceEntry;
  trailing: SidebarWorkspaceTrailing;
  hasArchiveAction: boolean;
  isHovered: boolean;
  isTouchPlatform: boolean;
  showShortcut: boolean;
}): {
  trailingPresentation: SidebarWorkspaceTrailingPresentation;
  showKebab: boolean;
  showScrim: boolean;
  renderSlot: boolean;
  reserveSlotWidth: boolean;
} {
  const hasTrailing = hasSidebarWorkspaceTrailing({ workspace, trailing });
  const showKebab = Boolean(hasArchiveAction && (isHovered || isTouchPlatform)) && !showShortcut;
  // Touch permanently replaces the stats with the menu. Only temporary shortcut hints
  // conceal content while retaining its width, so desktop rows do not shift.
  const hasContent = hasTrailing && !(hasArchiveAction && isTouchPlatform);
  let trailingPresentation: SidebarWorkspaceTrailingPresentation = "absent";
  if (hasContent) trailingPresentation = showShortcut ? "hidden" : "visible";
  return {
    trailingPresentation,
    showKebab,
    // The scrim paints the row's own hover background, so it can only be drawn on a hovered
    // row — over an unhovered one the gradient fades to the wrong color. That is also why
    // touch, which shows the kebab without ever hovering, never gets one.
    showScrim: showKebab && isHovered,
    renderSlot: hasArchiveAction || hasTrailing,
    // The slot only holds width for something that permanently sits in it. Trailing content
    // does; the kebab only does on touch, where there is no hover for it to appear on and so
    // no scrim to let it overlay the title. Everywhere else the width goes back to the title
    // and the kebab fades in over its tail.
    reserveSlotWidth: hasContent || (hasArchiveAction && isTouchPlatform),
  };
}

export function SidebarWorkspaceTrailingActionSlot({
  reserveWidth,
  children,
}: {
  reserveWidth: boolean;
  children: ReactNode;
}) {
  return (
    <View
      style={
        reserveWidth
          ? sidebarWorkspaceRowStyles.trailingActionSlotReserved
          : sidebarWorkspaceRowStyles.trailingActionSlot
      }
    >
      {children}
    </View>
  );
}

export function SidebarWorkspaceTrailingActionBase({
  presentation,
  children,
}: {
  presentation: SidebarWorkspaceTrailingPresentation;
  children: ReactNode;
}) {
  if (presentation === "absent") return null;
  return (
    <View style={presentation === "hidden" ? sidebarWorkspaceRowStyles.hidden : undefined}>
      {children}
    </View>
  );
}

export function SidebarWorkspaceTrailingActionOverlay({
  visible,
  scrimBackdrop,
  children,
}: {
  visible: boolean;
  /** Fade the row into the kebab when something (the diff stat) is still rendered behind it. */
  scrimBackdrop?: SidebarSurfaceBackdrop;
  children: ReactNode;
}) {
  if (!visible || !children) return null;
  return (
    <>
      {scrimBackdrop ? (
        <TrailingActionScrim backdrop={scrimBackdrop} testID="sidebar-workspace-trailing-scrim" />
      ) : null}
      <View style={sidebarWorkspaceRowStyles.trailingActionOverlay}>{children}</View>
    </>
  );
}

const styles = StyleSheet.create((theme) => ({
  workspaceRowContent: {
    position: "relative",
  },
  workspaceRowMain: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    width: "100%",
  },
  workspaceContentColumn: {
    flex: 1,
    minWidth: 0,
  },
  workspaceTitleRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    justifyContent: "space-between",
    gap: theme.spacing[2],
    // The title's own line box, pinned: an inline box taller than the text (the half-size host in
    // the header row) would otherwise stretch the row a pixel past every row under it.
    height: 20,
  },
  shortcutBadgeOverlay: {
    position: "absolute",
    top: 1,
    right: 0,
  },
  // Holds the leading glyph or glyphs of a row: the collapse triangle, when the row stands in
  // for its project row, and then the workspace's status. The project's children are indented
  // past the whole group — see `projectWorkspaceListContainer` in sidebar-workspace-list.tsx.
  workspaceLeadingGroup: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: theme.spacing[2],
    flexShrink: 0,
  },
  // Sits ahead of the workspace title on that row, so the row still names its project after the
  // project row itself is gone. Size and line box are repeated from `workspaceBranchText`: a nested
  // Text does not inherit its parent's lineHeight, and the taller default box made these rows 4pt
  // taller than every workspace row under them.
  workspaceTitleProjectPrefix: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  workspaceTitleHost: {
    color: theme.colors.foregroundMuted,
    // Half the title's size — see `workspaceBranchText`. `verticalAlign: middle` matters: sitting on
    // the parent's baseline, a 7pt font hangs 2pt below the 20pt line box and makes this row taller
    // than every row under it.
    fontSize: theme.fontSize.base / 2,
    lineHeight: 20,
    verticalAlign: "middle",
  },
  workspaceTitleSeparator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.base,
    lineHeight: 20,
  },
  // Takes the status slot's geometry, so the triangle and the glyph after it sit on the one rail
  // the sidebar uses for leading visuals.
  projectCollapseControl: {
    width: theme.iconSize.md,
    height: 20,
    borderRadius: theme.borderRadius.sm,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  workspaceStatusDot: {
    position: "relative",
    width: theme.iconSize.md,
    height: 20,
    borderRadius: theme.borderRadius.full,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  statusDotOverlay: {
    position: "absolute",
    right: 0,
    bottom: 0,
    width: STATUS_INDICATOR_DOT_SIZE,
    height: STATUS_INDICATOR_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: 1,
  },
  standaloneStatusDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
  },
  idleStatusDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.foregroundExtraMuted,
    opacity: 0.3,
  },
  // The project mark's own dot: same geometry as the idle dot it replaces, in the mark's yellow.
  markedStatusDot: {
    width: STATUS_INDICATOR_FILLED_DOT_SIZE,
    height: STATUS_INDICATOR_FILLED_DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: getProjectMarkDotColor({ theme }),
  },
  // The title owns the first line outright now that the host, change request and CI moved
  // to the meta row, so it takes the full width the trailing slot leaves behind.
  workspaceBranchText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: "400",
    lineHeight: 20,
    opacity: 0.76,
    flex: 1,
    minWidth: 0,
  },
  workspaceBranchTextCreating: {
    opacity: 0.92,
  },
  workspaceBranchTextHovered: {
    opacity: 1,
  },
  statusDotNeedsInput: {
    backgroundColor: getStatusDotColor({ theme, bucket: "needs_input" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotFailed: {
    backgroundColor: getStatusDotColor({ theme, bucket: "failed" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotRunning: {
    backgroundColor: getStatusDotColor({ theme, bucket: "running" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
  statusDotAttention: {
    backgroundColor: getStatusDotColor({ theme, bucket: "attention" }) ?? undefined,
    borderColor: theme.colors.surface0,
  },
}));
