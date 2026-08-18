import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ATOMIC_WRITE_TEMP_SUFFIX } from "@shared/utils/fs";
import { isVersioned as sharedIsVersioned } from "@shared/vcs/workingSet";
import { collectWorkingSet, isVersioned } from "./workingSet";

/**
 * The walk. The policy it walks by is tested in `@shared/vcs/workingSet.test.ts`,
 * where the predicate and the ignore file are held against each other.
 */

describe("working set walk", () => {
  let root: string;

  beforeAll(() => {
    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-workingset-")));
    for (const relative of [
      "project.json",
      "editor/story/stories/abc/storydoc.json",
      "resources/icons/derived/icon.png",
      "assets/content/dist/panel.png",
      ".nlstudio/plugins/plugin.js",
      "editor/cache/thumbnail/thumb.png",
      "editor/assets/remote/blob.bin",
      "dist/out.js",
      "node_modules/pkg/index.js",
      `editor/story/index.json${ATOMIC_WRITE_TEMP_SUFFIX}`,
      "assets/screenshots/.DS_Store"
    ]) {
      const absolute = path.join(root, relative);
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, relative);
    }
  });

  afterAll(() => {
    if (root) fs.rmSync(root, { recursive: true, force: true });
  });

  it("re-exports the shared predicate rather than carrying a second copy", () => {
    // The re-export is what keeps this module's importers working after the policy
    // moved to shared. If it ever becomes a local reimplementation, the two drift
    // and the author is shown files as protected that no commit contains.
    expect(isVersioned).toBe(sharedIsVersioned);
  });

  it("returns absolute paths, because a relative one resolves against the wrong directory", async () => {
    // Lore resolves a relative path against the PROCESS working directory, which
    // in an Electron main process is never the project. It then ignores the
    // result for being outside the repository - and reports success.
    const found = await collectWorkingSet(root);
    expect(found.length).toBeGreaterThan(0);
    for (const file of found) expect(path.isAbsolute(file)).toBe(true);
  });

  it("walks exactly what the predicate admits", async () => {
    const found = (await collectWorkingSet(root))
      .map((file) => path.relative(root, file).replace(/\\/g, "/"))
      .sort();
    expect(found).toEqual([
      "assets/content/dist/panel.png",
      "editor/story/stories/abc/storydoc.json",
      "project.json",
      "resources/icons/derived/icon.png"
    ]);
  });
});
