/**
 * Undo in a team project for the documents its server owns: the steps the team's undo records for
 * this window's own effects, and what taking them sends.
 *
 * Driven against a stand-in server that holds one story document: an edit of ours is queued as an
 * intent, `deliver` applies the queue the way the server's effects come back - telling the undo
 * immediately before and after each one of ours - and `stranger` lands somebody else's edit, which
 * the undo never hears about.
 *
 * Comments in English per project convention.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveDocument, LiveOp, LiveStoryOp } from "@shared/live/ops";
import type { ProjectOp } from "@shared/authority/project";
import { applyStoryOpToDocument } from "@shared/story/applyStoryOp";
import {
    STORY_DOCUMENT_SCHEMA_VERSION,
    type StoryBlock,
    type StoryBlockId,
    type StoryDocument,
    type StoryLibraryEntry,
    type StoryNoteBlock,
    type StoryScene,
} from "@shared/types/story";
import { insertBlockInScene } from "@/lib/workspace/services/story/storyModel";
import { HistoryService } from "../history/HistoryService";
import { projectHistoryScope, storySceneHistoryScope } from "../history/historyScopes";
import { TeamUndo, teamUndoScope } from "./teamUndo";

const STORY: LiveDocument = { doc: "story", storyId: "story-1" };
const SCENE = storySceneHistoryScope("story-1", "s1");

function note(id: StoryBlockId, value = id): StoryNoteBlock {
    return { id, kind: "note", parentId: null, childrenIds: [], payload: { text: { textId: `text-${id}`, value, role: "note" } } };
}

function makeDocument(): StoryDocument {
    const s1: StoryScene = { id: "s1", name: "Scene one", runtimeName: "scene_one", rootBlockIds: [], blocks: {} };
    insertBlockInScene(s1, note("a"), { parentId: null });
    insertBlockInScene(s1, note("b"), { parentId: null });
    return {
        schemaVersion: STORY_DOCUMENT_SCHEMA_VERSION,
        id: "story-1",
        name: "Skeleton",
        entrySceneId: "s1",
        chapters: [{ id: "c1", name: "One", sceneIds: ["s1"] }],
        scenes: { s1 },
    };
}

function text(document: StoryDocument, blockId: string): string | undefined {
    const block = document.scenes.s1.blocks[blockId] as StoryBlock | undefined;
    return (block?.payload as { text?: { value?: string } } | undefined)?.text?.value;
}

function setText(blockId: string, value: string): LiveStoryOp {
    return { op: "update-block", sceneId: "s1", blockId, payload: note(blockId, value).payload };
}

function createHarness(options: { online?: boolean } = {}) {
    const history = new HistoryService();
    history.setContext({ project: {} as never, services: {} as never, commandLineRun: false });
    let document = makeDocument();
    let entry: StoryLibraryEntry | undefined = { id: "story-1", name: "Skeleton" } as StoryLibraryEntry;
    const queue: Array<{ clientId: string; document: LiveDocument; op: ProjectOp }> = [];
    const notify = vi.fn();
    let online = options.online ?? true;
    let next = 0;

    const applyOp = (op: ProjectOp) => {
        if (op.op === "delete-story") {
            entry = undefined;
            return;
        }
        if (op.op === "create-story") {
            entry = op.entry;
            document = structuredClone(op.document);
            return;
        }
        applyStoryOpToDocument(document, structuredClone(op) as LiveStoryOp, { now: "2026-11-26T00:00:00.000Z" });
    };

    const undo = new TeamUndo({
        self: "me",
        history,
        read: {
            sources: () => ({ story: document }),
            context: () => ({ document }),
            storyEntry: () => entry,
            story: () => (entry ? document : null),
        },
        send: (target, op) => {
            if (!online) {
                return null;
            }
            const clientId = `step-${next++}`;
            queue.push({ clientId, document: target, op });
            return clientId;
        },
        applyLocally: (_target, op) => applyOp(op),
        notify,
        translate: key => key,
        answerTimeoutMs: 1000,
    });

    /** An edit of this window's, as the sync hands it over: an intent now, the effect on `deliver`. */
    const edit = (op: ProjectOp) => {
        const clientId = `edit-${next++}`;
        undo.intended(clientId, STORY);
        queue.push({ clientId, document: STORY, op });
    };
    /** The server's effects arriving, in order. */
    const deliver = async () => {
        // A gesture's turn is over before anything it sent comes back.
        await Promise.resolve();
        while (queue.length > 0) {
            const item = queue.shift()!;
            const before = undo.tracks(item.clientId) ? undo.before(item.document, item.op) : null;
            applyOp(item.op);
            if (before !== null) {
                undo.landed(item.clientId, { document: item.document, op: item.op }, before);
            }
        }
        await Promise.resolve();
    };
    /** Somebody else's edit landing. */
    const stranger = (op: LiveOp) => applyOp(op);
    const step = async (direction: "undo" | "redo", scope = SCENE) => {
        const taken = direction === "undo" ? history.undo(scope) : history.redo(scope);
        // A step sends its operations one at a time, each once the last has come back.
        for (let round = 0; round < 5; round += 1) {
            await deliver();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        await history.settled();
        return taken;
    };

    return {
        history,
        undo,
        notify,
        queue,
        edit,
        deliver,
        stranger,
        step,
        doc: () => document,
        entry: () => entry,
        goOffline: () => {
            online = false;
        },
    };
}

describe("the team's undo", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => undefined);
    });
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("puts a step for a row edit on the scene's stack, and sends its inverse and back", async () => {
        const h = createHarness();
        h.edit(setText("a", "Hello"));
        await h.deliver();
        expect(text(h.doc(), "a")).toBe("Hello");
        expect(h.history.canUndo(SCENE)).toBe(true);

        expect(await h.step("undo")).toBe(true);
        expect(text(h.doc(), "a")).toBe("a");
        expect(h.history.canRedo(SCENE)).toBe(true);

        expect(await h.step("redo")).toBe(true);
        expect(text(h.doc(), "a")).toBe("Hello");
        expect(h.notify).not.toHaveBeenCalled();
    });

    it("refuses, and keeps the step, when somebody changed the row since", async () => {
        const h = createHarness();
        h.edit(setText("a", "Hello"));
        await h.deliver();
        h.stranger(setText("a", "Theirs"));

        expect(await h.step("undo")).toBe(false);
        expect(text(h.doc(), "a")).toBe("Theirs");
        expect(h.notify).toHaveBeenCalledWith("workspace.history.team.undoRefused", "workspace.history.team.changed");
        expect(h.history.canUndo(SCENE)).toBe(true);
    });

    it("leaves another author's row alone when it takes its own back", async () => {
        const h = createHarness();
        h.edit(setText("a", "Mine"));
        await h.deliver();
        h.stranger(setText("b", "Theirs"));

        expect(await h.step("undo")).toBe(true);
        expect(text(h.doc(), "a")).toBe("a");
        expect(text(h.doc(), "b")).toBe("Theirs");
    });

    it("takes back what one gesture sent as one step, last first", async () => {
        const h = createHarness();
        h.edit(setText("a", "First half"));
        h.edit({ op: "insert-block", sceneId: "s1", block: note("c", "Second half"), target: { parentId: null, beforeBlockId: "b" } });
        await h.deliver();
        expect(h.doc().scenes.s1.rootBlockIds).toEqual(["a", "c", "b"]);

        expect(await h.step("undo")).toBe(true);
        expect(h.doc().scenes.s1.rootBlockIds).toEqual(["a", "b"]);
        expect(text(h.doc(), "a")).toBe("a");
        expect(h.history.canUndo(SCENE)).toBe(false);

        expect(await h.step("redo")).toBe(true);
        expect(h.doc().scenes.s1.rootBlockIds).toEqual(["a", "c", "b"]);
        expect(text(h.doc(), "a")).toBe("First half");
    });

    it("folds edits of one row typed in quick succession into one step", async () => {
        const h = createHarness();
        for (const value of ["H", "He", "Hey"]) {
            h.edit(setText("a", value));
            await h.deliver();
        }

        expect(await h.step("undo")).toBe(true);
        expect(text(h.doc(), "a")).toBe("a");
        expect(h.history.canUndo(SCENE)).toBe(false);
    });

    it("records nothing for a gesture that recorded a step of its own", async () => {
        const h = createHarness();
        h.edit(setText("a", "Replaced"));
        h.history.pushCommand(projectHistoryScope(), { label: { key: "x" } as never, undo: () => undefined, redo: () => undefined });
        await h.deliver();

        expect(h.history.canUndo(SCENE)).toBe(false);
    });

    it("undoes a deleted row by putting it back where it was", async () => {
        const h = createHarness();
        h.edit({ op: "delete-block", sceneId: "s1", blockId: "a" });
        await h.deliver();
        expect(h.doc().scenes.s1.rootBlockIds).toEqual(["b"]);

        expect(await h.step("undo")).toBe(true);
        expect(h.doc().scenes.s1.rootBlockIds).toEqual(["a", "b"]);
        expect(text(h.doc(), "a")).toBe("a");
    });

    it("refuses to take back an edit to a row somebody has since deleted", async () => {
        const h = createHarness();
        h.edit(setText("a", "Hello"));
        await h.deliver();
        h.stranger({ op: "delete-block", sceneId: "s1", blockId: "a" });

        expect(await h.step("undo")).toBe(false);
        expect(h.notify).toHaveBeenCalledTimes(1);
        expect(h.history.canUndo(SCENE)).toBe(true);
    });

    it("keeps the step where it was when the server refuses its inverse", async () => {
        const h = createHarness();
        h.edit(setText("a", "Hello"));
        await h.deliver();

        expect(h.history.undo(SCENE)).toBe(true);
        const sent = h.queue.shift()!;
        h.undo.abandoned(sent.clientId);
        await h.history.settled();

        expect(text(h.doc(), "a")).toBe("Hello");
        expect(h.history.canUndo(SCENE)).toBe(true);
        expect(h.history.canRedo(SCENE)).toBe(false);
    });

    it("applies a step here when nothing can be sent", async () => {
        const h = createHarness();
        h.edit(setText("a", "Hello"));
        await h.deliver();
        h.goOffline();

        expect(await h.step("undo")).toBe(true);
        expect(text(h.doc(), "a")).toBe("a");
    });

    it("puts a deleted story back with its document", async () => {
        const h = createHarness();
        h.edit({ op: "delete-story" });
        await h.deliver();
        expect(h.entry()).toBeUndefined();

        expect(await h.step("undo", projectHistoryScope())).toBe(true);
        expect(h.entry()?.id).toBe("story-1");
        expect(text(h.doc(), "a")).toBe("a");
    });

    it("lets go of the editors' own scene snapshots while the server owns the documents", () => {
        const h = createHarness();
        let state = "one";
        h.history.registerScope({ id: SCENE, label: { key: "x" } as never, capture: () => state, apply: next => { state = next as string; } });
        h.history.checkpoint(SCENE, { label: { key: "x" } as never });
        expect(h.history.canUndo(SCENE)).toBe(true);

        h.undo.setActive(true);
        expect(h.history.canUndo(SCENE)).toBe(false);
        expect(h.history.checkpoint(SCENE, { label: { key: "x" } as never })).toBe(false);

        h.undo.setActive(false);
        expect(h.history.checkpoint(SCENE, { label: { key: "x" } as never })).toBe(true);
    });

    it("records edits made while recording is only held to batch them", async () => {
        const h = createHarness();
        h.history.withoutRecording(() => h.edit(setText("a", "Batched")));
        await h.deliver();

        expect(h.history.canUndo(SCENE)).toBe(true);
    });

    it("records an edit the author makes while a step is waiting for the server", async () => {
        const h = createHarness();
        h.edit(setText("a", "First"));
        await h.deliver();

        expect(h.history.undo(SCENE)).toBe(true);
        // The inverse is out; before it comes back, the author edits another row.
        h.edit(setText("b", "Meanwhile"));
        for (let round = 0; round < 3; round += 1) {
            await h.deliver();
            await new Promise(resolve => setTimeout(resolve, 0));
        }
        await h.history.settled();
        expect(text(h.doc(), "a")).toBe("a");
        expect(text(h.doc(), "b")).toBe("Meanwhile");

        // That edit is a step of its own, on top: the next Ctrl+Z takes it back.
        expect(await h.step("undo")).toBe(true);
        expect(text(h.doc(), "b")).toBe("b");
    });

    it("files steps by what they are about", () => {
        expect(teamUndoScope(STORY, setText("a", "x"))).toBe(SCENE);
        expect(teamUndoScope(STORY, { op: "rename-story", name: "x" })).toBe(projectHistoryScope());
        expect(teamUndoScope({ doc: "characters" }, { op: "delete-character", characterId: "c" })).toBe(projectHistoryScope());
    });
});
