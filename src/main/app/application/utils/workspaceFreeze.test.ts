import fs from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  forgetWorkspaceFreeze,
  getWorkspaceFreeze,
  getWorkspaceFreezeState,
  reportWorkspaceFreeze,
  workspaceFrozenMessage
} from "./workspaceFreeze";

const REVISION = "abc123def456".padEnd(64, "0");

const PROJECT = path.resolve(path.join("/tmp", "nls-freeze-a"));
const OTHER_PROJECT = path.resolve(path.join("/tmp", "nls-freeze-b"));

afterEach(() => {
  forgetWorkspaceFreeze(PROJECT);
  forgetWorkspaceFreeze(OTHER_PROJECT);
});

describe("workspace freeze record", () => {
  it("allows by default, before any window has reported anything", () => {
    // A guard that refused until it was told otherwise would refuse the build in every window
    // that never froze - including every window opened before this feature existed.
    expect(getWorkspaceFreeze(PROJECT)).toBeNull();
  });

  it("remembers a freeze and forgets it again on thaw", () => {
    reportWorkspaceFreeze(PROJECT, "revision");
    expect(getWorkspaceFreeze(PROJECT)).toBe("revision");
    reportWorkspaceFreeze(PROJECT, null);
    expect(getWorkspaceFreeze(PROJECT)).toBeNull();
  });

  it("keeps one project's freeze out of another's", () => {
    // Studio is one project per window; a single flag would let the window browsing history
    // refuse the build in the window next to it.
    reportWorkspaceFreeze(PROJECT, "manual");
    expect(getWorkspaceFreeze(OTHER_PROJECT)).toBeNull();
  });

  it("matches the spelling the managers look it up by", () => {
    // Both managers key their per-project state with path.resolve. A record keyed differently
    // would fail open, which is the one failure nobody would notice.
    reportWorkspaceFreeze(path.join(PROJECT, "sub", ".."), "revision");
    expect(getWorkspaceFreeze(PROJECT + path.sep)).toBe("revision");
  });

  it("forgets a project outright, for when its window is gone", () => {
    reportWorkspaceFreeze(PROJECT, "revision");
    forgetWorkspaceFreeze(PROJECT);
    expect(getWorkspaceFreeze(PROJECT)).toBeNull();
  });

  it("remembers which revision, because Dev Mode has to compile that one", () => {
    reportWorkspaceFreeze(PROJECT, "revision", REVISION);
    expect(getWorkspaceFreezeState(PROJECT)).toEqual({ kind: "revision", revision: REVISION });
  });

  it("keeps no revision on a manual freeze", () => {
    // A manual freeze that inherited the last revision browsed would make Dev Mode run history
    // while the author believes they are on their own files - and during a manual freeze the working
    // tree IS what they are looking at.
    reportWorkspaceFreeze(PROJECT, "revision", REVISION);
    reportWorkspaceFreeze(PROJECT, "manual", REVISION);
    expect(getWorkspaceFreezeState(PROJECT)).toEqual({ kind: "manual" });
  });

  it("records a revision freeze that named no revision, so its reader can refuse", () => {
    // Reachable from a renderer older than the field. Recording the freeze without an id is what
    // lets Dev Mode refuse rather than fall back to the working tree.
    reportWorkspaceFreeze(PROJECT, "revision");
    expect(getWorkspaceFreezeState(PROJECT)).toEqual({ kind: "revision" });
  });
});

describe("workspaceFrozenMessage", () => {
  it("tells the author to leave the revision they are reading", () => {
    const message = workspaceFrozenMessage("revision", "production build");
    expect(message).toContain("production build");
    expect(message).toContain("Leave the revision");
  });

  it("tells the author to unfreeze when they froze it by hand", () => {
    const message = workspaceFrozenMessage("manual", "preview");
    expect(message).toContain("preview");
    expect(message).toContain("Unfreeze the workspace");
    // "Leave the revision" would be nonsense advice for a manual freeze.
    expect(message).not.toContain("Leave the revision");
  });
});

describe("who consults the freeze record", () => {
  it("is refused by the build, the preview and a test's game - Dev Mode reads it to run the revision", async () => {
    // The decision is that a frozen workspace still runs Dev Mode, and
    // that Dev Mode runs the FOCUSED REVISION rather than the working tree. So the list below has
    // two kinds of entry on it and they must not be confused: managers that refuse, and one
    // reader that asks which revision so it can compile that one. A `workspaceFrozenMessage` call
    // appearing in the Dev Mode entry would mean Run had been turned into a refusal, which
    // would take away the only runtime an author browsing a revision is left with.
    //
    // `GameTestManager` joined the refusers with the test pipeline: a
    // test that launches a game goes through the same gate Preview does, or picking a windowed
    // test would be a way around it. Headless tests are unaffected - they never come here, which
    // is why a frozen workspace can still run project diagnostics.
    const managersRoot = path.resolve(__dirname, "..", "managers");
    const consumers: string[] = [];
    for (const file of await listSourceFiles(managersRoot)) {
      const source = await fs.readFile(file, "utf-8");
      if (source.includes("utils/workspaceFreeze")) {
        consumers.push(path.relative(managersRoot, file).replace(/\\/g, "/"));
      }
    }
    expect(consumers.sort()).toEqual([
      "build/GameBuildManager.ts",
      // Reads the record to learn WHICH revision; never refuses on the strength of it.
      "devMode/revisionLaunchSource.ts",
      "gameTest/GameTestManager.ts",
      "preview/PreviewManager.ts",
      // The handler that fills the record, not a consumer of the guard.
      "window/handlers/workspaceFreezeAction.ts"
    ]);

    const devMode = await fs.readFile(
      path.join(managersRoot, "devMode", "revisionLaunchSource.ts"),
      "utf-8"
    );
    expect(devMode).not.toContain("workspaceFrozenMessage");
  });
});

async function listSourceFiles(dir: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSourceFiles(full)));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
      files.push(full);
    }
  }
  return files;
}
