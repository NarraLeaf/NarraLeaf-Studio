import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveStoryOp } from "@shared/live/ops";
import type { StoryDocument, StoryId, StoryNoteBlock, StorySceneId } from "@shared/types/story";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope } from "../history/historyScopes";
import { Services } from "../services";
import { StoryService, type StoryOpSink } from "./StoryService";

vi.mock("@/lib/app/writeFreeze", () => ({ getProjectWriteFreeze: () => null }));

/**
 * The seam a live session hangs off, exercised from the service's side alone.
 *
 * Nothing here builds a session, a transport or a host: the sink is an interface, and the whole
 * value of it being one is that "an editing gesture goes somewhere else" can be stated and checked
 * without any of that. The two halves are the two directions - a gesture handed over and applying
 * nothing, and an operation applied without being handed anywhere.
 */
function createHarness() {
    const history = new HistoryService();
    const service = new StoryService();
    const files = new Map<string, string>();
    let nextId = 0;
    const uuid = () => `00000000-0000-4000-8000-${(++nextId).toString(16).padStart(12, "0")}`;

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
    (service as never as { index: unknown }).index = { schemaVersion: 1, stories: [], meta: {} };
    (service as never as { animationIndex: unknown }).animationIndex = { schemaVersion: 1, animations: [], meta: {} };

    return { service, history, fs };
}

function note(id: string, value: string = id): StoryNoteBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `text-${id}`, value, role: "note" } },
    };
}

/** A story with two chapters, two scenes, and three rows in the first scene. */
async function seed(service: StoryService) {
    const entry = service.createStory("Tale");
    const document = service.getStoryDocument(entry.id);
    const chapter = document.chapters[0];
    const sceneId = chapter.sceneIds[0];
    const second = service.createChapter(entry.id, "Two");
    const otherScene = service.createScene(entry.id, { chapterId: second.id, name: "Elsewhere" });
    for (const id of ["a", "b", "c"]) {
        service.insertBlock(entry.id, sceneId, note(id), { parentId: null });
    }
    await service.saveStory(entry.id);
    return {
        storyId: entry.id,
        sceneId,
        otherSceneId: otherScene.id,
        chapterIds: [chapter.id, second.id],
    };
}

/** A sink that takes everything it is handed and remembers it. */
function takingSink(): StoryOpSink & { ops: { storyId: StoryId; op: LiveStoryOp }[] } {
    const ops: { storyId: StoryId; op: LiveStoryOp }[] = [];
    return {
        ops,
        handle(storyId, op) {
            ops.push({ storyId, op });
            return true;
        },
    };
}

/** Every one of the eleven mutators, called once, in an order that leaves a readable document. */
function editEverything(service: StoryService, ids: Awaited<ReturnType<typeof seed>>): void {
    const { storyId, sceneId, otherSceneId, chapterIds } = ids;
    service.insertBlock(storyId, sceneId, note("d"), { parentId: null, beforeBlockId: "a" });
    service.updateBlock(storyId, sceneId, "a", note("a", "one").payload);
    service.updateBlocks(storyId, [
        { sceneId, blockId: "b", payload: note("b", "two").payload },
        { sceneId, blockId: "c", payload: note("c", "three").payload },
    ]);
    service.moveBlock(storyId, sceneId, "a", { parentId: null, beforeBlockId: null });
    service.moveBlocks(storyId, sceneId, [{ blockIds: ["b", "c"], target: { parentId: null, beforeBlockId: null } }]);
    service.setBlockDisabled(storyId, sceneId, "a", true);
    service.deleteBlock(storyId, sceneId, "d");
    service.renameScene(storyId, sceneId, "Corridor");
    service.setEntryScene(storyId, otherSceneId);
    service.renameStory(storyId, "Nomen");
    service.moveChapter(storyId, chapterIds[1], chapterIds[0]);
}

describe("a story service with no sink", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("changes the document in every one of the eleven mutators, as it always did", async () => {
        // The control for everything below: the same eleven calls, and every one of them lands.
        const { service } = harness;
        const ids = await seed(service);

        editEverything(service, ids);

        const document = service.getStoryDocument(ids.storyId);
        const scene = document.scenes[ids.sceneId];
        expect(scene.rootBlockIds).toEqual(["a", "b", "c"]);
        expect(scene.blocks.d).toBeUndefined();
        expect(scene.blocks.a.disabled).toBe(true);
        expect(scene.blocks.b.payload).toEqual(note("b", "two").payload);
        expect(scene.blocks.c.payload).toEqual(note("c", "three").payload);
        expect(scene.name).toBe("Corridor");
        expect(document.entrySceneId).toBe(ids.otherSceneId);
        expect(document.name).toBe("Nomen");
        expect(service.getStoryEntry(ids.storyId)?.name).toBe("Nomen");
        expect(document.chapters.map(chapter => chapter.id)).toEqual([ids.chapterIds[1], ids.chapterIds[0]]);
    });
});

describe("a story service whose sink takes the edit", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("hands each of the eleven over as one operation and touches nothing", async () => {
        const { service } = harness;
        const ids = await seed(service);
        const sink = takingSink();
        service.setOperationSink(sink);
        const before = JSON.stringify(service.getStoryDocument(ids.storyId));
        const revision = service.getRevision();

        editEverything(service, ids);

        expect(sink.ops.map(entry => entry.storyId)).toEqual(Array(11).fill(ids.storyId));
        expect(sink.ops.map(entry => entry.op)).toEqual([
            { op: "insert-block", sceneId: ids.sceneId, block: note("d"), target: { parentId: null, beforeBlockId: "a" } },
            { op: "update-block", sceneId: ids.sceneId, blockId: "a", payload: note("a", "one").payload },
            {
                op: "update-blocks",
                edits: [
                    { sceneId: ids.sceneId, blockId: "b", payload: note("b", "two").payload },
                    { sceneId: ids.sceneId, blockId: "c", payload: note("c", "three").payload },
                ],
            },
            { op: "move-block", sceneId: ids.sceneId, blockId: "a", target: { parentId: null, beforeBlockId: null } },
            {
                op: "move-blocks",
                sceneId: ids.sceneId,
                moves: [{ blockIds: ["b", "c"], target: { parentId: null, beforeBlockId: null } }],
            },
            { op: "set-block-disabled", sceneId: ids.sceneId, blockId: "a", disabled: true },
            { op: "delete-block", sceneId: ids.sceneId, blockId: "d" },
            { op: "rename-scene", sceneId: ids.sceneId, name: "Corridor" },
            { op: "set-entry-scene", sceneId: ids.otherSceneId },
            { op: "rename-story", name: "Nomen" },
            // A hop stated as the order it produces, because that is what the vocabulary says and
            // what every other machine has to be able to apply without knowing what moved.
            { op: "reorder-chapters", chapterIds: [ids.chapterIds[1], ids.chapterIds[0]] },
        ]);
        // Not one of them reached the document, and the library entry a rename also touches is
        // equally untouched: the row moves when the operation comes back, and not before.
        expect(JSON.stringify(service.getStoryDocument(ids.storyId))).toBe(before);
        expect(service.getRevision()).toBe(revision);
        expect(service.getStoryEntry(ids.storyId)?.name).toBe("Tale");
    });

    it("still returns the block an insert was given, though the row is not in the document", async () => {
        // The caller places the caret with it. The caret has somewhere to be as soon as the row
        // appears, which is when the operation comes back rather than now.
        const { service } = harness;
        const ids = await seed(service);
        service.setOperationSink(takingSink());
        const block = note("n");

        expect(service.insertBlock(ids.storyId, ids.sceneId, block, { parentId: null })).toBe(block);
        expect(service.getStoryDocument(ids.storyId).scenes[ids.sceneId].blocks.n).toBeUndefined();
    });

    it("does exactly what it always did for a story the sink declines", async () => {
        const { service } = harness;
        const ids = await seed(service);
        const seen: LiveStoryOp[] = [];
        service.setOperationSink({
            handle(_storyId, op) {
                seen.push(op);
                return false;
            },
        });

        service.renameScene(ids.storyId, ids.sceneId, "Corridor");

        expect(seen).toHaveLength(1);
        expect(service.getStoryDocument(ids.storyId).scenes[ids.sceneId].name).toBe("Corridor");
    });
});

describe("applying an operation that arrived", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("changes the document, says so and owes the disk, without asking the sink", async () => {
        const { service } = harness;
        const ids = await seed(service);
        const sink = takingSink();
        service.setOperationSink(sink);
        const changed: StoryDocument[] = [];
        service.onDocumentChanged(event => changed.push(event.document));
        expect(service.isDirty()).toBe(false);

        service.applyLiveOp(ids.storyId, {
            op: "update-block",
            sceneId: ids.sceneId,
            blockId: "a",
            payload: note("a", "from somebody else").payload,
        });

        expect(service.getStoryDocument(ids.storyId).scenes[ids.sceneId].blocks.a.payload)
            .toEqual(note("a", "from somebody else").payload);
        // All three hang off `mutateDocument`: without them the editor never redraws the row and the
        // disk never receives it.
        expect(changed).toHaveLength(1);
        expect(changed[0]).toBe(service.getStoryDocument(ids.storyId));
        expect(service.isDirty()).toBe(true);
        // The operation came FROM the sink's side of the seam. Handing it back would be a loop.
        expect(sink.ops).toHaveLength(0);
    });

    it("applies every verb the vocabulary has", async () => {
        const { service } = harness;
        const ids = await seed(service);
        const { storyId, sceneId, otherSceneId, chapterIds } = ids;
        service.setOperationSink(takingSink());

        const ops: LiveStoryOp[] = [
            { op: "insert-block", sceneId, block: note("d"), target: { parentId: null, beforeBlockId: "a" } },
            { op: "update-block", sceneId, blockId: "a", payload: note("a", "one").payload },
            {
                op: "update-blocks",
                edits: [
                    { sceneId, blockId: "b", payload: note("b", "two").payload },
                    { sceneId, blockId: "c", payload: note("c", "three").payload },
                ],
            },
            { op: "move-block", sceneId, blockId: "a", target: { parentId: null, beforeBlockId: null } },
            { op: "move-blocks", sceneId, moves: [{ blockIds: ["b", "c"], target: { parentId: null, beforeBlockId: null } }] },
            { op: "set-block-disabled", sceneId, blockId: "a", disabled: true },
            { op: "delete-block", sceneId, blockId: "d" },
            { op: "rename-scene", sceneId, name: "Corridor" },
            { op: "set-entry-scene", sceneId: otherSceneId },
            { op: "rename-story", name: "Nomen" },
            { op: "reorder-chapters", chapterIds: [chapterIds[1], chapterIds[0]] },
        ];
        for (const op of ops) {
            service.applyLiveOp(storyId, op);
        }

        const document = service.getStoryDocument(storyId);
        const scene = document.scenes[sceneId];
        expect(scene.rootBlockIds).toEqual(["a", "b", "c"]);
        expect(scene.blocks.d).toBeUndefined();
        expect(scene.blocks.a.disabled).toBe(true);
        expect(scene.blocks.b.payload).toEqual(note("b", "two").payload);
        expect(scene.name).toBe("Corridor");
        expect(document.entrySceneId).toBe(otherSceneId);
        expect(document.name).toBe("Nomen");
        expect(service.getStoryEntry(storyId)?.name).toBe("Nomen");
        expect(document.chapters.map(chapter => chapter.id)).toEqual([chapterIds[1], chapterIds[0]]);
    });

    it("keeps the row it inserted out of the message it came in", async () => {
        // The sender is still holding the operation - a host keeps every effect it broadcast - and
        // inserting writes the block into the document and edits it on the way in.
        const { service } = harness;
        const ids = await seed(service);
        const block = note("n");

        service.applyLiveOp(ids.storyId, { op: "insert-block", sceneId: ids.sceneId, block, target: { parentId: null } });

        const stored = service.getStoryDocument(ids.storyId).scenes[ids.sceneId].blocks.n;
        expect(stored).toEqual({ ...block, parentId: null });
        expect(stored).not.toBe(block);
    });

    it("records no history for an arrival, while a local edit still records one", async () => {
        // An effect is somebody's edit landing here. An undo entry for one would offer this author
        // the chance to delete a stranger's paragraph, and nothing on either screen would report it.
        const { service, history } = harness;
        const ids = await seed(service);
        const recorded: boolean[] = [];
        const restoring: boolean[] = [];
        service.onDocumentChanged(() => {
            restoring.push(history.isRestoring());
            recorded.push(history.pushCommand(projectHistoryScope(), {
                label: { key: "story.history.deleteStory" as never },
                undo: () => undefined,
                redo: () => undefined,
            }));
        });

        service.updateBlock(ids.storyId, ids.sceneId, "a", note("a", "mine").payload);
        service.applyLiveOp(ids.storyId, {
            op: "update-block",
            sceneId: ids.sceneId,
            blockId: "a",
            payload: note("a", "theirs").payload,
        });

        expect(restoring).toEqual([false, true]);
        expect(recorded).toEqual([true, false]);
    });
});
