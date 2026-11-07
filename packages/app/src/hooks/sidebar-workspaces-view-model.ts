import { deriveEffectiveWorkspaceStatus } from "@/workspace-status";
import equal from "fast-deep-equal";
import type { PrHint } from "@/git/pr-hint";
import { selectPrHintFromStatus } from "@/git/pr-hint";
import { type HostProjectListItem } from "@/projects/host-project-model";
import type { PendingCreateAttempt } from "@/stores/create-flow-store";
import type { WorkspaceDescriptor } from "@/stores/session-store";
import type {
  WorkspaceStructureHostPlacement,
  WorkspaceStructureProject,
} from "@/projects/workspace-structure";
import { projectDisplayNameFromProjectId } from "@/utils/project-display-name";
import { aggregateSidebarStateBuckets } from "@/utils/sidebar-agent-state";
import { shortenPath } from "@/utils/shorten-path";
import type { WorkspaceAgentActivity } from "@/utils/workspace-agent-activity";
import { resolveWorkspaceMapKeyByIdentity } from "@/utils/workspace-identity";

const EMPTY_PROJECTS: SidebarProjectEntry[] = [];

export type SidebarStateBucket = WorkspaceDescriptor["status"];

export interface SidebarWorkspacePlacement {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
  projectViewKey: string;
  projectName: string;
  projectRootPath?: string;
  workspaceDirectory?: string;
  projectKind: WorkspaceStructureProject["projectKind"];
  workspaceKind: WorkspaceDescriptor["workspaceKind"];
  background?: boolean;
  name: string;
}

export interface SidebarStatusWorkspacePlacement extends SidebarWorkspacePlacement {
  statusBucket: SidebarStateBucket;
  statusEnteredAt: Date | null;
}

export interface SidebarWorkspaceEntry extends SidebarStatusWorkspacePlacement {
  workspaceDirectory: string;
  workspaceDirectoryLabel: string;
  // Raw user-set title (null when the name is derived from branch/directory).
  // Prefills the rename input and signals whether a reset is available.
  title: string | null;
  pinnedAt?: string | null;
  labels?: string[];
  // Checkout branch (null when not a git checkout or detached HEAD).
  currentBranch: string | null;
  archivingAt: string | null;
  diffStat: { additions: number; deletions: number } | null;
  prHint: PrHint | null;
  archiveHasUncommittedChanges: boolean | null;
  archiveUnpushedCommitCount: number | null;
  scripts: WorkspaceDescriptor["scripts"];
  hasRunningScripts: boolean;
}

export interface SidebarProjectEntry {
  viewKey: string;
  projectName: string;
  projectKind: WorkspaceStructureProject["projectKind"];
  iconWorkingDir: string;
  hosts: WorkspaceStructureHostPlacement[];
  workspaces: SidebarWorkspacePlacement[];
}

export interface SidebarWorkspacePlacementModel {
  workspaces: SidebarWorkspacePlacement[];
  projects: SidebarProjectEntry[];
  projectNamesByViewKey: Map<string, string>;
}

export interface SidebarWorkspaceSession {
  serverId: string;
  workspaces: Map<string, WorkspaceDescriptor>;
  workspaceAgentActivity: Map<string, WorkspaceAgentActivity>;
}

interface SidebarWorkspaceSessionSource {
  workspaces: Map<string, WorkspaceDescriptor>;
  workspaceAgentActivity: Map<string, WorkspaceAgentActivity>;
}

export function selectSidebarWorkspaceSessions(
  sessions: Record<string, SidebarWorkspaceSessionSource | undefined>,
  serverIds: readonly string[],
): SidebarWorkspaceSession[] {
  const selected: SidebarWorkspaceSession[] = [];
  for (const serverId of serverIds) {
    const session = sessions[serverId];
    if (!session) {
      continue;
    }
    selected.push({
      serverId,
      workspaces: session.workspaces,
      workspaceAgentActivity: session.workspaceAgentActivity,
    });
  }
  return selected;
}

export function areSidebarWorkspaceSessionsEqual(
  left: readonly SidebarWorkspaceSession[],
  right: readonly SidebarWorkspaceSession[],
): boolean {
  if (left.length !== right.length) {
    return false;
  }
  for (let index = 0; index < left.length; index += 1) {
    const leftSession = left[index];
    const rightSession = right[index];
    if (
      !leftSession ||
      !rightSession ||
      leftSession.serverId !== rightSession.serverId ||
      leftSession.workspaces !== rightSession.workspaces ||
      leftSession.workspaceAgentActivity !== rightSession.workspaceAgentActivity
    ) {
      return false;
    }
  }
  return true;
}

function projectNameForWorkspace(workspace: WorkspaceDescriptor): string {
  return (
    workspace.projectCustomName ??
    workspace.projectDisplayName ??
    projectDisplayNameFromProjectId(workspace.projectId)
  );
}

function normalizeCurrentBranch(currentBranch: string | null | undefined): string | null {
  if (!currentBranch) {
    return null;
  }
  const trimmed = currentBranch.trim();
  return trimmed.length === 0 || trimmed === "HEAD" ? null : trimmed;
}

export function createSidebarWorkspaceEntry(input: {
  serverId: string;
  workspace: WorkspaceDescriptor;
  projectViewKey?: string;
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
  workspaceAgentActivity?: ReadonlyMap<string, WorkspaceAgentActivity>;
}): SidebarWorkspaceEntry {
  const projectViewKey = input.projectViewKey ?? input.workspace.projectId;
  const effectiveStatus = deriveEffectiveWorkspaceStatus(input);
  return {
    workspaceKey: `${input.serverId}:${input.workspace.id}`,
    serverId: input.serverId,
    workspaceId: input.workspace.id,
    projectViewKey,
    projectName: projectNameForWorkspace(input.workspace),
    projectRootPath: input.workspace.projectRootPath,
    workspaceDirectory: input.workspace.workspaceDirectory,
    workspaceDirectoryLabel:
      input.workspace.worktreeSlug ?? shortenPath(input.workspace.workspaceDirectory),
    projectKind: input.workspace.projectKind,
    workspaceKind: input.workspace.workspaceKind,
    background: input.workspace.background,
    name: input.workspace.name,
    title: input.workspace.title ?? null,
    pinnedAt: input.workspace.pinnedAt,
    labels: input.workspace.labels ?? EMPTY_WORKSPACE_LABELS,
    currentBranch: normalizeCurrentBranch(input.workspace.gitRuntime?.currentBranch),
    statusBucket: effectiveStatus.status,
    statusEnteredAt: effectiveStatus.enteredAt,
    archivingAt: input.workspace.archivingAt,
    diffStat: input.workspace.diffStat,
    prHint: selectPrHintFromStatus(
      input.workspace.githubRuntime?.pullRequest,
      input.workspace.forge,
    ),
    archiveHasUncommittedChanges: input.workspace.gitRuntime?.isDirty ?? null,
    archiveUnpushedCommitCount: input.workspace.gitRuntime?.aheadOfOrigin ?? null,
    scripts: input.workspace.scripts,
    hasRunningScripts: input.workspace.scripts.some((script) => script.lifecycle === "running"),
  };
}

const EMPTY_WORKSPACE_LABELS: string[] = [];

export interface ProjectStatusSession {
  workspaces: Map<string, WorkspaceDescriptor>;
  workspaceAgentActivity: Map<string, WorkspaceAgentActivity>;
}

/**
 * Most urgent status among a project's workspaces. Backs the status dot on a collapsed
 * project row, which otherwise hides every workspace-level signal it contains.
 *
 * Workspaces the session hasn't hydrated yet are skipped rather than counted as done —
 * an unknown workspace shouldn't drag the aggregate anywhere. Reuses the same
 * activity-index + effective-status pipeline as per-workspace rows (one pass over the
 * session's agents per server, not per workspace) rather than re-deriving it.
 */
export function deriveProjectStatusBucket(input: {
  workspaces: readonly SidebarWorkspacePlacement[];
  sessions: Record<string, ProjectStatusSession | undefined>;
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
}): SidebarStateBucket {
  const workspaceIdsByServer = new Map<string, string[]>();
  for (const placement of input.workspaces) {
    const existing = workspaceIdsByServer.get(placement.serverId);
    if (existing) {
      existing.push(placement.workspaceId);
    } else {
      workspaceIdsByServer.set(placement.serverId, [placement.workspaceId]);
    }
  }

  const buckets: SidebarStateBucket[] = [];
  for (const [serverId, workspaceIds] of workspaceIdsByServer) {
    const session = input.sessions[serverId];
    if (!session) continue;
    for (const workspaceId of workspaceIds) {
      const workspaceKey = resolveWorkspaceMapKeyByIdentity({
        workspaces: session.workspaces,
        workspaceId,
      });
      const workspace = workspaceKey ? session.workspaces.get(workspaceKey) : undefined;
      if (!workspace) continue;
      buckets.push(
        deriveEffectiveWorkspaceStatus({
          serverId,
          workspace,
          pendingCreateAttempts: input.pendingCreateAttempts,
          workspaceAgentActivity: session.workspaceAgentActivity,
        }).status,
      );
    }
  }

  return aggregateSidebarStateBuckets(buckets);
}

/** One bounded projection per sidebar; unchanged placements survive project reordering. */
export function createSidebarWorkspacePlacementSelector(): (
  projects: readonly HostProjectListItem[],
) => SidebarWorkspacePlacementModel {
  let previous: SidebarWorkspacePlacementModel | null = null;
  return (projects) => {
    const next = buildSidebarWorkspacePlacementModel({ projects });
    const previousProjects = new Map(
      previous?.projects.map((project) => [project.viewKey, project]),
    );
    const previousWorkspaces = new Map(
      previous?.workspaces.map((workspace) => [workspace.workspaceKey, workspace]),
    );
    next.projects = next.projects.map((project) => {
      const prior = previousProjects.get(project.viewKey);
      if (prior && equal(prior, project)) return prior;
      project.workspaces = project.workspaces.map((workspace) => {
        const priorWorkspace = previousWorkspaces.get(workspace.workspaceKey);
        return priorWorkspace && equal(priorWorkspace, workspace) ? priorWorkspace : workspace;
      });
      return project;
    });
    next.workspaces = next.projects.flatMap((project) => project.workspaces);
    previous = next;
    return next;
  };
}

export function buildSidebarWorkspacePlacementModel(input: {
  projects: readonly HostProjectListItem[];
}): SidebarWorkspacePlacementModel {
  const projects = buildSidebarProjectsFromHostProjects({ projects: input.projects });
  return {
    projects,
    workspaces: projects.flatMap((project) => project.workspaces),
    projectNamesByViewKey: new Map(
      projects.map((project) => [project.viewKey, project.projectName]),
    ),
  };
}

function createStructuralWorkspaceEntry(input: {
  project: HostProjectListItem;
  workspaceKey: string;
}): SidebarWorkspacePlacement {
  const identity = resolveStructuralWorkspaceIdentity({
    project: input.project,
    workspaceKey: input.workspaceKey,
  });

  return {
    workspaceKey: identity.workspaceKey,
    serverId: identity.serverId,
    workspaceId: identity.workspaceId,
    projectViewKey: input.project.viewKey,
    projectName: input.project.projectName,
    projectRootPath: input.project.iconWorkingDir,
    workspaceDirectory: undefined,
    projectKind: input.project.projectKind,
    workspaceKind: "checkout",
    name: identity.workspaceId,
  };
}

function resolveStructuralWorkspaceIdentity(input: {
  project: HostProjectListItem;
  workspaceKey: string;
}): {
  workspaceKey: string;
  serverId: string;
  workspaceId: string;
} {
  const hostsByLongestPrefix = [...input.project.hosts].sort(
    (left, right) => right.serverId.length - left.serverId.length,
  );

  for (const host of hostsByLongestPrefix) {
    const prefix = `${host.serverId}:`;
    if (!input.workspaceKey.startsWith(prefix)) continue;
    const workspaceId = input.workspaceKey.slice(prefix.length);
    if (!workspaceId) continue;
    return {
      workspaceKey: input.workspaceKey,
      serverId: host.serverId,
      workspaceId,
    };
  }

  const separatorIndex = input.workspaceKey.indexOf(":");
  if (separatorIndex > 0) {
    return {
      workspaceKey: input.workspaceKey,
      serverId: input.workspaceKey.slice(0, separatorIndex),
      workspaceId: input.workspaceKey.slice(separatorIndex + 1),
    };
  }

  const serverId = input.project.hosts[0]?.serverId ?? input.workspaceKey;
  return {
    workspaceKey: `${serverId}:${input.workspaceKey}`,
    serverId,
    workspaceId: input.workspaceKey,
  };
}

export function buildSidebarWorkspaceEntries(input: {
  placements: readonly SidebarWorkspacePlacement[];
  sessions: SidebarWorkspaceSession[];
  pendingCreateAttempts?: Record<string, PendingCreateAttempt>;
  previousEntries?: ReadonlyMap<string, SidebarWorkspaceEntry>;
}): ReadonlyMap<string, SidebarWorkspaceEntry> {
  if (input.placements.length === 0 || input.sessions.length === 0) {
    return new Map();
  }

  const sessionByServerId = new Map(input.sessions.map((session) => [session.serverId, session]));
  const entries = new Map<string, SidebarWorkspaceEntry>();
  const previousKeys = input.previousEntries?.keys();
  let unchanged = input.previousEntries !== undefined;

  for (const placement of input.placements) {
    const session = sessionByServerId.get(placement.serverId);
    if (!session) continue;
    const workspaceKey = resolveWorkspaceMapKeyByIdentity({
      workspaces: session.workspaces,
      workspaceId: placement.workspaceId,
    });
    const workspace = workspaceKey ? session.workspaces.get(workspaceKey) : null;
    if (!workspace) continue;

    const entry = createSidebarWorkspaceEntry({
      serverId: placement.serverId,
      workspace,
      projectViewKey: placement.projectViewKey,
      pendingCreateAttempts: input.pendingCreateAttempts,
      workspaceAgentActivity: session.workspaceAgentActivity,
    });
    const previousEntry = input.previousEntries?.get(placement.workspaceKey);
    const nextEntry =
      previousEntry && areSidebarWorkspaceEntriesEqual(previousEntry, entry)
        ? previousEntry
        : entry;
    entries.set(placement.workspaceKey, nextEntry);
    unchanged =
      previousKeys?.next().value === placement.workspaceKey &&
      previousEntry === nextEntry &&
      unchanged;
  }

  // Resuming a retained sidebar must not invalidate its project/filter projections
  // when the directory has not changed while it was hidden.
  return unchanged && input.previousEntries?.size === entries.size
    ? input.previousEntries
    : entries;
}

function areSidebarWorkspaceEntriesEqual(
  left: SidebarWorkspaceEntry,
  right: SidebarWorkspaceEntry,
): boolean {
  const keys = Object.keys(left) as Array<keyof SidebarWorkspaceEntry>;
  if (keys.length !== Object.keys(right).length) return false;
  return keys.every((key) => {
    if (key !== "prHint") return Object.is(left[key], right[key]);
    const leftHint = left.prHint;
    const rightHint = right.prHint;
    return (
      leftHint === rightHint ||
      (leftHint !== null &&
        rightHint !== null &&
        leftHint.url === rightHint.url &&
        leftHint.number === rightHint.number &&
        leftHint.state === rightHint.state &&
        leftHint.checks === rightHint.checks &&
        leftHint.checksStatus === rightHint.checksStatus &&
        leftHint.reviewDecision === rightHint.reviewDecision)
    );
  });
}

export function buildSidebarProjectsFromStructure(input: {
  projects: WorkspaceStructureProject[];
}): SidebarProjectEntry[] {
  return buildSidebarProjectsFromHostProjects({
    projects: input.projects.map((project) => ({
      viewKey: project.viewKey,
      projectKey: project.projectKey,
      projectName: project.projectName,
      projectKind: project.projectKind,
      iconWorkingDir: project.iconWorkingDir,
      hosts: project.hosts,
      workspaceKeys: project.workspaceKeys,
    })),
  });
}

export function buildSidebarProjectsFromHostProjects(input: {
  projects: readonly HostProjectListItem[];
}): SidebarProjectEntry[] {
  if (input.projects.length === 0) {
    return EMPTY_PROJECTS;
  }

  return input.projects.map((project) => ({
    viewKey: project.viewKey,
    projectName: project.projectName,
    projectKind: project.projectKind,
    iconWorkingDir: project.iconWorkingDir,
    hosts: project.hosts,
    workspaces: project.workspaceKeys.map((workspaceKey) =>
      createStructuralWorkspaceEntry({
        project,
        workspaceKey,
      }),
    ),
  }));
}

// Host labels disambiguate which machine a workspace lives on; they only earn their
// space once the visible sidebar spans more than one host. Counting distinct hosts
// across the visible projects (not all connected hosts) keeps labels off when a host
// filter pins the view to a single host.
export function applyStoredOrdering<T>(input: {
  items: T[];
  storedOrder: string[];
  getKey: (item: T) => string;
}): T[] {
  if (input.items.length <= 1 || input.storedOrder.length === 0) {
    return input.items;
  }

  const itemByKey = new Map<string, T>();
  for (const item of input.items) {
    itemByKey.set(input.getKey(item), item);
  }

  const prunedOrder: string[] = [];
  const seen = new Set<string>();
  for (const key of input.storedOrder) {
    if (!itemByKey.has(key) || seen.has(key)) {
      continue;
    }
    seen.add(key);
    prunedOrder.push(key);
  }

  if (prunedOrder.length === 0) {
    return input.items;
  }

  const orderedSet = new Set(prunedOrder);
  const ordered: T[] = [];
  let orderedIndex = 0;

  for (const item of input.items) {
    const key = input.getKey(item);
    if (!orderedSet.has(key)) {
      ordered.push(item);
      continue;
    }

    const targetKey = prunedOrder[orderedIndex] ?? key;
    orderedIndex += 1;
    ordered.push(itemByKey.get(targetKey) ?? item);
  }

  return ordered;
}

export function appendMissingOrderKeys(input: {
  currentOrder: string[];
  visibleKeys: string[];
}): string[] {
  if (input.visibleKeys.length === 0) {
    return input.currentOrder;
  }

  const existingKeys = new Set(input.currentOrder);
  const missingKeys = input.visibleKeys.filter((key) => !existingKeys.has(key));
  if (missingKeys.length === 0) {
    return input.currentOrder;
  }

  return [...input.currentOrder, ...missingKeys];
}

export interface SidebarOrderUpdates {
  projectOrder: string[] | null;
  workspaceOrders: Array<{ projectViewKey: string; order: string[] }>;
}

/**
 * View keys changed shape between releases: a host-local project used to be stored as the
 * `["<serverId>","<projectId>"]` placement key, and a merged project as its remote key. A stored
 * order that predates the current shape still names the same projects, so its old keys are
 * rewritten in place instead of being dropped and re-appended at the bottom — that is what used to
 * scatter separators the user had placed between projects.
 */
function resolveStoredProjectKeys(input: {
  projects: SidebarProjectEntry[];
  storedKeys: string[];
}): string[] {
  const currentViewKeys = new Set(input.projects.map((project) => project.viewKey));
  const viewKeyByPlacement = new Map<string, string>();
  for (const project of input.projects) {
    for (const host of project.hosts) {
      viewKeyByPlacement.set(JSON.stringify([host.serverId, host.projectId]), project.viewKey);
      // A project without a shared remote used to be keyed by its own path on that host.
      viewKeyByPlacement.set(`host:${host.serverId}:${host.iconWorkingDir}`, project.viewKey);
      viewKeyByPlacement.set(host.iconWorkingDir, project.viewKey);
    }
  }
  // The project's identity remote changed shape once (origin -> naming remote). The old keys
  // still name the same project, so a remote key whose repository name unambiguously matches one
  // project is mapped to it rather than dropped.
  const viewKeyByName = new Map<string, string | null>();
  for (const project of input.projects) {
    const names = new Set<string>([
      normalizeProjectName(project.projectName),
      normalizeProjectName(lastPathSegment(project.iconWorkingDir)),
    ]);
    for (const name of names) {
      if (!name) continue;
      const existing = viewKeyByName.get(name);
      viewKeyByName.set(name, existing && existing !== project.viewKey ? null : project.viewKey);
    }
  }

  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const key of input.storedKeys) {
    let mapped = currentViewKeys.has(key) ? key : viewKeyByPlacement.get(key);
    if (!mapped && key.startsWith("remote:")) {
      const name = normalizeProjectName(remoteRepositoryName(key));
      mapped = (name ? viewKeyByName.get(name) : undefined) ?? undefined;
    }
    mapped ??= key;
    if (seen.has(mapped)) continue;
    seen.add(mapped);
    resolved.push(mapped);
  }
  return resolved;
}

function lastPathSegment(path: string): string {
  const segments = path.split(/[\\/]/u).filter(Boolean);
  return segments[segments.length - 1] ?? "";
}

function remoteRepositoryName(key: string): string {
  const withoutPrefix = key.slice("remote:".length);
  const withoutSubdir = withoutPrefix.split("#")[0] ?? withoutPrefix;
  return lastPathSegment(withoutSubdir).replace(/\.git$/u, "");
}

function normalizeProjectName(name: string): string {
  return name.trim().toLowerCase();
}

function sameKeys(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((key, index) => key === right[index]);
}

export function computeSidebarOrderUpdates(input: {
  projects: SidebarProjectEntry[];
  persistedProjectOrder: string[];
  getWorkspaceOrder?: (projectViewKey: string) => string[];
}): SidebarOrderUpdates {
  if (input.projects.length === 0) {
    return { projectOrder: null, workspaceOrders: [] };
  }

  const resolvedOrder = resolveStoredProjectKeys({
    projects: input.projects,
    storedKeys: input.persistedProjectOrder,
  });
  const nextProjectOrder = appendMissingOrderKeys({
    currentOrder: resolvedOrder,
    visibleKeys: input.projects.map((project) => project.viewKey),
  });
  const projectOrder = sameKeys(nextProjectOrder, input.persistedProjectOrder)
    ? null
    : nextProjectOrder;

  const workspaceOrders: Array<{ projectViewKey: string; order: string[] }> = [];
  for (const project of input.projects) {
    if (!input.getWorkspaceOrder) break;
    // A workspace order can be filed under the project's previous key for the same reason.
    const legacyKey = project.hosts
      .map((host) => JSON.stringify([host.serverId, host.projectId]))
      .find((key) => key !== project.viewKey && input.getWorkspaceOrder!(key).length > 0);
    const persistedWorkspaceOrder = input.getWorkspaceOrder(project.viewKey);
    const effectiveOrder =
      persistedWorkspaceOrder.length > 0 || !legacyKey
        ? persistedWorkspaceOrder
        : input.getWorkspaceOrder(legacyKey);
    const nextWorkspaceOrder = appendMissingOrderKeys({
      currentOrder: effectiveOrder,
      visibleKeys: project.workspaces.map((workspace) => workspace.workspaceKey),
    });
    if (nextWorkspaceOrder !== persistedWorkspaceOrder) {
      workspaceOrders.push({ projectViewKey: project.viewKey, order: nextWorkspaceOrder });
    }
  }

  return { projectOrder, workspaceOrders };
}

export interface SidebarLoadingState {
  isLoading: boolean;
  isInitialLoad: boolean;
  isRevalidating: boolean;
}

export function deriveSidebarLoadingState(input: {
  isActive: boolean;
  serverIds: string[];
  hydratedServerIds: string[];
  hasProjects: boolean;
}): SidebarLoadingState {
  const hasRegisteredHosts = input.serverIds.length > 0;
  const allHydrated =
    input.serverIds.length > 0 && input.serverIds.length === input.hydratedServerIds.length;
  const isLoading = input.isActive && hasRegisteredHosts && !allHydrated;
  const isInitialLoad = isLoading && !input.hasProjects;
  return { isLoading, isInitialLoad, isRevalidating: false };
}
