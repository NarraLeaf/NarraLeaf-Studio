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

function replays(base: StoryDocument, mine: StoryDocument): void {
    const ops = storyDiffToOps(base, mine);
    const replayed = structuredClone(base);
    for (const op of ops) {
        applyStoryOpToDocument(replayed, structuredClone(op), { now: NOW });
    }
    expect(content(replayed)).toEqual(content(mine));
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
});
