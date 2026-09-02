import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StoryBlock, StoryBlockId, StoryId, StorySceneId } from "@shared/types/story";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope, storySceneHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * A story service over an in-memory filesystem.
 *
 * Structural operations touch two scenes and the outline at once, so what these tests assert is the
 * whole document before and after - byte-identical after an undo is the only claim worth making
 * about an edit that spans several places at the same time.
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

    const fs = {
        writeFileNoFollowOrCreate: vi.fn(async (path: string, data: string) => {
            files.set(path, data);
            return { ok: true as const, data: undefined };
        }),
        read: vi.fn(async (path: string) => {
            const data = files.get(path);
            return data === undefined
                ? { ok: false as const, error: { message: "missing", code: "ENOENT" } }
                : { ok: true as const, data };
        }),
        deleteFile: vi.fn(async () => ({ ok: true as const, data: undefined })),
        deleteDir: vi.fn(async () => ({ ok: true as const, data: undefined })),
        isFileExists: vi.fn(async (path: string) => ({ ok: true as const, data: files.has(path) })),
        isDirExists: vi.fn(async () => ({ ok: true as const, data: true })),
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
    return { service, history };
}

async function seedStory(service: StoryService, history: HistoryService) {
    if (!(service as never as { index: unknown }).index) {
        (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
        (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };
    }
    const entry = service.createStory("Tale");
    const seeded = service.getStoryDocument(entry.id).chapters[0];
    if (seeded) {
        service.deleteChapter(entry.id, seeded.id);
    }
    await service.saveStory(entry.id);
    history.clearScope(projectHistoryScope());
    return entry;
}

function narration(id: string, text: string): StoryBlock {
    return {
        id,
        parentId: null,
        childrenIds: [],
        kind: "nodeAction",
        payload: { action: "narration", text: { textId: `${id}-text`, role: "narration", value: text } },
    };
}

function addRows(service: StoryService, storyId: StoryId, sceneId: StorySceneId, ids: string[]): void {
    for (const id of ids) {
        service.insertBlock(storyId, sceneId, narration(id, id), { parentId: null, beforeBlockId: null });
    }
}

/**
 * The document as bytes, which is what "undo put it back" has to be measured against.
 *
 * Without its own `meta`: every write stamps `updatedAt`, so an undo is a write and the stamp is
 * expected to move. Everything the author can see - scene order, chapter membership, the entry
 * pointer, every row and every text id - is inside what is compared.
 */
function snapshot(service: StoryService, storyId: StoryId): string {
    const { meta: _stamp, ...document } = service.getStoryDocument(storyId);
    return JSON.stringify(document);
}

function rootIds(service: StoryService, storyId: StoryId, sceneId: StorySceneId): StoryBlockId[] {
    return [...service.getStoryDocument(storyId).scenes[sceneId].rootBlockIds];
}

describe("StoryService structural operations", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("moves rows to another scene as one undo step on the source scene's stack", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const a = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        const b = service.createScene(story.id, { chapterId: chapter.id, name: "B" });
        addRows(service, story.id, a.id, ["r1", "r2", "r3"]);
        const scope = storySceneHistoryScope(story.id, a.id);
        history.clearScope(projectHistoryScope());
        history.clearScope(scope);
        const before = snapshot(service, story.id);

        expect(service.moveBlocksToScene(story.id, a.id, b.id, ["r2", "r3"], { parentId: null, beforeBlockId: null }, { scopeId: scope })).toBe(2);
        expect(rootIds(service, story.id, a.id)).toEqual(["r1"]);
        expect(rootIds(service, story.id, b.id)).toEqual(["r2", "r3"]);

        expect(history.undo(scope)).toBe(true);
        expect(snapshot(service, story.id)).toBe(before);
    });

    it("splits a scene, keeps the rows playing, and undoes the whole thing at once", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const a = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        addRows(service, story.id, a.id, ["r1", "r2", "r3"]);
        const scope = storySceneHistoryScope(story.id, a.id);
        history.clearScope(projectHistoryScope());
        const before = snapshot(service, story.id);

        const result = service.splitScene(story.id, a.id, "r2", "A 2", { scopeId: scope })!;
        expect(result.movedRowCount).toBe(2);
        // The scene would otherwise have stopped the game where the cut is, so the jump is written.
        expect(result.jumpAdded).toBe(true);

        const document = service.getStoryDocument(story.id);
        expect(document.scenes[result.sceneId].rootBlockIds).toEqual(["r2", "r3"]);
        const tail = document.scenes[a.id].blocks[rootIds(service, story.id, a.id)[1]];
        expect(tail.kind === "jump" && tail.payload.targetSceneId).toBe(result.sceneId);
        // Filed straight after the scene it came out of, in the same chapter.
        expect(document.chapters.find(item => item.id === chapter.id)!.sceneIds).toEqual([a.id, result.sceneId]);

        expect(history.undo(scope)).toBe(true);
        expect(snapshot(service, story.id)).toBe(before);
    });

    it("adds no jump when the first half already leaves the scene", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const a = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        const z = service.createScene(story.id, { chapterId: chapter.id, name: "Z" });
        addRows(service, story.id, a.id, ["r1"]);
        service.insertBlock(story.id, a.id, {
            id: "j1", parentId: null, childrenIds: [], kind: "jump", payload: { targetSceneId: z.id },
        }, { parentId: null, beforeBlockId: null });
        addRows(service, story.id, a.id, ["r2"]);

        const result = service.splitScene(story.id, a.id, "r2", "A 2")!;
        expect(result.jumpAdded).toBe(false);
        expect(rootIds(service, story.id, a.id)).toEqual(["r1", "j1"]);
    });

    it("merges two scenes back into one and undoes to the same bytes", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const a = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        addRows(service, story.id, a.id, ["r1", "r2", "r3"]);
        const scope = storySceneHistoryScope(story.id, a.id);
        const before = snapshot(service, story.id);

        const split = service.splitScene(story.id, a.id, "r2", "A 2", { scopeId: scope })!;
        const plan = service.mergeScenes(story.id, a.id, split.sceneId, [], { scopeId: scope })!;

        expect(plan.blockers).toHaveLength(0);
        expect(plan.droppedJumpBlockId).not.toBeNull();
        expect(rootIds(service, story.id, a.id)).toEqual(["r1", "r2", "r3"]);
        expect(service.getStoryDocument(story.id).scenes[split.sceneId]).toBeUndefined();

        // Two operations, two steps: the merge, then the split.
        expect(history.undo(scope)).toBe(true);
        expect(history.undo(scope)).toBe(true);
        expect(snapshot(service, story.id)).toBe(before);
    });

    it("writes nothing when the merge is refused", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const a = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        const b = service.createScene(story.id, { chapterId: chapter.id, name: "B" });
        addRows(service, story.id, a.id, ["r1"]);
        addRows(service, story.id, b.id, ["r2"]);
        const before = snapshot(service, story.id);

        const plan = service.mergeScenes(story.id, a.id, b.id, [{ kind: "blueprint", name: "Start" }])!;
        expect(plan.blockers).toHaveLength(1);
        expect(snapshot(service, story.id)).toBe(before);
    });

    it("refuses every structural operation while a live session owns the story", async () => {
        const { service, history } = harness;
        const story = await seedStory(service, history);
        const chapter = service.createChapter(story.id, "One");
        const a = service.createScene(story.id, { chapterId: chapter.id, name: "A" });
        const b = service.createScene(story.id, { chapterId: chapter.id, name: "B" });
        addRows(service, story.id, a.id, ["r1", "r2"]);
        const before = snapshot(service, story.id);
        service.setOperationSink({ handle: () => true });

        expect(service.moveBlocksToScene(story.id, a.id, b.id, ["r2"], { parentId: null, beforeBlockId: null })).toBe(0);
        expect(service.splitScene(story.id, a.id, "r2", "A 2")).toBeNull();
        expect(service.mergeScenes(story.id, a.id, b.id)).toBeNull();
        expect(snapshot(service, story.id)).toBe(before);
    });
});
