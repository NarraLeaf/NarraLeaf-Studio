import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryChapter, StoryDocument, StoryScene } from "./document";
import { deriveUnassignedSceneIds, listSceneBlocksInDocumentOrder, listSceneIdsInDocumentOrder } from "./order";

/**
 * The two orderings a story document states, and the one thing neither may fall back to: key order.
 * These pin the composition rules, because every consumer trusts them silently - the variable table,
 * the flow map, the localization export - and a wrong answer here reads as Studio shuffling content
 * the author arranged.
 */

function scene(id: string, blocks: StoryBlock[] = [], rootBlockIds = blocks.filter(block => !block.parentId).map(block => block.id)): StoryScene {
    return {
        id,
        name: id,
        runtimeName: id,
        rootBlockIds,
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
    };
}

function group(id: string, childrenIds: string[], extra: Partial<StoryBlock> = {}): StoryBlock {
    return { id, kind: "control", parentId: null, childrenIds, payload: { control: "sequence" }, ...extra } as StoryBlock;
}

function leaf(id: string, parentId: string | null = null, extra: Partial<StoryBlock> = {}): StoryBlock {
    return { id, kind: "note", parentId, childrenIds: [], payload: { text: { textId: id, value: id, role: "note" } }, ...extra } as StoryBlock;
}

function documentWith(scenes: StoryScene[], chapters: StoryChapter[], unassignedSceneIds?: string[]): StoryDocument {
    return {
        chapters,
        scenes: Object.fromEntries(scenes.map(entry => [entry.id, entry])),
        ...(unassignedSceneIds ? { unassignedSceneIds } : {}),
    } as unknown as StoryDocument;
}

describe("listSceneBlocksInDocumentOrder", () => {
    it("returns the tree depth first, not the order the record holds", () => {
        const blocks = [group("grp", ["deep"]), leaf("after"), leaf("deep", "grp")];
        // The record ends with `deep` (inserted last) while the tree puts it inside `grp`.
        expect(listSceneBlocksInDocumentOrder(scene("s", blocks, ["grp", "after"])).map(block => block.id))
            .toEqual(["grp", "deep", "after"]);
    });

    it("skips a pruned block together with everything under it", () => {
        const blocks = [group("off", ["under"], { disabled: true }), leaf("under", "off"), leaf("on")];
        const found = listSceneBlocksInDocumentOrder(
            scene("s", blocks, ["off", "on"]),
            { skipSubtree: block => Boolean(block.disabled) },
        );
        expect(found.map(block => block.id)).toEqual(["on"]);
    });

    it("omits a block the tree does not reach, and never returns one twice", () => {
        // `unreachable` is in the record but no list names it; `grp` is named by both the root list
        // and its own children, which corruption can produce.
        const blocks = [group("grp", ["grp", "in"]), leaf("in", "grp"), leaf("unreachable", "grp")];
        expect(listSceneBlocksInDocumentOrder(scene("s", blocks, ["grp"])).map(block => block.id))
            .toEqual(["grp", "in"]);
    });

    it("answers an absent scene with an empty list rather than throwing", () => {
        expect(listSceneBlocksInDocumentOrder(undefined)).toEqual([]);
    });
});

describe("listSceneIdsInDocumentOrder", () => {
    const chapter = (id: string, sceneIds: string[]): StoryChapter => ({ id, name: id, sceneIds });

    it("reads chapters in order, then the scenes no chapter claims", () => {
        const document = documentWith(
            [scene("loose"), scene("second"), scene("first")],
            [chapter("ch-1", ["first"]), chapter("ch-2", ["second"])],
            ["loose"],
        );
        expect(listSceneIdsInDocumentOrder(document)).toEqual(["first", "second", "loose"]);
    });

    it("places a scene at its chapter position even while `unassignedSceneIds` still lists it", () => {
        // What a session looks like between dragging a loose scene into a chapter and the next load:
        // nothing prunes the stale entry, so the composition has to be the thing that ignores it.
        const document = documentWith(
            [scene("adopted"), scene("other")],
            [chapter("ch-1", ["adopted", "other"])],
            ["adopted"],
        );
        expect(listSceneIdsInDocumentOrder(document)).toEqual(["adopted", "other"]);
    });

    it("still reaches a scene neither structure mentions", () => {
        // A scene created since the last normalize is not in `unassignedSceneIds` yet. Invisible is
        // the one answer that is never acceptable.
        const document = documentWith([scene("known"), scene("fresh")], [chapter("ch-1", ["known"])]);
        expect(listSceneIdsInDocumentOrder(document)).toEqual(["known", "fresh"]);
    });

    it("drops ids that name no scene, wherever they came from", () => {
        const document = documentWith([scene("real")], [chapter("ch-1", ["real", "deleted"])], ["also-deleted"]);
        expect(listSceneIdsInDocumentOrder(document)).toEqual(["real"]);
    });
});

describe("deriveUnassignedSceneIds", () => {
    it("keeps the declared order and appends only what nothing mentioned", () => {
        const document = documentWith(
            [scene("chaptered"), scene("newcomer"), scene("b"), scene("a")],
            [{ id: "ch-1", name: "ch-1", sceneIds: ["chaptered"] }],
            ["b", "a"],
        );
        // `b` before `a` because the document says so; `newcomer` last because nothing did.
        expect(deriveUnassignedSceneIds(document)).toEqual(["b", "a", "newcomer"]);
    });

    it("returns nothing when every scene has a chapter", () => {
        const document = documentWith([scene("only")], [{ id: "ch-1", name: "ch-1", sceneIds: ["only"] }]);
        expect(deriveUnassignedSceneIds(document)).toEqual([]);
    });
});
