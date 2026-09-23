/**
 * Identity of the thing a notification points at. The renderer stamps these
 * fields into `data` when it sends a notification, and names the same fields
 * when it wants everything about that thing dismissed.
 */
export interface NotificationTarget {
  serverId: string | null;
  agentId: string | null;
  workspaceId: string | null;
  terminalId: string | null;
}

const TARGET_KEYS = ["serverId", "agentId", "workspaceId", "terminalId"] as const;

export const EMPTY_NOTIFICATION_TARGET: NotificationTarget = {
  serverId: null,
  agentId: null,
  workspaceId: null,
  terminalId: null,
};

export function readNotificationTarget(source: unknown): NotificationTarget {
  const record =
    typeof source === "object" && source !== null && !Array.isArray(source)
      ? (source as Record<string, unknown>)
      : {};
  const target: NotificationTarget = { ...EMPTY_NOTIFICATION_TARGET };
  for (const key of TARGET_KEYS) {
    const value = record[key];
    target[key] = typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
  }
  return target;
}

export function isEmptyNotificationTarget(target: NotificationTarget): boolean {
  return TARGET_KEYS.every((key) => target[key] === null);
}

/**
 * A notification is dismissed when every field the request names matches it.
 * Fields the request leaves out stay unconstrained, so a workspace-level request
 * still closes the notification that also carries an agent id.
 */
export function notificationTargetMatches(
  candidate: NotificationTarget,
  request: NotificationTarget,
): boolean {
  if (isEmptyNotificationTarget(request)) {
    return false;
  }
  return TARGET_KEYS.every((key) => request[key] === null || request[key] === candidate[key]);
}
