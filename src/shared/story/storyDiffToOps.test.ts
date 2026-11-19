import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { applyStoryOpToDocument } from "./applyStoryOp";
import { storyDiffToOps } from "./storyDiffToOps";
import { createEmptyStoryDocument } from "./storyModel";

const NOW = "2026-11-14T00:00:00.000Z";

function fresh(): StoryDocument {
    let next = 100;
    return createEmptyStoryDocument({
        id: "00000000-0000-4000-8000-000000000001",
        name: "Story",
        now: NOW,
        generateId: () => `00000000-0000-4000-8000-${(++next).toString(16).padStart(12, "0")}`,
    });
}

function row(id: string, value: string, parentId: string | null = null): StoryBlock {
    return {
        id,
        kind: "nodeAction",
        parentId,
        childrenIds: [],
        payload: { action: "narration", text: { textId: `t-${id}`, role: "narration", value } },
    } as StoryBlock;
}

function container(id: string, parentId: string | null = null): StoryBlock {
    return { id, kind: "control", parentId, childrenIds: [], payload: { control: "if", condition: null } } as unknown as StoryBlock;
}

function firstScene(document: StoryDocument): StoryScene {
    return document.scenes[document.chapters[0].sceneIds[0]];
}

/** Put rows into a scene: `[id, value, parent?]`, in order. */
function withRows(document: StoryDocument, rows: Array<[string, string, string?]>): StoryDocument {
    const scene = firstScene(document);
    for (const [id, value, parent] of rows) {
        const block = value === "<box>" ? container(id, parent ?? null) : row(id, value, parent ?? null);
        scene.blocks[id] = block;
        if (parent) {
            scene.blocks[parent].childrenIds.push(id);
        } else {
            scene.rootBlockIds.push(id);
        }
    }
    return document;
}

/** Everything a document says, without the clocks the appliers stamp. */
function content(document: StoryDocument): unknown {
    return JSON.parse(JSON.stringify(document, (key, value) => (key === "meta" ? undefined : value)));
}

function replays(base: StoryDocument, mine: StoryDocument, context?: string): void {
    const originalBase = structuredClone(base);
    const originalMine = structuredClone(mine);
    const ops = storyDiffToOps(base, mine);
    const replayed = structuredClone(base);
    for (const op of ops) {
        applyStoryOpToDocument(replayed, structuredClone(op), { now: NOW });
    }
    expect(content(replayed), context).toEqual(content(mine));
    expect(base, context).toEqual(originalBase);
    expect(mine, context).toEqual(originalMine);
}

describe("storyDiffToOps", () => {
    it("says nothing about two documents that are the same", () => {
        const base = withRows(fresh(), [["a", "one"]]);
        expect(storyDiffToOps(base, structuredClone(base))).toEqual([]);
    });

    it("names an edited row by its id, so a conflict is that row", () => {
        const base = withRows(fresh(), [["a", "one"], ["b", "two"]]);
        const mine = structuredClone(base);
        (firstScene(mine).blocks.b.payload as { text: { value: string } }).text.value = "TWO";
        const ops = storyDiffToOps(base, mine);
        expect(ops).toEqual([expect.objectContaining({ op: "update-block", blockId: "b" })]);
        replays(base, mine);
    });

    it("replays inserted, deleted, moved and disabled rows", () => {
        const base = withRows(fresh(), [["a", "one"], ["b", "two"], ["c", "three"], ["d", "four"]]);
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        delete scene.blocks.b;
        scene.blocks.x = row("x", "new");
        scene.blocks.y = row("y", "newer");
        scene.rootBlockIds = ["d", "x", "y", "a", "c"];
        scene.blocks.c.disabled = true;
        replays(base, mine);
    });

    it("replays rows moved into and out of a container, and a new container with rows in it", () => {
        const base = withRows(fresh(), [["box", "<box>"], ["a", "one", "box"], ["b", "two"], ["c", "three"]]);
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        // a leaves the box for the root; b goes into it; a new box holds c and a new row.
        scene.blocks.box.childrenIds = ["b"];
        scene.blocks.b.parentId = "box";
        scene.blocks.a.parentId = null;
        scene.blocks.nb = container("nb");
        scene.blocks.c.parentId = "nb";
        scene.blocks.z = row("z", "inside", "nb");
        scene.blocks.nb.childrenIds = ["z", "c"];
        scene.rootBlockIds = ["a", "box", "nb"];
        replays(base, mine);
    });

    it("retains a row moved out of a deleted container", () => {
        const base = withRows(fresh(), [["parent", "<box>"], ["child", "retained", "parent"]]);
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        delete scene.blocks.parent;
        scene.blocks.child.parentId = null;
        scene.rootBlockIds = ["child"];

        const ops = storyDiffToOps(base, mine);
        const move = ops.findIndex(op => op.op === "move-block" && op.blockId === "child");
        const deletion = ops.findIndex(op => op.op === "delete-block" && op.blockId === "parent");
        expect(move).toBeGreaterThanOrEqual(0);
        expect(deletion).toBeGreaterThan(move);
        replays(base, mine);
    });

    it("retains nested choice rows and their references when replacing and deleting containers", () => {
        const base = withRows(fresh(), [
            ["old-choice", "<box>"], ["option", "<box>", "old-choice"],
            ["create", "placeholder", "option"], ["show", "placeholder", "option"],
            ["old-child", "discarded", "old-choice"], ["discard", "discarded"], ["tail", "tail"],
        ]);
        const original = firstScene(base);
        original.blocks["old-choice"] = {
            ...original.blocks["old-choice"], kind: "nodeAction", payload: { action: "choice" },
        } as StoryBlock;
        original.blocks.option = {
            ...original.blocks.option, kind: "nodeAction",
            payload: { action: "choiceOption", text: { textId: "option-text", role: "choiceText", value: "Option" } },
        } as StoryBlock;
        original.blocks.create = {
            id: "create", kind: "action", parentId: "option", childrenIds: [],
            payload: { action: "image", operation: "create", objectName: "portrait" },
        };
        original.blocks.show = {
            id: "show", kind: "action", parentId: "option", childrenIds: [],
            payload: { action: "displayable", operation: "show", target: { kind: "image", name: "portrait", sourceBlockId: "create" } },
        };
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        delete scene.blocks["old-choice"];
        delete scene.blocks["old-child"];
        delete scene.blocks.discard;
        scene.blocks["new-choice"] = {
            id: "new-choice", kind: "nodeAction", parentId: null, childrenIds: ["option", "new-option"],
            payload: { action: "choice" },
        };
        scene.blocks["new-option"] = {
            id: "new-option", kind: "nodeAction", parentId: "new-choice", childrenIds: [],
            payload: { action: "choiceOption", text: { textId: "new-option-text", role: "choiceText", value: "New" } },
        } as StoryBlock;
        scene.blocks.option.parentId = "new-choice";
        (scene.blocks.option.payload as { text: { value: string } }).text.value = "Edited option";
        scene.blocks.show.disabled = true;
        scene.rootBlockIds = ["tail", "new-choice"];

        expect(storyDiffToOps(base, mine)).toContainEqual(expect.objectContaining({
            op: "delete-blocks", blockIds: expect.arrayContaining(["old-choice", "discard"]),
        }));
        replays(base, mine);
    });

    it("replays a legal multi-row move followed by a batch deletion", () => {
        const base = withRows(fresh(), [
            ["before", "before"], ["box", "<box>"], ["a", "one", "box"], ["b", "two", "box"],
            ["nested", "<box>", "box"], ["c", "three", "nested"], ["discard", "discard"], ["tail", "tail"],
        ]);
        const mine = structuredClone(base);
        const sceneId = firstScene(mine).id;
        applyStoryOpToDocument(mine, {
            op: "move-blocks", sceneId, moves: [
                { blockIds: ["a", "b"], target: { parentId: null, beforeBlockId: "tail" } },
                { blockIds: ["nested"], target: { parentId: null, beforeBlockId: "tail" } },
            ],
        }, { now: NOW });
        applyStoryOpToDocument(mine, { op: "delete-blocks", sceneId, blockIds: ["box", "discard"] }, { now: NOW });
        expect(firstScene(mine).rootBlockIds).toEqual(["before", "a", "b", "nested", "tail"]);
        expect(storyDiffToOps(base, mine)).toContainEqual(expect.objectContaining({
            op: "delete-blocks", blockIds: expect.arrayContaining(["box", "discard"]),
        }));
        replays(base, mine);
    });

    it("keeps independent deletions in one batch without moving unchanged rows", () => {
        const base = withRows(fresh(), [["a", "one"], ["x", "discard"], ["y", "discard"], ["b", "two"]]);
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        delete scene.blocks.x;
        delete scene.blocks.y;
        scene.rootBlockIds = ["a", "b"];

        expect(storyDiffToOps(base, mine)).toEqual([{ op: "delete-blocks", sceneId: scene.id, blockIds: ["x", "y"] }]);
        replays(base, mine);
    });

    it("replays nested containers whose ancestor order is reversed", () => {
        const base = withRows(fresh(), [["outer", "<box>"], ["middle", "<box>", "outer"], ["inner", "<box>", "middle"]]);
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        scene.rootBlockIds = ["inner"];
        scene.blocks.inner.parentId = null;
        scene.blocks.inner.childrenIds = ["middle"];
        scene.blocks.middle.parentId = "inner";
        scene.blocks.middle.childrenIds = ["outer"];
        scene.blocks.outer.parentId = "middle";
        scene.blocks.outer.childrenIds = [];

        replays(base, mine);
    });

    it("keeps new rows in order when existing siblings are reordered", () => {
        const base = withRows(fresh(), [["a", "one"], ["b", "two"]]);
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        scene.blocks.x = row("x", "new x");
        scene.blocks.y = row("y", "new y");
        scene.rootBlockIds = ["x", "b", "y", "a"];

        replays(base, mine);
    });

    it("updates a row to a choice before moving an option into it", () => {
        const base = withRows(fresh(), [["destination", "prompt"], ["old-choice", "<box>"], ["option", "<box>", "old-choice"]]);
        const original = firstScene(base);
        original.blocks["old-choice"] = {
            ...original.blocks["old-choice"], kind: "nodeAction", payload: { action: "choice" },
        } as StoryBlock;
        original.blocks.option = {
            ...original.blocks.option, kind: "nodeAction",
            payload: { action: "choiceOption", text: { textId: "option-text", role: "choiceText", value: "Option" } },
        } as StoryBlock;
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        scene.blocks.destination.payload = { action: "choice", prompt: { textId: "prompt-text", role: "choicePrompt", value: "Choose" } };
        scene.blocks.destination.childrenIds = ["option"];
        scene.blocks.option.parentId = "destination";
        scene.blocks["old-choice"].childrenIds = [];

        replays(base, mine);
    });

    it("moves an option out before its choice becomes a narration row", () => {
        const base = withRows(fresh(), [["source", "<box>"], ["option", "<box>", "source"], ["destination", "<box>"]]);
        const original = firstScene(base);
        original.blocks.source = { ...original.blocks.source, kind: "nodeAction", payload: { action: "choice" } } as StoryBlock;
        original.blocks.destination = { ...original.blocks.destination, kind: "nodeAction", payload: { action: "choice" } } as StoryBlock;
        original.blocks.option = {
            ...original.blocks.option, kind: "nodeAction",
            payload: { action: "choiceOption", text: { textId: "option-text", role: "choiceText", value: "Option" } },
        } as StoryBlock;
        const mine = structuredClone(base);
        const scene = firstScene(mine);
        scene.blocks.source.payload = row("source", "Now narration").payload;
        scene.blocks.source.childrenIds = [];
        scene.blocks.destination.childrenIds = ["option"];
        scene.blocks.option.parentId = "destination";

        const ops = storyDiffToOps(base, mine);
        const move = ops.findIndex(op => op.op === "move-block" && op.blockId === "option");
        const update = ops.findIndex(op => op.op === "update-block" && op.blockId === "source");
        expect(move).toBeGreaterThanOrEqual(0);
        expect(update).toBeGreaterThan(move);
        replays(base, mine);
    });

    it("replays scenes and chapters made, renamed, moved, reordered and deleted", () => {
        const base = withRows(fresh(), [["a", "one"]]);
        const baseScene = firstScene(base);
        const second: StoryScene = { ...structuredClone(baseScene), id: "s2", name: "Two", runtimeName: "two", rootBlockIds: [], blocks: {} };
        base.scenes.s2 = second;
        base.chapters[0].sceneIds.push("s2");
        base.chapters.push({ id: "c2", name: "Old chapter", sceneIds: [] });

        const mine = structuredClone(base);
        mine.name = "Renamed story";
        mine.chapters[0].name = "Act One";
        mine.chapters.push({ id: "c3", name: "Act Two", sceneIds: ["s2", "s3"] });
        mine.chapters[0].sceneIds = [baseScene.id];
        mine.chapters = mine.chapters.filter(chapter => chapter.id !== "c2");
        mine.chapters = [mine.chapters[1], mine.chapters[0]];
        mine.scenes.s3 = { ...structuredClone(second), id: "s3", name: "Three", runtimeName: "three" };
        mine.scenes.s2.description = "moved";
        mine.entrySceneId = "s3";
        replays(base, mine);
    });

    it("replays whatever a run of random edits produced", () => {
        let seed = 7;
        const random = (n: number): number => {
            seed = (seed * 1103515245 + 12345) % 2147483648;
            return seed % n;
        };
        for (let round = 0; round < 60; round += 1) {
            const base = withRows(fresh(), [["r0", "zero"], ["r1", "one"], ["box", "<box>"], ["r2", "two", "box"], ["r3", "three"]]);
            const mine = structuredClone(base);
            const scene = firstScene(mine);
            let made = 0;
            for (let step = 0; step < 6; step += 1) {
                const ids = Object.keys(scene.blocks);
                const pick = ids[random(ids.length)];
                switch (random(5)) {
                    case 0: {
                        const id = `n${round}-${made++}`;
                        scene.blocks[id] = row(id, `new ${id}`);
                        scene.rootBlockIds.splice(random(scene.rootBlockIds.length + 1), 0, id);
                        break;
                    }
                    case 1: {
                        if (pick === undefined || pick === "box") break;
                        const parent = scene.blocks[pick].parentId;
                        const siblings = parent ? scene.blocks[parent].childrenIds : scene.rootBlockIds;
                        siblings.splice(siblings.indexOf(pick), 1);
                        delete scene.blocks[pick];
                        break;
                    }
                    case 2: {
                        if (pick === undefined) break;
                        (scene.blocks[pick].payload as { text?: { value: string } }).text = { value: `edit ${step}` } as never;
                        break;
                    }
                    case 3: {
                        if (pick === undefined || pick === "box") break;
                        const block = scene.blocks[pick];
                        const from = block.parentId ? scene.blocks[block.parentId].childrenIds : scene.rootBlockIds;
                        from.splice(from.indexOf(pick), 1);
                        const intoBox = random(2) === 0 && scene.blocks.box !== undefined;
                        const to = intoBox ? scene.blocks.box.childrenIds : scene.rootBlockIds;
                        block.parentId = intoBox ? "box" : null;
                        to.splice(random(to.length + 1), 0, pick);
                        break;
                    }
                    default:
                        if (pick !== undefined) scene.blocks[pick].disabled = random(2) === 0 ? true : undefined;
                }
            }
            for (const block of Object.values(scene.blocks)) {
                if (block.disabled === undefined) delete block.disabled;
            }
            replays(base, mine);
        }
    });

    it("replays deterministic runs of nested moves, insertions and subtree deletions", () => {
        let seed = 0x9e3779b9;
        const random = (n: number): number => {
            seed ^= seed << 13;
            seed ^= seed >>> 17;
            seed ^= seed << 5;
            return (seed >>> 0) % n;
        };
        for (let round = 0; round < 200; round += 1) {
            const base = withRows(fresh(), [
                ["outer", "<box>"], ["inner", "<box>", "outer"], ["a", "one", "inner"], ["b", "two", "outer"],
                ["other", "<box>"], ["c", "three", "other"], ["tail", "tail"],
            ]);
            const mine = structuredClone(base);
            const scene = firstScene(mine);
            let made = 0;
            for (let step = 0; step < 20; step += 1) {
                const blocks = Object.values(scene.blocks);
                const id = blocks.length > 0 ? blocks[random(blocks.length)].id : undefined;
                const action = random(4);
                if (action === 0 && id !== undefined) {
                    const parents = [null, ...blocks.filter(block => {
                        if (block.kind !== "control") return false;
                        let ancestor: string | null = block.id;
                        while (ancestor !== null) {
                            if (ancestor === id) return false;
                            ancestor = scene.blocks[ancestor].parentId;
                        }
                        return true;
                    }).map(block => block.id)];
                    const parentId = parents[random(parents.length)];
                    const siblings = (parentId === null ? scene.rootBlockIds : scene.blocks[parentId].childrenIds).filter(sibling => sibling !== id);
                    const beforeBlockId = siblings[random(siblings.length + 1)] ?? null;
                    applyStoryOpToDocument(mine, { op: "move-block", sceneId: scene.id, blockId: id, target: { parentId, beforeBlockId } }, { now: NOW });
                } else if (action === 1 && id !== undefined) {
                    applyStoryOpToDocument(mine, { op: "delete-block", sceneId: scene.id, blockId: id }, { now: NOW });
                } else if (action === 2 || id === undefined) {
                    const parents = [null, ...blocks.filter(block => block.kind === "control").map(block => block.id)];
                    const parentId = parents[random(parents.length)];
                    const siblings = parentId === null ? scene.rootBlockIds : scene.blocks[parentId].childrenIds;
                    const beforeBlockId = siblings.length > 0 && random(2) === 0 ? siblings[random(siblings.length)] : null;
                    const newId = `new-${round}-${made++}`;
                    const block = random(2) === 0 ? container(newId) : row(newId, `text ${newId}`);
                    applyStoryOpToDocument(mine, { op: "insert-block", sceneId: scene.id, block, target: { parentId, beforeBlockId } }, { now: NOW });
                } else if (id !== undefined) {
                    applyStoryOpToDocument(mine, { op: "set-block-disabled", sceneId: scene.id, blockId: id, disabled: random(2) === 0 }, { now: NOW });
                }
            }
            replays(base, mine, `round ${round}`);
        }
    });
});
