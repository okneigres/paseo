import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { useIsCompactFormFactor } from "@/constants/layout";
import { HostBadge } from "@/hosts/host-badge";
import { useHostBadges } from "@/hosts/use-host-badges";

/**
 * The project a workspace belongs to, drawn as a prefix ahead of its title — the same reading the
 * sidebar rows use. Null while the project name would only repeat the title.
 */
export function WorkspaceHeaderProjectPrefix({ project }: { project: string | null }) {
  if (!project) {
    return null;
  }
  return (
    <>
      <Text testID="workspace-header-subtitle" style={styles.project} numberOfLines={1}>
        {project}
      </Text>
      <Text style={styles.separator}> · </Text>
    </>
  );
}

/**
 * Which machine the workspace runs on. The project name moved into the title, so this line is the
 * host alone — and on a purely local, single-host setup it is quiet, following the host's own
 * badge setting.
 */
export function WorkspaceHeaderProjectRow({ serverId }: { serverId: string }) {
  const isCompact = useIsCompactFormFactor();
  const hostBadge = useHostBadges({ enabled: isCompact }).get(serverId) ?? null;
  if (!hostBadge) {
    return null;
  }
  return (
    <View style={styles.row}>
      <HostBadge badge={hostBadge} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  // The compact header stretches this row to its available title width. Within that width,
  // the project truncates and HostBadge yields its label while retaining its fixed icon.
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1.5],
    minWidth: 0,
    flexShrink: 1,
  },
  project: {
    color: theme.colors.foregroundMuted,
    fontSize: {
      xs: theme.fontSize.sm,
      md: theme.fontSize.base,
    },
    flexShrink: 1,
    minWidth: 0,
  },
  separator: {
    color: theme.colors.foregroundExtraMuted,
    fontSize: theme.fontSize.sm,
    flexShrink: 0,
  },
}));
