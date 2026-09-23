import path from "node:path";
import { existsSync } from "node:fs";
import { app, BrowserWindow, Notification, ipcMain, nativeImage } from "electron";
import { getDesktopSettingsStore } from "../settings/desktop-settings-electron.js";
import {
  isEmptyNotificationTarget,
  notificationTargetMatches,
  readNotificationTarget,
  type NotificationTarget,
} from "./notification-target.js";

interface NotificationInput {
  title?: unknown;
  body?: unknown;
  data?: unknown;
}

interface NotificationClickPayload {
  data?: Record<string, unknown>;
}

// Each shown notification keeps the target it points at, so the renderer can
// later say "this is read now" and the matching ones get dismissed.
const activeNotifications = new Map<Notification, NotificationTarget & { id: string }>();
let nextNotificationId = 1;

function supportsDeliveredNotificationRemoval(): boolean {
  // `Notification.remove` is macOS-only and removes entries from Notification
  // Center, not just the banner.
  return process.platform === "darwin" && typeof Notification.remove === "function";
}

function toTrimmedString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function toRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function getNotificationIcon(): Electron.NativeImage | null {
  const candidates = [
    path.resolve(__dirname, "../assets/icon.png"),
    path.resolve(__dirname, "../assets/64x64.png"),
    path.resolve(__dirname, "../assets/128x128.png"),
  ];

  for (const iconPath of candidates) {
    if (!existsSync(iconPath)) {
      continue;
    }
    const icon = nativeImage.createFromPath(iconPath);
    if (!icon.isEmpty()) {
      return icon;
    }
  }

  return null;
}

function focusSenderWindow(sender: Electron.WebContents): BrowserWindow | null {
  const win = BrowserWindow.fromWebContents(sender) ?? BrowserWindow.getAllWindows()[0] ?? null;
  if (!win || win.isDestroyed()) {
    return null;
  }
  win.show();
  if (win.isMinimized()) {
    win.restore();
  }
  win.focus();
  return win;
}

/**
 * macOS requires a notification to have been shown at least once before
 * the app appears in System Preferences > Notifications. We fire a
 * silent no-op notification during startup to ensure registration.
 */
export function ensureNotificationCenterRegistration(): void {
  if (process.platform !== "darwin" || !Notification.isSupported()) {
    return;
  }

  const probe = new Notification({ title: app.name, silent: true });
  probe.on("show", () => probe.close());
  setTimeout(() => probe.close(), 2_000);
  probe.show();
}

export function registerNotificationHandlers(): void {
  ipcMain.handle("paseo:notification:isSupported", () => {
    return Notification.isSupported();
  });

  ipcMain.handle("paseo:notification:send", async (event, rawInput?: NotificationInput) => {
    if (!Notification.isSupported()) {
      return false;
    }

    const title = toTrimmedString(rawInput?.title);
    if (!title) {
      return false;
    }

    const body = toTrimmedString(rawInput?.body) ?? undefined;
    const data = toRecord(rawInput?.data);
    const icon = getNotificationIcon();
    const settings = await getDesktopSettingsStore().get();
    const id = `paseo-notification-${nextNotificationId}`;
    nextNotificationId += 1;
    const notification = new Notification({
      id,
      title,
      ...(body ? { body } : {}),
      ...(icon ? { icon } : {}),
      silent: !settings.notifications.playSound,
    });

    activeNotifications.set(notification, { ...readNotificationTarget(data), id });

    notification.on("click", () => {
      const win = focusSenderWindow(event.sender);
      if (win && data && Object.keys(data).length > 0) {
        const payload: NotificationClickPayload = { data };
        win.webContents.send("paseo:event:notification-click", payload);
      }
      activeNotifications.delete(notification);
    });

    notification.on("close", () => {
      activeNotifications.delete(notification);
    });

    notification.show();
    return true;
  });

  // The renderer names the target that just became read; everything pointing at
  // it is dismissed. Notifications whose handles are gone (a previous run) are
  // out of reach.
  ipcMain.handle("paseo:notification:dismiss", (_event, rawTarget?: unknown) => {
    const request = readNotificationTarget(rawTarget);
    if (isEmptyNotificationTarget(request)) {
      return 0;
    }
    let dismissed = 0;
    const dismissedIds: string[] = [];
    for (const [notification, target] of activeNotifications) {
      if (!notificationTargetMatches(target, request)) {
        continue;
      }
      notification.close();
      dismissedIds.push(target.id);
      activeNotifications.delete(notification);
      dismissed += 1;
    }
    if (dismissedIds.length > 0 && supportsDeliveredNotificationRemoval()) {
      Notification.remove(dismissedIds);
    }
    return dismissed;
  });
}
