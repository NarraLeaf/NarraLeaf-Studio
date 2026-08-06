import { beforeEach, describe, expect, it, vi } from "vitest";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * A story service over an in-memory filesystem.
 *
 * The two deletions that reach disk (`deleteStory`, `deleteAnimationAsset`) are the reason this
 * needs a filesystem at all: undo has to write the document back, and asserting that it did is the
 * whole point of those cases.
 */
function createHarness() {
    const history = new HistoryService();
    const service = new StoryService();
    const files = new Map<string, string>();
    let nextId = 0;
    // Story ids are asserted to be UUID v4, so the stub has to produce that shape.
    const uuid = () => {
        const n = (++nextId).toString(16).padStart(12, "0");
        return `00000000-0000-4000-8000-${n}`;
    };

    const fs = {
        write: vi.fn(async (path: string, data: string) => {
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
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
        createDir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        mkdir: vi.fn(async () => ({ ok: true as const, data: undefined })),
    };

    const context = {
        // Mirrors Porject.resolve: flatten the convention arrays, then join. The story *directory*
        // and the story *document* are built from different convention entries, so a stub that does
        // not join them the same way makes deleteDir miss the file it is supposed to remove.
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
    return { service, history, files, fs };
}

/**
 * A library plus one story, without going through `init` (which reads the project).
 *
 * `createStory` seeds "Chapter 1" containing "Scene 1" and points `entrySceneId` at it, so the
 * seeded chapter is removed here - every test below wants to state its own structure, and asserting
 * around an implicit chapter is how a test ends up passing for the wrong reason.
 */
async function seedStory(service: StoryService, history: HistoryService, name = "Tale") {
    if (!(service as never as { index: unknown }).index) {
        (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
        (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    }
    const entry = service.createStory(name);
    const seededChapter = service.getStoryDocument(entry.id).chapters[0];
    if (seededChapter) {
        service.deleteChapter(entry.id, seededChapter.id);
    }
    // createStory writes the document on a floating promise; let it land before anything asserts.
    await service.saveStory(entry.id);
    history.clearScope(projectHistoryScope());
    return entry;
}

describe("StoryService structural deletions", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("undoes deleting a scene, with its place in its chapter", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const a = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        const b = service.createScene(story.id, { chapterId: chapter.id, name: "B" });
        const c = service.createScene(story.id, { chapterId: chapter.id, name: "C" });
        history.clearScope(projectHistoryScope());

        expect(service.deleteScene(story.id, b.id)).toBe(true);
        const ids = () => service.getStoryDocument(story.id).chapters.find(ch => ch.id === chapter.id)!.sceneIds;
        expect(ids()).toEqual([a.id, c.id]);

        expect(history.undo(projectHistoryScope())).toBe(true);
        // Not appended: the scene goes back between A and C, where the author left it.
        expect(ids()).toEqual([a.id, b.id, c.id]);
        expect(service.getStoryDocument(story.id).scenes[b.id]?.name).toBe("B");
    });

    it("restores the entry scene pointer the deletion re-pointed", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const first = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        const second = service.createScene(story.id, { chapterId: chapter.id, name: "B" });
        service.setEntryScene(story.id, second.id);
        history.clearScope(projectHistoryScope());

        service.deleteScene(story.id, second.id);
        expect(service.getStoryDocument(story.id).entrySceneId).toBe(first.id);

        history.undo(projectHistoryScope());
        expect(service.getStoryDocument(story.id).entrySceneId).toBe(second.id);
    });

    it("undoes a chapter deletion together with every scene it took with it", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const keep = service.createChapter(story.id, "Keep");
        service.createScene(story.id, { chapterId: keep.id, name: "Kept" });
        const doomed = service.createChapter(story.id, "Doomed");
        service.createScene(story.id, { chapterId: doomed.id, name: "X" });
        service.createScene(story.id, { chapterId: doomed.id, name: "Y" });
        history.clearScope(projectHistoryScope());

        expect(service.deleteChapter(story.id, doomed.id)).toBe(true);
        expect(Object.keys(service.getStoryDocument(story.id).scenes)).toHaveLength(1);

        expect(history.undo(projectHistoryScope())).toBe(true);
        const document = service.getStoryDocument(story.id);
        expect(document.chapters.map(c => c.name)).toEqual(["Keep", "Doomed"]);
        expect(Object.values(document.scenes).map(s => s.name).sort()).toEqual(["Kept", "X", "Y"]);
    });

    it("redoes a scene deletion", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const scene = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        history.clearScope(projectHistoryScope());

        service.deleteScene(story.id, scene.id);
        history.undo(projectHistoryScope());
        expect(service.getStoryDocument(story.id).scenes[scene.id]).toBeDefined();

        expect(history.redo(projectHistoryScope())).toBe(true);
        expect(service.getStoryDocument(story.id).scenes[scene.id]).toBeUndefined();
    });

    it("puts a deleted story back in the library at its old position, with its document on disk", async () => {
        const { service, history, files } = harness;
        const first = await seedStory(service, history);
        const second = await seedStory(service, history, "Second");
        const third = await seedStory(service, history, "Third");
        history.clearScope(projectHistoryScope());
        const documentPaths = [...files.keys()].filter(k => k.includes(second.id));
        expect(documentPaths.length).toBeGreaterThan(0);

        expect(await service.deleteStory(second.id)).toBe(true);
        expect(service.listStories().map(s => s.name)).toEqual(["Tale", "Third"]);
        expect([...files.keys()].filter(k => k.includes(second.id))).toHaveLength(0);

        expect(history.undo(projectHistoryScope())).toBe(true);
        await history.settled();
        expect(service.listStories().map(s => s.name)).toEqual(["Tale", "Second", "Third"]);
        // The library entry alone would list a story that cannot be opened.
        expect([...files.keys()].filter(k => k.includes(second.id)).length).toBeGreaterThan(0);
        expect(first.id).not.toBe(third.id);
    });

    it("restores the default-story pointer when the deleted story held it", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        service.setDefaultStory(story.id);
        history.clearScope(projectHistoryScope());

        await service.deleteStory(story.id);
        expect(service.getDefaultStoryId()).toBeUndefined();

        history.undo(projectHistoryScope());
        await history.settled();
        expect(service.getDefaultStoryId()).toBe(story.id);
    });

    it("records nothing for a story that was not there", async () => {
        const { service, history } = harness;
        await seedStory(service, history);
        expect(await service.deleteStory("00000000-0000-4000-8000-ffffffffffff")).toBe(false);
        expect(history.canUndo(projectHistoryScope())).toBe(false);
    });
});
