import { describe, expect, it } from "vitest";
import type { LiveBlockTarget } from "@shared/live/ops";
import type { StoryBlock, StoryBlockId, StoryNoteBlock, StoryScene } from "@shared/types/story";
import { deleteBlockFromScene, insertBlockInScene } from "@/lib/workspace/services/story/storyModel";
import { DeletedPositions, resolveInsertTarget } from "./deletedPositions";

function note(id: StoryBlockId): StoryNoteBlock {
    return {
        id,
        kind: "note",
        parentId: null,
        childrenIds: [],
        payload: { text: { textId: `text-${id}`, value: id, role: "note" } },
    };
}

function makeScene(rows: { block: StoryBlock; parentId?: StoryBlockId | null }[]): StoryScene {
    const scene: StoryScene = { id: "s1", name: "Scene", runtimeName: "scene", rootBlockIds: [], blocks: {} };
    for (const row of rows) {
        insertBlockInScene(scene, row.block, { parentId: row.parentId ?? null, beforeBlockId: null });
    }
    return scene;
}

/** Delete a row the way the host does: remember where it sat, then take it out. */
function deleteRow(scene: StoryScene, positions: DeletedPositions, blockId: StoryBlockId): void {
    positions.remember(scene, blockId);
    deleteBlockFromScene(scene, blockId);
}

describe("resolving an insert target", () => {
    const cases: { name: string; deletes: StoryBlockId[]; target: LiveBlockTarget; expected: LiveBlockTarget | null }[] = [
        {
            name: "leaves a target whose anchor is still there alone",
            deletes: [],
            target: { parentId: null, beforeBlockId: "b" },
            expected: { parentId: null, beforeBlockId: "b" },
        },
        {
            name: "leaves the end of a scene alone",
            deletes: [],
            target: { parentId: null },
            expected: { parentId: null, beforeBlockId: null },
        },
        {
            name: "points a deleted anchor at what followed it",
            deletes: ["b"],
            target: { parentId: null, beforeBlockId: "b" },
            expected: { parentId: null, beforeBlockId: "c" },
        },
        {
            name: "points a deleted last row at the end of its parent",
            deletes: ["c"],
            target: { parentId: null, beforeBlockId: "c" },
            expected: { parentId: null, beforeBlockId: null },
        },
        {
            name: "walks a run of deleted rows down to one still standing",
            deletes: ["b", "c"],
            target: { parentId: null, beforeBlockId: "b" },
            expected: { parentId: null, beforeBlockId: null },
        },
        {
            name: "refuses an anchor it never saw",
            deletes: [],
            target: { parentId: null, beforeBlockId: "stranger" },
            expected: null,
        },
        {
            name: "refuses a parent it never saw",
            deletes: [],
            target: { parentId: "stranger", beforeBlockId: null },
            expected: null,
        },
    ];

    for (const { name, deletes, target, expected } of cases) {
        it(name, () => {
            const scene = makeScene([{ block: note("a") }, { block: note("b") }, { block: note("c") }]);
            const positions = new DeletedPositions();
            for (const id of deletes) {
                deleteRow(scene, positions, id);
            }
            expect(resolveInsertTarget(scene, positions, target)).toEqual(expected);
        });
    }

    it("remembers every row a deleted container took with it", () => {
        const scene = makeScene([
            { block: note("a") },
            { block: { id: "g", kind: "control", parentId: null, childrenIds: [], payload: { control: "sequence" } } },
            { block: note("one"), parentId: "g" },
            { block: note("two"), parentId: "g" },
            { block: note("z") },
        ]);
        const positions = new DeletedPositions();
        deleteRow(scene, positions, "g");

        expect(positions.size).toBe(3);
        // A row deep inside the group resolves to where the group itself stood, because that is the
        // nearest place the prose the author was aiming at can still be described.
        expect(resolveInsertTarget(scene, positions, { parentId: "g", beforeBlockId: "two" }))
            .toEqual({ parentId: null, beforeBlockId: "z" });
    });

    it("prefers the row that is there to the memory of one that was", () => {
        const scene = makeScene([{ block: note("a") }, { block: note("b") }, { block: note("c") }]);
        const positions = new DeletedPositions();
        deleteRow(scene, positions, "b");
        // The same row put back, which is what an undo of a delete looks like from here.
        insertBlockInScene(scene, note("b"), { parentId: null, beforeBlockId: "c" });
        positions.forget(scene.id, "b");

        expect(resolveInsertTarget(scene, positions, { parentId: null, beforeBlockId: "b" }))
            .toEqual({ parentId: null, beforeBlockId: "b" });
    });
});
