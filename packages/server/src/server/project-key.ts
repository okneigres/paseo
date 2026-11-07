import { resolve, win32 } from "node:path";
import { isGitHubHost, parseGitRemoteLocation } from "@getpaseo/protocol/git-remote";
import { getRealpathAwareRelativePath, normalizePathForIdentity } from "../utils/path.js";

/** Persisted opaque key used to join the same remote across hosts. */
export function deriveProjectKey(input: {
  rootPath: string;
  remoteUrl: string | null;
  worktreeRoot: string | null;
  mainRepoRoot: string | null;
  /** Accepted for callers that still pass it; host-local identity is the path alone now. */
  serverId?: string;
}): string {
  const remote = input.remoteUrl ? parseGitRemoteLocation(input.remoteUrl) : null;
  const selectedPath = input.worktreeRoot
    ? getRealpathAwareRelativePath(input.worktreeRoot, input.rootPath) || null
    : null;
  if (remote) {
    const host = remote.port ? `${remote.host}:${remote.port}` : remote.host;
    const path = isGitHubHost(remote.host) ? remote.path.toLowerCase() : remote.path;
    const remoteKey = `remote:${host}/${path}`;
    return selectedPath ? `${remoteKey}#subdir:${selectedPath.replaceAll("\\", "/")}` : remoteKey;
  }

  const localPathParts = [
    selectedPath && input.mainRepoRoot ? input.mainRepoRoot : input.rootPath,
    selectedPath && input.mainRepoRoot ? selectedPath : "",
  ];
  const resolvedLocalPath = localPathParts.some(looksLikeWindowsPath)
    ? win32.resolve(...localPathParts)
    : resolve(...localPathParts);
  // No remote at all: the full path is the identity, without the host. Two machines that keep the
  // project at the same path are the same project; anything else is a different one.
  return normalizePathForIdentity(resolvedLocalPath);
}

export function deriveProjectGroupingDisplayName(input: {
  rootPath: string;
  remoteUrl: string | null;
  worktreeRoot: string | null;
}): string {
  const selectedPath = input.worktreeRoot
    ? getRealpathAwareRelativePath(input.worktreeRoot, input.rootPath)
    : null;
  if (selectedPath) return lastPathSegment(input.rootPath);

  const remote = input.remoteUrl ? parseGitRemoteLocation(input.remoteUrl) : null;
  if (!remote) return lastPathSegment(input.rootPath);
  return remote.path.split("/").filter(Boolean).slice(-2).join("/") || input.rootPath;
}

function lastPathSegment(inputPath: string): string {
  const segments = inputPath.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] ?? inputPath;
}

function looksLikeWindowsPath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/u.test(value) || /^[/\\]{2}[^/\\]+[/\\][^/\\]+/u.test(value);
}

/** The project's name as the naming remote spells it: its last path segment. */
export function deriveProjectNameFromRemoteUrl(
  remoteUrl: string | null | undefined,
): string | null {
  if (!remoteUrl) return null;
  const remote = parseGitRemoteLocation(remoteUrl);
  if (!remote) return null;
  const segments = remote.path.split("/").filter(Boolean);
  return segments[segments.length - 1] ?? null;
}
