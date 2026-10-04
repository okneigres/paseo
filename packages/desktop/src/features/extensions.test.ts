import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveUnpackedExtensionPaths } from "./extensions.js";

describe("resolveUnpackedExtensionPaths", () => {
  it("splits on the platform delimiter and drops blanks", () => {
    const configured = ["/a/one", " /b/two ", "", "/c/three"].join(path.delimiter);

    expect(resolveUnpackedExtensionPaths(configured)).toEqual(["/a/one", "/b/two", "/c/three"]);
  });

  it("returns nothing when the setting is absent or empty", () => {
    expect(resolveUnpackedExtensionPaths(undefined)).toEqual([]);
    expect(resolveUnpackedExtensionPaths("   ")).toEqual([]);
  });
});
