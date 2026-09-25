import type { SidebarStateBucket } from "@/utils/sidebar-agent-state";
import { shouldRenderSyncedStatusLoader } from "@/utils/status-loader";

/**
 * The shape the sidebar's status slot takes for a workspace row.
 *
 * `kind` is the workspace-kind icon wearing the bucket's own dot; the rest replace it — the ring
 * while the row is busy, the alert, and the two plain dots.
 */
export type WorkspaceStatusVisual =
  | "loading"
  | "running"
  | "needs_input"
  | "attention"
  | "idle"
  | "marked"
  | "kind";

/**
 * Which of those a row shows. The project mark only reaches the idle dot: a row that reports a
 * status of its own reports that, mark or no mark.
 */
export function resolveWorkspaceStatusVisual(input: {
  bucket: SidebarStateBucket;
  loading: boolean;
  marked: boolean;
}): WorkspaceStatusVisual {
  const { bucket, loading, marked } = input;

  if (loading) {
    return "loading";
  }
  if (shouldRenderSyncedStatusLoader({ bucket })) {
    return "running";
  }
  if (bucket === "needs_input") {
    return "needs_input";
  }
  if (bucket === "attention") {
    return "attention";
  }
  if (bucket === "done") {
    return marked ? "marked" : "idle";
  }
  return "kind";
}
