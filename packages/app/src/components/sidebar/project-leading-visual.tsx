import { ActivityIndicator, View } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { ChevronDown, ChevronRight } from "lucide-react-native";
import type { Theme } from "@/styles/theme";

// Matches the workspace title's lineHeight (sidebar-workspace-row-content's workspaceBranchText)
// so the leading glyph centers on the title rather than floating above it.
const LEADING_SLOT_HEIGHT = 20;

const ThemedActivityIndicator = withUnistyles(ActivityIndicator);
const ThemedChevronDown = withUnistyles(ChevronDown);
const ThemedChevronRight = withUnistyles(ChevronRight);

const foregroundMutedColorMapping = (theme: Theme) => ({
  color: theme.colors.foregroundMuted,
});

/**
 * Leading slot of a sidebar project row: chevron on hover, archive spinner while removing.
 *
 * The project's icon used to fill this slot and carry its aggregate workspace status. The row
 * names its project instead, so the slot stands empty at rest — and it stays, empty, so a project
 * row keeps the rail its title and every other row's title starts on.
 */
export function ProjectLeadingVisual({
  chevron = null,
  showChevron = false,
  isArchiving = false,
}: {
  chevron?: "expand" | "collapse" | null;
  showChevron?: boolean;
  isArchiving?: boolean;
}) {
  if (showChevron && chevron !== null) {
    return (
      <View style={styles.projectLeadingVisualSlot}>
        <ProjectInlineChevron chevron={chevron} />
      </View>
    );
  }

  if (isArchiving) {
    return (
      <View style={styles.projectLeadingVisualSlot} testID="project-status-indicator-archiving">
        <ThemedActivityIndicator size={8} uniProps={foregroundMutedColorMapping} />
      </View>
    );
  }

  return <View style={styles.projectLeadingVisualSlot} />;
}

function ProjectInlineChevron({ chevron }: { chevron: "expand" | "collapse" | null }) {
  if (chevron === null) {
    return null;
  }
  if (chevron === "collapse") {
    return <ThemedChevronDown size={14} uniProps={foregroundMutedColorMapping} />;
  }
  return <ThemedChevronRight size={14} uniProps={foregroundMutedColorMapping} />;
}

const styles = StyleSheet.create((theme) => ({
  // The slot is as tall as the title's line box, not as tall as the glyph inside it, and centers
  // that glyph. Rows lay their leading visual out with alignItems:flex-start, so a 16pt slot next
  // to a 20pt line box would put the glyph 2pt above the title — which is why the workspace status
  // indicator is also 20 tall. Keep the two in step.
  projectLeadingVisualSlot: {
    width: theme.iconSize.md,
    height: LEADING_SLOT_HEIGHT,
    flexShrink: 0,
    alignItems: "center",
    justifyContent: "center",
  },
}));
