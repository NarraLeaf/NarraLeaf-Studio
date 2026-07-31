import fs from "fs";
import fsPromises from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    applyRevisionRestore,
    planRevisionRestore,
    readWorkingSetPaths,
    RestorePathEscapesProjectError,
    type RevisionRestorePlan,
} from "./revisionRestore";
import type { RevisionFileEntry } from "./revisionReader";

/**
 * What a restore writes, what it removes, and what it must not touch - without a repository.
 *
 * `revisionRestore.integration.test.ts` is the one that proves the bytes really come out of a past
 * revision. What belongs here is the decision, because the decision is where this feature can lose the
 * author's work silently: a deletion aimed one path too wide takes something no revision ever held,
 * and a skipped entry leaves a tree that is neither version with nothing anywhere saying so.
 */

const REVISION_HASH = "a".repeat(64);

let project: string;

function entry(relative: string, size = 8): RevisionFileEntry {
    return { path: relative, size, hash: REVISION_HASH, context: "b".repeat(64) };
}

function write(relative: string, bytes: string): void {
    const absolute = path.join(project, ...relative.split("/"));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes);
}

function exists(relative: string): boolean {
    return fs.existsSync(path.join(project, ...relative.split("/")));
}

function read(relative: string): string {
    return fs.readFileSync(path.join(project, ...relative.split("/")), "utf-8");
}

/** A source that answers each planned entry with its path, so a wrong file is visible in the bytes. */
function sourceOf(files: Map<string, string>) {
    return { read: async (e: RevisionFileEntry) => Buffer.from(files.get(e.path) ?? "") };
}

beforeEach(() => {
    project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-restore-")));
});

afterEach(() => {
    fs.rmSync(project, { recursive: true, force: true });
});

describe("what a restore decides to do", () => {
    it("writes a file the revision has and the working tree lost", () => {
        const plan = planRevisionRestore({
            revision: [entry("editor/story/index.json")],
            working: [],
        });
        expect(plan.write.map((e) => e.path)).toEqual(["editor/story/index.json"]);
        expect(plan.remove).toEqual([]);
    });

    it("writes a file both sides have, without comparing them", () => {
        // No mtime check, no size check, no hash shortcut. "Same size, same time" is exactly how a
        // restore produces a tree that looks right and is not, and rewriting identical bytes is
        // measured not to register as a change - so the unconditional write costs the commit nothing.
        const plan = planRevisionRestore({
            revision: [entry("editor/story/index.json")],
            working: ["editor/story/index.json"],
        });
        expect(plan.write.map((e) => e.path)).toEqual(["editor/story/index.json"]);
        expect(plan.remove).toEqual([]);
    });

    it("removes a file the working tree has and the revision does not", () => {
        // The single most dangerous line in the feature, and the one without which a restore is not a
        // restore: leaving it would hand the author that version PLUS everything added since.
        const plan = planRevisionRestore({
            revision: [entry("editor/story/index.json")],
            working: ["editor/story/index.json", "editor/story/stories/added-later/storydoc.json"],
        });
        expect(plan.remove).toEqual(["editor/story/stories/added-later/storydoc.json"]);
    });

    it("does not write a revision entry that is outside the working set", () => {
        // A repository should never hold one, but a tree is untrusted input. Counted rather than
        // dropped in silence, so a repository that grew one is visible rather than merely harmless.
        const plan = planRevisionRestore({
            revision: [
                entry("editor/story/index.json"),
                entry(".nlstudio/services/panel_state.json"),
                entry("editor/cache/thumbnail/aa/bb/x.png"),
                entry("dist/out.js"),
            ],
            working: [],
        });
        expect(plan.write.map((e) => e.path)).toEqual(["editor/story/index.json"]);
        expect(plan.ignored).toBe(3);
    });

    it("does not remove a working-tree path that is outside the working set", () => {
        // The same rule from the other side, and the side that would cost something: these paths are
        // absent from every revision by construction, so a restore that decided deletions by "not in
        // the revision" alone would delete the author's editor layout, their thumbnail cache and the
        // repository itself on the first press.
        const plan = planRevisionRestore({
            revision: [entry("editor/story/index.json")],
            working: [
                "editor/story/index.json",
                ".nlstudio/services/panel_state.json",
                ".lore/store/x",
                "editor/cache/thumbnail/aa/bb/x.png",
                "dist/out.js",
                "node_modules/left-pad/index.js",
            ],
        });
        expect(plan.remove).toEqual([]);
    });

    it("refuses an escaping path rather than skipping it, on either side", () => {
        // Rejection, not omission. A restore that quietly dropped the entry it did not like would
        // produce a tree matching neither version, and the author would have no way to find out.
        for (const escaping of ["../escape.json", "editor/../../escape.json", "/etc/passwd", "C:/Windows/x"]) {
            expect(() => planRevisionRestore({ revision: [entry(escaping)], working: [] }))
                .toThrow(RestorePathEscapesProjectError);
            expect(() => planRevisionRestore({ revision: [], working: [escaping] }))
                .toThrow(RestorePathEscapesProjectError);
        }
    });

    it("reads a backslash path as the same path, because Windows hands out both spellings", () => {
        const plan = planRevisionRestore({
            revision: [entry("editor/story/index.json")],
            working: ["editor\\story\\index.json"],
        });
        expect(plan.remove).toEqual([]);
    });
});

describe("enumerating what is on disk", () => {
    it("answers repository-relative paths and leaves out everything the working set excludes", async () => {
        write("project.json", "{}");
        write("editor/story/index.json", "{}");
        write(".nlstudio/services/panel_state.json", "{}");
        write("editor/cache/thumbnail/aa/bb/x.png", "png");
        write("dist/out.js", "x");
        write("node_modules/left-pad/index.js", "x");

        const paths = await readWorkingSetPaths(project);

        expect([...paths].sort()).toEqual(["editor/story/index.json", "project.json"]);
        // Forward slashes even here, because the plan compares them against revision paths.
        expect(paths.every((p) => !p.includes("\\"))).toBe(true);
    });
});

describe("carrying a plan out", () => {
    it("writes the revision's bytes and removes what the revision does not have", async () => {
        write("editor/story/index.json", "OLD");
        write("editor/story/stories/added-later/storydoc.json", "ADDED");
        write(".nlstudio/services/panel_state.json", "LAYOUT");

        const plan = planRevisionRestore({
            revision: [entry("editor/story/index.json")],
            working: await readWorkingSetPaths(project),
        });
        const result = await applyRevisionRestore({
            projectPath: project,
            plan,
            source: sourceOf(new Map([["editor/story/index.json", "FROM-REVISION"]])),
        });

        expect(read("editor/story/index.json")).toBe("FROM-REVISION");
        expect(exists("editor/story/stories/added-later/storydoc.json")).toBe(false);
        // The editor's own state is not the author's project, and it is in no revision at all - so a
        // restore that reasoned from "absent at that revision" would take it every time.
        expect(read(".nlstudio/services/panel_state.json")).toBe("LAYOUT");
        expect(result).toMatchObject({ filesWritten: 1, filesRemoved: 1 });
    });

    it("creates directories the revision has and the working tree does not", async () => {
        const plan = planRevisionRestore({
            revision: [entry("editor/story/stories/prologue/storydoc.json")],
            working: [],
        });
        await applyRevisionRestore({
            projectPath: project,
            plan,
            source: sourceOf(new Map([["editor/story/stories/prologue/storydoc.json", "{}"]])),
        });
        expect(read("editor/story/stories/prologue/storydoc.json")).toBe("{}");
    });

    it("clears up the directories its deletions emptied, and only those", async () => {
        write("editor/story/stories/added-later/storydoc.json", "ADDED");
        write("editor/story/stories/kept/storydoc.json", "KEPT");

        const plan = planRevisionRestore({
            revision: [entry("editor/story/stories/kept/storydoc.json")],
            working: await readWorkingSetPaths(project),
        });
        await applyRevisionRestore({
            projectPath: project,
            plan,
            source: sourceOf(new Map([["editor/story/stories/kept/storydoc.json", "KEPT"]])),
        });

        expect(exists("editor/story/stories/added-later")).toBe(false);
        // The pruning walks ancestors, so what stops it at the first non-empty one is `rmdir`'s own
        // refusal rather than a depth limit - which is the property worth pinning.
        expect(exists("editor/story/stories/kept/storydoc.json")).toBe(true);
        expect(exists("editor/story/stories")).toBe(true);
    });

    it("never removes a directory that still holds anything, even one nothing versioned", async () => {
        write("editor/story/stories/added-later/storydoc.json", "ADDED");
        write("editor/story/stories/added-later/.nlstudio/note.txt", "MINE");

        const plan = planRevisionRestore({
            revision: [],
            working: await readWorkingSetPaths(project),
        });
        await applyRevisionRestore({ projectPath: project, plan, source: sourceOf(new Map()) });

        expect(exists("editor/story/stories/added-later/storydoc.json")).toBe(false);
        expect(read("editor/story/stories/added-later/.nlstudio/note.txt")).toBe("MINE");
    });

    it("removes files one at a time and never recurses", async () => {
        // The guard against the single change that would turn this feature into a data-loss bug: one
        // `recursive: true` on a directory that also holds something no revision ever recorded.
        write("editor/story/stories/added-later/storydoc.json", "ADDED");
        const rm = vi.spyOn(fsPromises, "rm");

        const plan = planRevisionRestore({ revision: [], working: await readWorkingSetPaths(project) });
        await applyRevisionRestore({ projectPath: project, plan, source: sourceOf(new Map()) });

        expect(rm).toHaveBeenCalled();
        for (const call of rm.mock.calls) {
            expect((call[1] as { recursive?: boolean } | undefined)?.recursive).toBe(false);
        }
        rm.mockRestore();
    });

    it("cannot be made to write or delete outside the project by a forged plan", async () => {
        // `planRevisionRestore` already refuses these, so reaching the writer means the plan came from
        // somewhere else. The guard is repeated at the call that actually touches the disk precisely so
        // it does not depend on another function having been called first - and `path.join` CONTAINS an
        // absolute segment rather than rejecting it, which a string test alone would miss.
        const outside = path.join(path.dirname(project), "nl-restore-escape.json");
        fs.writeFileSync(outside, "NOT-YOURS");
        try {
            const forged: RevisionRestorePlan = {
                write: [entry("../nl-restore-escape.json")],
                remove: [],
                ignored: 0,
            };
            await expect(applyRevisionRestore({ projectPath: project, plan: forged, source: sourceOf(new Map()) }))
                .rejects.toThrow(RestorePathEscapesProjectError);

            const forgedRemoval: RevisionRestorePlan = {
                write: [],
                remove: ["../nl-restore-escape.json"],
                ignored: 0,
            };
            await expect(applyRevisionRestore({ projectPath: project, plan: forgedRemoval, source: sourceOf(new Map()) }))
                .rejects.toThrow(RestorePathEscapesProjectError);

            expect(fs.readFileSync(outside, "utf-8")).toBe("NOT-YOURS");
        } finally {
            fs.rmSync(outside, { force: true });
        }
    });

    it("reports what it did, because the caller has to be able to say so", async () => {
        write("editor/gone.json", "GONE");
        const messages: string[] = [];
        const plan = planRevisionRestore({
            revision: [entry("editor/story/index.json")],
            working: await readWorkingSetPaths(project),
        });

        const result = await applyRevisionRestore({
            projectPath: project,
            plan,
            source: sourceOf(new Map([["editor/story/index.json", "12345"]])),
            onProgress: (message) => messages.push(message),
        });

        expect(result.bytesWritten).toBe(5);
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
        expect(messages.some((m) => m.includes("restoring 1 file(s), removing 1"))).toBe(true);
        expect(messages.some((m) => /restored 1 file\(s\), removed 1, in \d+ ms/.test(m))).toBe(true);
    });
});
