import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { isVcsPlatformSupported, type VcsRestoreResult } from "@shared/types/vcs";
import type { BaseApp } from "../../baseApp";
import type { LoreGlobals } from "./lore/call";
import { flushRepository, releaseRepository } from "./lore/verbs";
import { initRepository } from "./repository";
import { VcsManager } from "./VcsManager";

/**
 * Putting the working tree back to a past revision, against the real library and a real repository.
 *
 * Three claims here cannot be tested any other way, and all three are what an author is trusting when
 * they press the button:
 *
 *  - **the bytes on disk afterwards are the revision's**, including the asset bytes - a Dev Mode
 *    snapshot may leave those in the repository because nothing in the compile path opens one, and a
 *    restore may not, because a project whose documents went back to last week while the sprites
 *    stayed current is not the version they asked for;
 *  - **the work they had is still reachable** - the checkpoint taken before the first write is the
 *    entire safety argument, so this reads it back rather than merely observing that a revision
 *    appeared;
 *  - **nothing was rewound** - every revision between the target and the old head is still there,
 *    which is the difference between this design and the one that quietly discards a week.
 *
 * Only runs where Epic ships a native build (docs/version-control.md §7).
 *
 * Teardown is not optional: Lore's repository lock is EXCLUSIVE and blocking, so a session left open
 * makes the next run of this file wait instead of fail, and on Windows the temp directory cannot be
 * removed at all. flush -> closeStore -> release, in that order (§4.15, §4.19).
 */

const supported = isVcsPlatformSupported() || Boolean(process.env.LORE_LIB_PATH);

const STORY = "editor/story/stories/prologue/storydoc.json";
/** The author's art. Skipped by the Dev Mode snapshot on purpose; a restore has no such licence. */
const SPRITE = "assets/content/ff/ee/0123456789abcdef0123456789ab";
/** Added after the target revision, so restoring has to take it away again. */
const ADDED_LATER = "editor/story/stories/epilogue/storydoc.json";
/** Studio's own state. In no revision at all, and must survive every restore. */
const EDITOR_STATE = ".nlstudio/services/panel_state.json";

let root: string;
let globals: LoreGlobals;
let manager: VcsManager;
let firstRevision: string;
let secondRevision: string;
let secondNumber: number;
let restored: VcsRestoreResult;

function write(relative: string, bytes: string | Buffer): void {
    const absolute = path.join(root, ...relative.split("/"));
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, bytes as never);
}

function read(relative: string): string {
    return fs.readFileSync(path.join(root, ...relative.split("/")), "utf-8");
}

function exists(relative: string): boolean {
    return fs.existsSync(path.join(root, ...relative.split("/")));
}

function fakeApp(): BaseApp {
    const noop = () => undefined;
    return {
        logger: { info: noop, warn: noop, error: noop, debug: noop },
        getGlobalState: () => ({ get: () => undefined }),
    } as unknown as BaseApp;
}

beforeAll(async () => {
    if (!supported) return;

    root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "nl-restore-")));
    globals = { repositoryPath: root, offline: true, cache: true };

    write("project.json", JSON.stringify({ name: "prologue" }));
    write(STORY, JSON.stringify({ version: 9, scenes: ["FIRST"] }));
    write(SPRITE, "SPRITE-V1");
    write(EDITOR_STATE, JSON.stringify({ layout: "mine" }));
    await initRepository(globals, { identity: "author@narraleaf" });

    manager = new VcsManager(fakeApp());
    firstRevision = (await manager.getHistory(root))[0].revision;

    // A second revision that differs in every way a restore has to undo: a changed document, changed
    // asset BYTES, and a file that did not exist before.
    write(STORY, JSON.stringify({ version: 9, scenes: ["SECOND"] }));
    write(SPRITE, "SPRITE-V2");
    write(ADDED_LATER, JSON.stringify({ version: 9, scenes: ["EPILOGUE"] }));
    const second = await manager.commit(root, { message: "second" });
    secondRevision = second.revision;
    secondNumber = second.number;

    // Uncommitted work, so the checkpoint has something to protect. Without this the test would pass
    // just as well against an implementation that never took one.
    write(STORY, JSON.stringify({ version: 9, scenes: ["UNSAVED"] }));

    restored = await manager.restoreRevision(root, firstRevision, { label: "#1" });
}, 300_000);

afterAll(async () => {
    if (!supported) return;
    await manager?.dispose().catch(() => undefined);
    await flushRepository(globals).catch(() => undefined);
    await releaseRepository(globals).catch(() => undefined);
    if (root) {
        for (let attempt = 0; attempt < 20; attempt++) {
            try {
                fs.rmSync(root, { recursive: true, force: true });
                break;
            } catch {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        }
    }
}, 120_000);

describe.skipIf(!supported)("restoring the working tree to a revision", () => {
    it("puts the documents back", () => {
        expect(JSON.parse(read(STORY)).scenes).toEqual(["FIRST"]);
    });

    it("puts the ASSET BYTES back, which is where a restore differs from a Dev Mode snapshot", () => {
        // The snapshot skips `assets/content/**` because the compile path never opens one and the
        // Dev Mode window resolves asset URLs through the working tree anyway. A restore that
        // borrowed that shortcut would hand the author last week's script over this week's art, with
        // nothing on screen to say so.
        expect(read(SPRITE)).toBe("SPRITE-V1");
    });

    it("removes a file that only exists because it was added later", () => {
        // Without this a restore is a merge nobody asked for: that version, plus everything since.
        expect(exists(ADDED_LATER)).toBe(false);
    });

    it("leaves everything outside the working set alone", () => {
        // Studio's own state is in no revision, so a restore reasoning from "absent at that revision"
        // rather than from `isVersioned` would take the author's panel layout every time - and the
        // repository itself with it.
        expect(JSON.parse(read(EDITOR_STATE)).layout).toBe("mine");
        expect(exists(".lore")).toBe(true);
        expect(exists(".loreignore")).toBe(true);
    });

    it("records the pre-restore work as a checkpoint that can be read back", async () => {
        expect(restored.checkpoint).not.toBeNull();
        // The assertion the whole confirmation dialog rests on: not that a checkpoint EXISTS, but
        // that the author's unsaved sentence is inside it and can be got out again.
        const held = await manager.readBlob({
            projectPath: root,
            revision: restored.checkpoint!.revision,
            path: STORY,
        });
        expect(JSON.parse(held.toString("utf-8")).scenes).toEqual(["UNSAVED"]);
    }, 120_000);

    it("records the restore as a NEW revision rather than moving the branch back", () => {
        expect(restored.revision).not.toBeNull();
        expect(restored.revision!.number).toBeGreaterThan(secondNumber);
        expect(restored.from).toBe(firstRevision);
    });

    it("keeps every revision that was already there", async () => {
        // The one property that makes a regretted restore survivable. A design that rewound the
        // branch would pass every assertion above and lose the author's week.
        const history = await manager.getHistory(root);
        const revisions = history.map((entry) => entry.revision);
        expect(revisions).toContain(firstRevision);
        expect(revisions).toContain(secondRevision);
        expect(revisions).toContain(restored.checkpoint!.revision);
        expect(revisions[0]).toBe(restored.revision!.revision);
    }, 120_000);

    it("commits everything it wrote, so the tree is clean afterwards", async () => {
        const status = await manager.getStatus(root);
        expect(status.files.filter((file) => !file.directory)).toEqual([]);
    }, 120_000);

    it("answers a second restore of the same revision with no revision and no checkpoint", async () => {
        // Restoring to what is already on disk changes nothing, and an empty revision every time
        // someone pressed the button would make the history unreadable. Neither half is a failure.
        const again = await manager.restoreRevision(root, firstRevision, { label: "#1" });
        expect(again.checkpoint).toBeNull();
        expect(again.revision).toBeNull();
        expect(again.filesRemoved).toBe(0);
    }, 120_000);

    it("refuses an unknown revision without leaving a checkpoint behind for it", async () => {
        // The reason the revision is enumerated BEFORE the checkpoint is taken: a restore that turns
        // out to be impossible must not have already added a revision to the author's history.
        const before = (await manager.getHistory(root)).length;
        await expect(manager.restoreRevision(root, "f".repeat(64))).rejects.toThrow();
        expect((await manager.getHistory(root)).length).toBe(before);
    }, 120_000);
});
