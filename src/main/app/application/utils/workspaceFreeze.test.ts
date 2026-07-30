import fs from "fs/promises";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
    forgetWorkspaceFreeze,
    getWorkspaceFreeze,
    reportWorkspaceFreeze,
    workspaceFrozenMessage,
} from "./workspaceFreeze";

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
    it("is only the production build and the preview - Dev Mode runs while frozen", async () => {
        // The decision (plan 2026-07-28-002 §1) is that a frozen workspace still runs Dev Mode, and
        // that is invisible in the code: it is the absence of a guard. This pins the absence, so
        // gating DevModeManager later fails a test instead of quietly removing the one runtime an
        // author browsing a revision is still allowed.
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
            "preview/PreviewManager.ts",
            // The handler that fills the record, not a consumer of the guard.
            "window/handlers/workspaceFreezeAction.ts",
        ]);
    });
});

async function listSourceFiles(dir: string): Promise<string[]> {
    const files: string[] = [];
    for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            files.push(...await listSourceFiles(full));
        } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
            files.push(full);
        }
    }
    return files;
}
