import { beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveStoryOp } from "@shared/live/ops";
import type { StoryDocument, StoryId, StoryNoteBlock, StoryScene, StorySceneId } from "@shared/types/story";
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

/**
 * The outline's own gestures, which used to reach the document with no operation behind them.
 *
 * They are in a block of their own rather than folded into `editEverything` above because they are
 * the half of the vocabulary that arrived later, and what they have to prove is exactly what the
 * rows already proved: with a sink installed the document does not move, and the operation says
 * enough for every other machine to arrive at the same document.
 */
describe("a story service whose sink takes a structural gesture", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("hands every scene and chapter gesture over and touches nothing", async () => {
        const { service } = harness;
        const ids = await seed(service);
        const snapshotId = service.createSceneSnapshot(ids.storyId, ids.sceneId, "Snap");
        const sink = takingSink();
        service.setOperationSink(sink);
        const before = JSON.stringify(service.getStoryDocument(ids.storyId));

        const scene = service.createScene(ids.storyId, { chapterId: ids.chapterIds[0], name: "New" });
        service.updateScene(ids.storyId, ids.sceneId, { description: "quiet" });
        service.moveScene(ids.storyId, ids.sceneId, { chapterId: ids.chapterIds[1] });
        service.renameSceneSnapshot(ids.storyId, ids.sceneId, snapshotId ?? "", "Snap 2");
        service.deleteSceneSnapshot(ids.storyId, ids.sceneId, snapshotId ?? "");
        const chapter = service.createChapter(ids.storyId, "Three");
        service.renameChapter(ids.storyId, ids.chapterIds[1], "Two-ish");
        service.deleteChapter(ids.storyId, ids.chapterIds[1]);
        service.deleteScene(ids.storyId, ids.sceneId);

        expect(sink.ops.map(entry => entry.op.op)).toEqual([
            "create-scene",
            "update-scene",
            "move-scene",
            "set-scene-snapshots",
            "set-scene-snapshots",
            "create-chapter",
            "rename-chapter",
            "delete-chapter",
            "delete-scene",
        ]);
        // The creation states the whole record and the chapter it lands in, because both ids were
        // minted here: a machine deriving its own would file a different scene somewhere else.
        expect(sink.ops[0].op).toMatchObject({
            op: "create-scene",
            scene: { id: scene.id, name: "New" },
            chapterId: ids.chapterIds[0],
            beforeSceneId: null,
        });
        expect(sink.ops[5].op).toMatchObject({ op: "create-chapter", chapter: { id: chapter.id, name: "Three" } });
        // Nothing moved. The document is the one `seed` left behind, byte for byte.
        expect(JSON.stringify(service.getStoryDocument(ids.storyId))).toBe(before);
    });

    it("hands a declaration row over as the row operation it is", async () => {
        // A scene variable IS a row, so it needs no verb of its own - it needs the row verbs it
        // always had, and to stop going round them.
        const { service } = harness;
        const ids = await seed(service);
        const sink = takingSink();
        service.setOperationSink(sink);
        const before = JSON.stringify(service.getStoryDocument(ids.storyId));

        const created = service.createSceneVariable(ids.storyId, ids.sceneId, { name: "flag", valueType: "boolean" });

        expect(created).not.toBeNull();
        expect(sink.ops.map(entry => entry.op.op)).toEqual(["insert-block"]);
        expect(sink.ops[0].op).toMatchObject({
            op: "insert-block",
            sceneId: ids.sceneId,
            block: { kind: "declaration", payload: { scope: "scene", name: "flag" } },
        });
        expect(JSON.stringify(service.getStoryDocument(ids.storyId))).toBe(before);
    });

    it("writes nothing when a whole scene is replaced, and says so", async () => {
        // The one story gesture with no verb. A script import and a NarraLang commit both end here,
        // and what they state - "here is the scene now" - is the whole-document last-writer-wins the
        // vocabulary refuses. False is the answer, and the document is untouched.
        const { service } = harness;
        const ids = await seed(service);
        const sink = takingSink();
        service.setOperationSink(sink);
        const before = JSON.stringify(service.getStoryDocument(ids.storyId));
        const scene = service.getStoryDocument(ids.storyId).scenes[ids.sceneId];

        const wrote = service.replaceScene(ids.storyId, ids.sceneId, { ...scene, name: "Rewritten" });

        expect(wrote).toBe(false);
        expect(sink.ops).toEqual([]);
        expect(JSON.stringify(service.getStoryDocument(ids.storyId))).toBe(before);
    });
});

describe("a story service applying a structural operation", () => {
    let harness: ReturnType<typeof createHarness>;

    beforeEach(() => {
        harness = createHarness();
    });

    it("puts a deleted scene back whole, rows and all", async () => {
        // The one thing this has to prove. A record that kept the scene's name would restore an
        // empty shell and look as though it had worked; what the author deleted was three rows.
        const { service } = harness;
        const ids = await seed(service);
        const before = service.getStoryDocument(ids.storyId).scenes[ids.sceneId];
        const copy = JSON.parse(JSON.stringify(before)) as typeof before;

        service.applyLiveOp(ids.storyId, { op: "delete-scene", sceneId: ids.sceneId });
        expect(service.getStoryDocument(ids.storyId).scenes[ids.sceneId]).toBeUndefined();
        expect(service.getStoryDocument(ids.storyId).chapters[0].sceneIds).not.toContain(ids.sceneId);

        service.applyLiveOp(ids.storyId, {
            op: "create-scene",
            scene: copy,
            chapterId: ids.chapterIds[0],
            beforeSceneId: null,
            entry: true,
        });

        const restored = service.getStoryDocument(ids.storyId).scenes[ids.sceneId];
        expect(restored.rootBlockIds).toEqual(["a", "b", "c"]);
        expect(restored.blocks.b.payload).toEqual(note("b").payload);
        expect(service.getStoryDocument(ids.storyId).chapters[0].sceneIds).toContain(ids.sceneId);
        expect(service.getStoryDocument(ids.storyId).entrySceneId).toBe(ids.sceneId);
    });

    it("puts a deleted chapter back with every scene that left with it", async () => {
        const { service } = harness;
        const ids = await seed(service);
        const document = service.getStoryDocument(ids.storyId);
        const chapter = JSON.parse(JSON.stringify(document.chapters[1])) as (typeof document.chapters)[number];
        const scenes = chapter.sceneIds.map(id => JSON.parse(JSON.stringify(document.scenes[id])) as StoryScene);

        service.applyLiveOp(ids.storyId, { op: "delete-chapter", chapterId: ids.chapterIds[1] });
        expect(service.getStoryDocument(ids.storyId).scenes[ids.otherSceneId]).toBeUndefined();

        service.applyLiveOp(ids.storyId, {
            op: "create-chapter",
            chapter,
            beforeChapterId: null,
            scenes,
        });

        const after = service.getStoryDocument(ids.storyId);
        expect(after.chapters.map(item => item.id)).toContain(ids.chapterIds[1]);
        expect(after.scenes[ids.otherSceneId]).toBeDefined();
    });

    it("clears a scene field an update leaves out", async () => {
        // An absent field is what "the scene has none" looks like on disk, so the applier removes
        // the key rather than leaving the old value standing.
        const { service } = harness;
        const ids = await seed(service);
        service.updateScene(ids.storyId, ids.sceneId, { description: "quiet" });
        expect(service.getStoryDocument(ids.storyId).scenes[ids.sceneId].description).toBe("quiet");

        service.applyLiveOp(ids.storyId, {
            op: "update-scene",
            sceneId: ids.sceneId,
            fields: { name: "Corridor", runtimeName: "corridor" },
        });

        const scene = service.getStoryDocument(ids.storyId).scenes[ids.sceneId];
        expect(scene.name).toBe("Corridor");
        expect("description" in scene).toBe(false);
    });
});
