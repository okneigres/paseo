import { describe, expect, it } from "vitest";
import {
  backAddProjectPage,
  cancelNewDirectory,
  chooseAddProjectHost,
  currentAddProjectPage,
  DIRECTORY_BROWSE_ROOT,
  moveAddProjectActiveIndex,
  moveAddProjectSelection,
  navigateDirectoryBrowse,
  openAddProjectFlow,
  openDirectoryBrowsePage,
  openGithubLocationPage,
  openNewDirectoryNamePage,
  openNewDirectoryParentPage,
  setAddProjectActiveIndex,
  setAddProjectPageInput,
  setNewDirectoryError,
  setNewDirectoryName,
  startNewDirectory,
  type AddProjectHost,
} from "./model";
import {
  addProjectMethodEmptyText,
  browseAbsolutePath,
  browseParentPath,
  browseRelativePath,
  buildAddProjectMethods,
  buildCloneLocationOptions,
  buildManualGithubRepositoryChoices,
  directoryNameError,
  filterDirectoryNames,
} from "./options";

const HOST: AddProjectHost = {
  serverId: "host-1",
  label: "Local",
  canAddProject: true,
  canBrowse: true,
  canCloneGithubRepositories: true,
  canSearchGithubRepositories: true,
  canCreateDirectory: true,
};

describe("Add Project navigation", () => {
  it("skips a single connected host without adding it to history", () => {
    const state = openAddProjectFlow({ hosts: [HOST] });

    expect(currentAddProjectPage(state)).toEqual({
      kind: "method",
      hostId: "host-1",
      activeIndex: 0,
      error: null,
      isSubmitting: false,
    });
    expect(backAddProjectPage(state)).toBeNull();
  });

  it("restores page input and selection after Back", () => {
    const secondHost = { ...HOST, serverId: "host-2", label: "Remote" };
    let state = openAddProjectFlow({ hosts: [HOST, secondHost] });
    state = setAddProjectPageInput(state, "rem");
    state = setAddProjectActiveIndex(state, 1);
    state = chooseAddProjectHost(state, secondHost.serverId);
    state = openDirectoryBrowsePage(state, secondHost.serverId);

    state = backAddProjectPage(state) ?? state;
    state = backAddProjectPage(state) ?? state;

    expect(currentAddProjectPage(state)).toEqual({
      kind: "host",
      query: "rem",
      activeIndex: 1,
      error: null,
    });
  });

  it("wraps keyboard selection in both directions", () => {
    expect(moveAddProjectActiveIndex(2, 3, "next")).toBe(0);
    expect(moveAddProjectActiveIndex(0, 3, "previous")).toBe(2);
    expect(moveAddProjectSelection(0, [true, false, true], "next")).toBe(2);
  });

  it("restores a directory name after returning to and reselecting its parent", () => {
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openNewDirectoryParentPage(state, HOST.serverId);
    state = openNewDirectoryNamePage(state, HOST.serverId, "~/dev");
    state = setNewDirectoryName(state, "command-center");
    state = backAddProjectPage(state) ?? state;
    state = openNewDirectoryNamePage(state, HOST.serverId, "~/dev");

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "new-directory-name",
      parentPath: "~/dev",
      name: "command-center",
    });
  });

  it("restores the GitHub destination query and active parent when reopening a repository", () => {
    const repository = {
      id: "repo-1",
      nameWithOwner: "getpaseo/paseo",
      cloneUrl: "git@github.com:getpaseo/paseo.git",
      description: null,
      visibility: "public",
      updatedAt: null,
    };
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openGithubLocationPage(state, HOST.serverId, repository);
    state = setAddProjectPageInput(state, "~/dev");
    state = setAddProjectActiveIndex(state, 2);
    state = backAddProjectPage(state) ?? state;
    state = openGithubLocationPage(state, HOST.serverId, repository);

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "github-location",
      query: "~/dev",
      activeIndex: 2,
    });
  });
});

describe("Add Project options", () => {
  it("hides every mutating method when the host lacks stable project identity", () => {
    const outdatedHost = { ...HOST, canAddProject: false };

    expect(buildAddProjectMethods(outdatedHost)).toEqual([]);
    expect(addProjectMethodEmptyText(outdatedHost)).toBe("Update the host to use Add Project.");
  });

  it("keeps host-upgrade methods discoverable while hiding local-only Browse", () => {
    expect(
      buildAddProjectMethods({
        ...HOST,
        canBrowse: false,
        canCloneGithubRepositories: false,
        canSearchGithubRepositories: false,
        canCreateDirectory: false,
      }),
    ).toEqual([
      {
        id: "directory-search",
        label: "Search for directory",
        description: "Find a directory on Local",
      },
      {
        id: "github",
        label: "Clone from GitHub",
        description: "Update this host to clone GitHub repositories",
        disabled: true,
      },
      {
        id: "new-directory",
        label: "New directory",
        description: "Update this host to create directories",
        disabled: true,
      },
    ]);
  });

  it("offers manual URL and protocol-specific owner/repo clone choices", () => {
    expect(buildManualGithubRepositoryChoices("git@github.com:getpaseo/paseo.git")).toEqual([
      expect.objectContaining({
        id: "manual:git@github.com:getpaseo/paseo.git",
        nameWithOwner: "getpaseo/paseo",
        cloneUrl: "git@github.com:getpaseo/paseo.git",
      }),
    ]);
    expect(buildManualGithubRepositoryChoices("getpaseo/paseo")).toEqual([
      expect.objectContaining({ cloneProtocol: "https", cloneUrl: "getpaseo/paseo" }),
      expect.objectContaining({ cloneProtocol: "ssh", cloneUrl: "getpaseo/paseo" }),
    ]);
    expect(buildManualGithubRepositoryChoices("paseo")).toEqual([]);
  });

  it("shows final clone paths while retaining parent paths as values", () => {
    expect(
      buildCloneLocationOptions({
        parents: ["~/dev", "~/workspace"],
        repositoryName: "paseo",
        existingPaths: ["~/workspace/paseo"],
      }),
    ).toEqual([
      {
        id: "~/dev",
        path: "~/dev",
        displayPath: "~/dev/paseo",
        secondaryText: "Parent directory: ~/dev",
        disabled: false,
      },
      {
        id: "~/workspace",
        path: "~/workspace",
        displayPath: "~/workspace/paseo",
        secondaryText: "Already exists",
        disabled: true,
      },
    ]);
  });

  it("shows equivalent absolute-home and tilde destinations only once", () => {
    expect(
      buildCloneLocationOptions({
        parents: ["/Users/moboudra/dev", "~/dev"],
        repositoryName: "dotfiles",
        existingPaths: [],
      }),
    ).toEqual([
      {
        id: "/Users/moboudra/dev",
        path: "/Users/moboudra/dev",
        displayPath: "/Users/moboudra/dev/dotfiles",
        secondaryText: "Parent directory: /Users/moboudra/dev",
        disabled: false,
      },
    ]);
  });
});

describe("Add Project directory browser", () => {
  it("opens at the host root and resets filter and selection when navigating", () => {
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openDirectoryBrowsePage(state, HOST.serverId);

    expect(currentAddProjectPage(state)).toEqual({
      kind: "directory-browse",
      hostId: HOST.serverId,
      directoryPath: DIRECTORY_BROWSE_ROOT,
      query: "",
      activeIndex: -1,
      error: null,
      newDirectory: null,
      isSubmitting: false,
    });

    state = setAddProjectPageInput(state, "us");
    state = setAddProjectActiveIndex(state, 3);
    state = startNewDirectory(state);
    state = navigateDirectoryBrowse(state, "/Users");

    expect(currentAddProjectPage(state)).toMatchObject({
      kind: "directory-browse",
      directoryPath: "/Users",
      query: "",
      activeIndex: -1,
      newDirectory: null,
    });
  });

  it("drops the selection while the folder filter is typed", () => {
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openDirectoryBrowsePage(state, HOST.serverId);
    state = setAddProjectActiveIndex(state, 2);
    state = setAddProjectPageInput(state, "os");

    expect(currentAddProjectPage(state)).toMatchObject({ query: "os", activeIndex: -1 });
  });

  it("tracks the inline new-folder draft until it is cancelled", () => {
    let state = openAddProjectFlow({ hosts: [HOST] });
    state = openDirectoryBrowsePage(state, HOST.serverId);
    state = startNewDirectory(state);
    state = setNewDirectoryName(state, "repos");
    state = setNewDirectoryError(state, "already exists");

    expect(currentAddProjectPage(state)).toMatchObject({
      newDirectory: { name: "repos", error: "already exists" },
    });

    state = setNewDirectoryName(state, "repos2");
    expect(currentAddProjectPage(state)).toMatchObject({
      newDirectory: { name: "repos2", error: null },
    });

    state = cancelNewDirectory(state);
    expect(currentAddProjectPage(state)).toMatchObject({ newDirectory: null });
  });

  it("converts between the root-relative listing paths and absolute paths", () => {
    expect(browseRelativePath("/")).toBe("");
    expect(browseRelativePath("/Users/os")).toBe("Users/os");
    expect(browseAbsolutePath("Users/os")).toBe("/Users/os");
    expect(browseAbsolutePath("/")).toBe("/");
    expect(browseParentPath("/Users")).toBe("/");
    expect(browseParentPath("/")).toBeNull();
  });

  it("lists folders sorted by name and filters them by the typed query", () => {
    expect(filterDirectoryNames(["src", "Apps", "docs"], "")).toEqual(["Apps", "docs", "src"]);
    expect(filterDirectoryNames(["src", "Apps", "docs"], "PP")).toEqual(["Apps"]);
    expect(filterDirectoryNames(["src", "Apps", "docs"], "ocs")).toEqual(["docs"]);
    expect(filterDirectoryNames(["src"], "zzz")).toEqual([]);
  });

  it("rejects folder names that are not a single path segment", () => {
    expect(directoryNameError("")).toBe("Enter a directory name");
    expect(directoryNameError("..")).toBe("Enter a directory name");
    expect(directoryNameError("a/b")).toBe("Name cannot contain path separators");
    expect(directoryNameError("repos")).toBeNull();
  });
});
