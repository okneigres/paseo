import { describe, expect, it } from "vitest";
import {
  isEmptyNotificationTarget,
  notificationTargetMatches,
  readNotificationTarget,
} from "./notification-target";

describe("notification targets", () => {
  it("matches a notification on the fields the request names", () => {
    const stored = readNotificationTarget({
      serverId: "srv_1",
      workspaceId: "wks_1",
      agentId: "agent_1",
    });

    expect(notificationTargetMatches(stored, readNotificationTarget({ agentId: "agent_1" }))).toBe(
      true,
    );
    expect(notificationTargetMatches(stored, readNotificationTarget({ agentId: "agent_2" }))).toBe(
      false,
    );
    expect(
      notificationTargetMatches(
        stored,
        readNotificationTarget({
          serverId: "srv_1",
          workspaceId: "wks_1",
          agentId: "agent_1",
        }),
      ),
    ).toBe(true);
  });

  it("matches nothing when the request names no target", () => {
    const stored = readNotificationTarget({ agentId: "agent_1" });

    expect(notificationTargetMatches(stored, readNotificationTarget({}))).toBe(false);
    expect(notificationTargetMatches(stored, readNotificationTarget(undefined))).toBe(false);
    expect(isEmptyNotificationTarget(readNotificationTarget({ agentId: "   " }))).toBe(true);
  });

  it("keeps the terminal identity separate from the agent identity", () => {
    const stored = readNotificationTarget({ serverId: "srv_1", terminalId: "term_1" });

    expect(
      notificationTargetMatches(stored, readNotificationTarget({ terminalId: "term_1" })),
    ).toBe(true);
    expect(notificationTargetMatches(stored, readNotificationTarget({ agentId: "term_1" }))).toBe(
      false,
    );
  });
});
