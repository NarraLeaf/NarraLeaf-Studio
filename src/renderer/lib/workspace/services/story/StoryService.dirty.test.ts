import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * A story service whose filesystem can be told what to do with each write.
 *
 * The whole point of per-file dirty tracking is that a save writes *less*, and the whole risk is
 * that it writes less than it owes. So the harness records every path handed to `fs.write`, and can
 * make one path fail or be refused - the two ways a write can end without the bytes reaching the
 * disk, and the two ways a debt-tracking writer can lose an author's work.
 */
function createHarness() {
    const history = new HistoryService();
    const service = new StoryService();
    const files = new Map<string, string>();
    let nextId = 0;
    const uuid = () => {
        const n = (++nextId).toString(16).padStart(12, "0");
        return `00000000-0000-4000-8000-${n}`;
    };

    /** Paths whose write must fail, and paths whose write must be refused (frozen). */
    const failing = new Set<string>();
    const refusing = new Set<string>();
    /** Runs once, between a write's serialization and its completion. */
    let duringWrite: (() => void) | null = null;

    const fs = {
        write: vi.fn(async (path: string, data: string) => {
            if (duringWrite) {
                const hook = duringWrite;
                duringWrite = null;
                await Promise.resolve();
                hook();
            }
            if (matches(refusing, path)) {
                // Exactly what `BaseFileSystemService.write` answers for a frozen workspace.
                return { ok: true as const, data: undefined, refused: true as const };
            }
            if (matches(failing, path)) {
                return { ok: false as const, error: { message: `refused ${path}`, code: "EACCES" } };
            }
            files.set(path, data);
            return { ok: true as const, data: undefined };
        }),
        read: vi.fn(async (path: string) => {
            const data = files.get(path);
            return data === undefined
                ? { ok: false as const, error: { message: "missing", code: "ENOENT" } }
                : { ok: true as const, data };
        }),
        deleteFile: vi.fn(async (path: string) => {
            files.delete(path);
            return { ok: true as const, data: undefined };
        }),
        deleteDir: vi.fn(async (dir: string) => {
            for (const key of [...files.keys()]) {
                if (key.startsWith(dir)) {
                    files.delete(key);
                }
            }
            return { ok: true as const, data: undefined };
        }),
        isFileExists: vi.fn(async (path: string) => ({ ok: true as const, data: files.has(path) })),
        isDirExists: vi.fn(async (_dir: string) => ({ ok: true as const, data: true })),
        createDir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        mkdir: vi.fn(async () => ({ ok: true as const, data: undefined })),
    };

    const context = {
        project: {
            resolve: (...parts: (string | string[])[]) =>
                parts.flatMap(part => (Array.isArray(part) ? part : [part])).join("/").replace(/\/+/g, "/"),
        },
        services: {
            get(id: Services) {
                switch (id) {
                    case Services.History: return history;
                    case Services.FileSystem: return fs;
                    case Services.Uuid: return { generate: uuid };
                    case Services.Assets: return { lockAsset: vi.fn(), unlockAsset: vi.fn() };
                    case Services.Project: return {};
                    default: throw new Error(`Unexpected service ${id}`);
                }
            },
        } as never,
    } as never;
    history.setContext(context);
    service.setContext(context);
    (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };

    return {
        service,
        history,
        files,
        fs,
        failing,
        refusing,
        setDuringWrite(hook: () => void) { duringWrite = hook; },
        /** Paths written since the last {@link reset}, in order. */
        written: () => fs.write.mock.calls.map(call => call[0] as string),
        /** The library index only - `animations/index.json` shares the basename. */
        libraryIndexWrites: () =>
            fs.write.mock.calls.map(call => call[0] as string).filter(path => path === "editor/story/index.json"),
        reset: () => fs.write.mockClear(),
    };
}

function matches(set: Set<string>, path: string): boolean {
    for (const needle of set) {
        if (path.includes(needle)) {
            return true;
        }
    }
    return false;
}

/** A story with one chapter and one scene, already on disk and clean. */
async function seedStory(service: StoryService, name: string) {
    const entry = service.createStory(name);
    const chapter = service.getStoryDocument(entry.id).chapters[0];
    const sceneId = chapter.sceneIds[0];
    await service.saveStory(entry.id);
    return { entry, sceneId, chapterId: chapter.id };
}

describe("StoryService per-file dirty tracking", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("writes only the story that changed, out of three", async () => {
        const { service, history, reset, written } = harness;
        const first = await seedStory(service, "First");
        const second = await seedStory(service, "Second");
        const third = await seedStory(service, "Third");
        history.clearScope(projectHistoryScope());
        reset();

        expect(service.renameScene(second.entry.id, second.sceneId, "Only this one")).toBe(true);
        await service.flushPendingChanges();

        const paths = written();
        expect(paths.filter(path => path.includes(second.entry.id))).toHaveLength(1);
        expect(paths.filter(path => path.includes(first.entry.id))).toHaveLength(0);
        expect(paths.filter(path => path.includes(third.entry.id))).toHaveLength(0);
        expect(service.isDirty()).toBe(false);
    });

    it("writes nothing at all when a save finds nothing owed", async () => {
        const { service, reset, written } = harness;
        await seedStory(service, "Quiet");
        reset();

        await service.flushPendingChanges();
        await (service as never as { flush: () => Promise<void> }).flush();

        expect(written()).toHaveLength(0);
    });

    it("still rewrites a document whose edits were undone back to the saved state", async () => {
        const { service, files, reset, written } = harness;
        const story = await seedStory(service, "RoundTrip");
        const path = [...files.keys()].find(key => key.includes(story.entry.id))!;
        const savedBytes = files.get(path)!;
        reset();

        // Out and back: memory ends up equal to what is already on disk. Nothing here is allowed to
        // conclude "so there is nothing to write" - the debt is per file, never per content, because
        // a content comparison that is wrong once is an edit that never reaches the disk.
        service.renameScene(story.entry.id, story.sceneId, "Changed");
        service.renameScene(story.entry.id, story.sceneId, "Scene 1");
        await service.flushPendingChanges();

        expect(written().filter(p => p === path)).toHaveLength(1);
        expect(service.isDirty()).toBe(false);
        // `updatedAt` moves, so the bytes are not identical; the scene the author sees must be.
        expect(JSON.parse(files.get(path)!).scenes[story.sceneId].name).toBe("Scene 1");
        expect(JSON.parse(savedBytes).scenes[story.sceneId].name).toBe("Scene 1");
    });

    it("keeps the debt when a write fails, and does not let the failure starve the other stories", async () => {
        const { service, history, failing, reset, written } = harness;
        const broken = await seedStory(service, "Broken");
        const healthy = await seedStory(service, "Healthy");
        history.clearScope(projectHistoryScope());

        failing.add(broken.entry.id);
        service.renameScene(broken.entry.id, broken.sceneId, "A");
        service.renameScene(healthy.entry.id, healthy.sceneId, "B");
        reset();

        await expect(service.flushPendingChanges()).rejects.toThrow();

        // The unwritable story must not stop the writable one: a flush that gave up at the first
        // failure would retry from the top forever and never reach the story behind it.
        expect(written().filter(path => path.includes(healthy.entry.id))).toHaveLength(1);
        expect(service.isDirty()).toBe(true);

        failing.clear();
        reset();
        await (service as never as { flush: () => Promise<void> }).flush();
        expect(written().filter(path => path.includes(broken.entry.id))).toHaveLength(1);
        expect(service.isDirty()).toBe(false);
    });

    it("keeps the debt when the write gate refuses, even though a refusal answers ok", async () => {
        const { service, refusing, reset, written } = harness;
        const story = await seedStory(service, "Frozen");
        const other = await seedStory(service, "Other");
        reset();

        // A frozen workspace answers `{ ok: true }` and writes nothing. Read as success, the edit is
        // lost outright: nothing else would ever rewrite this document.
        refusing.add(story.entry.id);
        service.renameScene(story.entry.id, story.sceneId, "Written while frozen");
        await service.flushPendingChanges();

        expect(written().filter(path => path.includes(story.entry.id))).toHaveLength(1);
        expect(service.isDirty()).toBe(true);

        refusing.clear();
        reset();
        await (service as never as { flush: () => Promise<void> }).flush();
        expect(written().filter(path => path.includes(story.entry.id))).toHaveLength(1);
        expect(written().filter(path => path.includes(other.entry.id))).toHaveLength(0);
        expect(service.isDirty()).toBe(false);
    });

    it("does not mistake an edit that lands mid-write for the state it just wrote", async () => {
        const { service, files, setDuringWrite, reset, written } = harness;
        const story = await seedStory(service, "Racing");
        reset();

        service.renameScene(story.entry.id, story.sceneId, "First");
        // Lands after the bytes were taken, before the write completes - an author typing while the
        // auto-save is in flight. The name below is never in the payload being written.
        setDuringWrite(() => {
            service.renameScene(story.entry.id, story.sceneId, "Second");
        });
        await service.flushPendingChanges();

        const path = [...files.keys()].find(key => key.includes(story.entry.id))!;
        expect(JSON.parse(files.get(path)!).scenes[story.sceneId].name).toBe("First");
        expect(service.isDirty()).toBe(true);

        reset();
        await (service as never as { flush: () => Promise<void> }).flush();
        expect(written().filter(p => p === path)).toHaveLength(1);
        expect(JSON.parse(files.get(path)!).scenes[story.sceneId].name).toBe("Second");
        expect(service.isDirty()).toBe(false);
    });

    it("writes a new story even when its eager first write never landed", async () => {
        const { service, failing, reset, written } = harness;
        // createStory persists on a floating promise whose failure is only logged. The debt has to
        // outlive it, or a story created during a bad moment on disk exists only in memory.
        failing.add("storydoc");
        const entry = service.createStory("Newborn");
        await new Promise(resolve => setTimeout(resolve, 0));

        failing.clear();
        reset();
        await (service as never as { flush: () => Promise<void> }).flush();
        expect(written().filter(path => path.includes(entry.id))).toHaveLength(1);
    });

    it("drops the debt of a story that was deleted before the save ran", async () => {
        const { service, reset, written } = harness;
        const doomed = await seedStory(service, "Doomed");
        const kept = await seedStory(service, "Kept");

        service.renameScene(doomed.entry.id, doomed.sceneId, "About to go");
        expect(await service.deleteStory(doomed.entry.id)).toBe(true);
        reset();

        await (service as never as { flush: () => Promise<void> }).flush();
        expect(written().filter(path => path.includes(doomed.entry.id))).toHaveLength(0);
        expect(written().filter(path => path.includes(kept.entry.id))).toHaveLength(0);
    });

    it("saveStory stays dirty while another story is still owed", async () => {
        const { service, history } = harness;
        const one = await seedStory(service, "One");
        const two = await seedStory(service, "Two");
        history.clearScope(projectHistoryScope());

        service.renameScene(one.entry.id, one.sceneId, "Edited one");
        service.renameScene(two.entry.id, two.sceneId, "Edited two");
        await service.saveStory(one.entry.id);

        // Reporting clean here is how the second story's edits get dropped at quit time.
        expect(service.isDirty()).toBe(true);

        await (service as never as { flush: () => Promise<void> }).flush();
        expect(service.isDirty()).toBe(false);
    });

    it("asks the disk about each directory once, not once per save", async () => {
        const { service, fs } = harness;
        const story = await seedStory(service, "Repeat");
        fs.isDirExists.mockClear();

        for (let i = 0; i < 3; i++) {
            service.renameScene(story.entry.id, story.sceneId, `Pass ${i}`);
            await service.flushPendingChanges();
        }

        // Seven per save before this: three for the story tree, one for the document's own
        // directory, then the same three again for the library index.
        expect(fs.isDirExists).not.toHaveBeenCalled();
    });

    it("re-checks the directories after a write fails, so the retry can re-create them", async () => {
        const { service, failing, fs } = harness;
        const story = await seedStory(service, "Vanishing");
        fs.isDirExists.mockClear();

        // What a VCS checkout or another window removing the directory looks like from here: the
        // write fails even though this service last saw the directory present.
        failing.add(story.entry.id);
        service.renameScene(story.entry.id, story.sceneId, "Into the void");
        await expect(service.flushPendingChanges()).rejects.toThrow();

        failing.clear();
        fs.isDirExists.mockClear();
        await (service as never as { flush: () => Promise<void> }).flush();

        // A memo kept across a failure would make every rung of the retry ladder repeat the same
        // doomed write against a directory nothing ever re-creates.
        expect(fs.isDirExists).toHaveBeenCalled();
        expect(service.isDirty()).toBe(false);
    });

    it("re-checks a restored story's directory, which its deletion removed", async () => {
        const { service, history, fs } = harness;
        const story = await seedStory(service, "Undeleted");
        expect(await service.deleteStory(story.entry.id)).toBe(true);
        await service.flushPendingChanges();
        fs.isDirExists.mockClear();

        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();

        // The directory went with the story. Still believing in it here is how the restoring write
        // lands in a directory that no longer exists - the one case a memo cannot be allowed to
        // answer from, because this service is the thing that removed it.
        const asked = fs.isDirExists.mock.calls.map(call => call[0]);
        expect(asked.some(path => path.includes(story.entry.id))).toBe(true);
    });

    /**
     * The library index carries two very different debts on one flag's worth of intent: what the
     * author wrote (a story's name, its position, the default story) and a mirror of each document's
     * `updatedAt`. Only the first is work that can be lost. These say so.
     */
    describe("library index", () => {
        /**
         * ISO timestamps have millisecond resolution. A test that edits inside the same millisecond
         * as the save it follows produces a stamp that did not move, and `markStoryEntrySaved`
         * correctly does nothing - which would make every assertion below pass for the wrong reason.
         */
        const nextMillisecond = () => new Promise(resolve => setTimeout(resolve, 2));
        const stampOwed = (service: StoryService) =>
            (service as never as { libraryStampsDirty: boolean }).libraryStampsDirty;

        it("leaves the index alone while the author is still typing, and does not call that dirty", async () => {
            const { service, setDuringWrite, reset, libraryIndexWrites } = harness;
            const story = await seedStory(service, "Typing");
            await nextMillisecond();
            reset();

            service.renameScene(story.entry.id, story.sceneId, "One");
            // A keystroke landing while the write is in flight. It re-arms the auto-saver, which is
            // exactly the signal that another save is coming and the mirror can wait for it.
            setDuringWrite(() => {
                service.renameScene(story.entry.id, story.sceneId, "Two");
            });
            await service.flushPendingChanges();

            expect(libraryIndexWrites()).toHaveLength(0);
            // Owed, not absent: the deferral is what is under test, not a stamp that never moved.
            expect(stampOwed(service)).toBe(true);

            // Write the document the mid-write edit re-owed, still mid-streak. Nothing is owed to
            // the disk after it: an unwritten timestamp is not unsaved work, and reporting it as
            // such would light the indicator over a project that has none.
            await (service as never as { flush: () => Promise<void> }).flush();
            expect(libraryIndexWrites()).toHaveLength(0);
            expect(service.isDirty()).toBe(false);
        });

        it("settles the index on the first save after the edits stop", async () => {
            const { service, files, reset, libraryIndexWrites } = harness;
            const story = await seedStory(service, "Settling");
            await nextMillisecond();
            reset();

            service.renameScene(story.entry.id, story.sceneId, "Done typing");
            await service.flushPendingChanges();

            expect(libraryIndexWrites()).toHaveLength(1);
            expect(stampOwed(service)).toBe(false);
            const index = JSON.parse(files.get("editor/story/index.json")!);
            const document = JSON.parse(files.get([...files.keys()].find(key => key.includes(story.entry.id))!)!);
            expect(index.stories.find((entry: { id: string }) => entry.id === story.entry.id).updatedAt)
                .toBe(document.meta.updatedAt);
        });

        it("writes the index mid-streak anyway when the library itself changed", async () => {
            const { service, setDuringWrite, reset, libraryIndexWrites } = harness;
            const story = await seedStory(service, "Renamed");
            reset();

            // A name lives in the index and nowhere else. Deferring this is losing it.
            expect(service.renameStory(story.entry.id, "New name")).toBe(true);
            setDuringWrite(() => {
                service.renameScene(story.entry.id, story.sceneId, "Still typing");
            });
            await service.flushPendingChanges();

            expect(libraryIndexWrites()).toHaveLength(1);
        });

        it("re-owes a refused index write unconditionally, so it cannot be deferred away", async () => {
            const { service, refusing, setDuringWrite, reset, libraryIndexWrites } = harness;
            const story = await seedStory(service, "Refused");
            await nextMillisecond();
            reset();

            refusing.add("editor/story/index.json");
            expect(service.renameStory(story.entry.id, "Named while frozen")).toBe(true);
            await service.flushPendingChanges();
            expect(libraryIndexWrites()).toHaveLength(1);
            expect(service.isDirty()).toBe(true);

            // The refusal put the debt back. It has to come back as the *authored* kind: downgrading
            // it to a deferrable stamp is how a story's new name never reaches the disk.
            refusing.clear();
            reset();
            service.renameScene(story.entry.id, story.sceneId, "Typing again");
            setDuringWrite(() => {
                service.renameScene(story.entry.id, story.sceneId, "And again");
            });
            await service.flushPendingChanges();

            expect(libraryIndexWrites()).toHaveLength(1);
            expect(JSON.parse(harness.files.get("editor/story/index.json")!).stories[0].name).toBe("Named while frozen");
        });
    });

    it("writes a motion asset only when that motion changed", async () => {
        const { service, reset, written } = harness;
        const first = await service.createAnimationAsset({ name: "First" });
        const second = await service.createAnimationAsset({ name: "Second" });
        await (service as never as { flush: () => Promise<void> }).flush();
        reset();

        service.updateAnimationAsset(second.id, asset => ({ ...asset, name: "Renamed" }));
        await (service as never as { flush: () => Promise<void> }).flush();

        const paths = written();
        expect(paths.filter(path => path.includes(second.id))).toHaveLength(1);
        expect(paths.filter(path => path.includes(first.id))).toHaveLength(0);
    });
});
