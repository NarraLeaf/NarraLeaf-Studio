import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneId } from "@shared/types/story";
import {
    applySceneMerge,
    findSceneReferrersInBlueprints,
    moveBlocksToScene,
    planSceneMerge,
    planSceneSplit,
    sceneNeighbours,
} from "./storyStructuralOps";

/**
 * The row order a player would walk, which is what "playback is unchanged" has to be measured
 * against.
 *
 * Deliberately not the compiler: this asks the one question a structural edit can change, which is
 * which rows are reached and in what order. Scenes have no successor in this engine - play runs off
 * the last row and stops - so the walk ends there unless a jump hands control on, and that is
 * exactly what a split has to preserve.
 */
function playbackOrder(document: StoryDocument, fromSceneId: StorySceneId): StoryBlockId[] {
    const seen = new Set<StorySceneId>();
    const order: StoryBlockId[] = [];
    let sceneId: StorySceneId | null = fromSceneId;
    while (sceneId && !seen.has(sceneId)) {
        seen.add(sceneId);
        const scene: StoryScene | undefined = document.scenes[sceneId];
        if (!scene) {
            break;
        }
        let next: StorySceneId | null = null;
        for (const blockId of scene.rootBlockIds) {
            const block: StoryBlock | undefined = scene.blocks[blockId];
            if (!block || block.disabled) {
                continue;
            }
            if (block.kind === "jump") {
                next = block.payload.targetSceneId;
                break;
            }
            order.push(blockId);
        }
        sceneId = next;
    }
    return order;
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

function jump(id: string, targetSceneId: StorySceneId): StoryBlock {
    return { id, parentId: null, childrenIds: [], kind: "jump", payload: { targetSceneId } };
}

function container(id: string, childIds: string[]): StoryBlock {
    return { id, parentId: null, childrenIds: [...childIds], kind: "control", payload: { control: "sequence", mode: "do" } };
}

function scene(id: string, name: string, blocks: StoryBlock[], rootIds?: string[]): StoryScene {
    const table: Record<string, StoryBlock> = {};
    for (const block of blocks) {
        table[block.id] = block;
    }
    return {
        id,
        name,
        runtimeName: id,
        rootBlockIds: rootIds ?? blocks.filter(block => block.parentId === null).map(block => block.id),
        blocks: table,
    };
}

function document(scenes: StoryScene[], entrySceneId?: string): StoryDocument {
    const table: Record<string, StoryScene> = {};
    for (const item of scenes) {
        table[item.id] = item;
    }
    return {
        schemaVersion: 1 as StoryDocument["schemaVersion"],
        id: "story",
        name: "Tale",
        ...(entrySceneId ? { entrySceneId } : {}),
        chapters: [{ id: "chapter", name: "One", sceneIds: scenes.map(item => item.id) }],
        scenes: table,
    };
}

describe("moveBlocksToScene", () => {
    it("re-homes rows without changing a single id", () => {
        const doc = document([
            scene("a", "A", [narration("r1", "one"), narration("r2", "two"), narration("r3", "three")]),
            scene("b", "B", [narration("r9", "nine")]),
        ]);

        expect(moveBlocksToScene(doc, "a", "b", ["r2", "r3"], { parentId: null, beforeBlockId: null })).toBe(2);

        expect(doc.scenes.a.rootBlockIds).toEqual(["r1"]);
        expect(doc.scenes.b.rootBlockIds).toEqual(["r9", "r2", "r3"]);
        expect(Object.keys(doc.scenes.a.blocks)).toEqual(["r1"]);
        // The text ids travel with the rows, which is what keeps every translation unit bound.
        const moved = doc.scenes.b.blocks.r2;
        expect(moved.kind === "nodeAction" && moved.payload.action === "narration" && moved.payload.text.textId)
            .toBe("r2-text");
    });

    it("takes a container's whole subtree and keeps it a subtree", () => {
        const child = narration("c1", "inner");
        child.parentId = "box";
        const doc = document([
            scene("a", "A", [narration("r1", "one"), container("box", ["c1"]), child], ["r1", "box"]),
            scene("b", "B", []),
        ]);

        expect(moveBlocksToScene(doc, "a", "b", ["box"], { parentId: null, beforeBlockId: null })).toBe(2);

        expect(doc.scenes.a.rootBlockIds).toEqual(["r1"]);
        expect(doc.scenes.b.rootBlockIds).toEqual(["box"]);
        expect(doc.scenes.b.blocks.box.childrenIds).toEqual(["c1"]);
        expect(doc.scenes.b.blocks.c1.parentId).toBe("box");
        expect(doc.scenes.a.blocks.c1).toBeUndefined();
    });

    it("leaves a jump that names a moved row's scene pointing where it did", () => {
        const doc = document([
            scene("a", "A", [narration("r1", "one"), narration("r2", "two")]),
            scene("b", "B", [narration("r9", "nine")]),
            scene("c", "C", [jump("j1", "b")]),
        ]);

        moveBlocksToScene(doc, "a", "b", ["r2"], { parentId: null, beforeBlockId: "r9" });

        const target = doc.scenes.c.blocks.j1;
        expect(target.kind === "jump" && target.payload.targetSceneId).toBe("b");
        expect(doc.scenes.b.rootBlockIds).toEqual(["r2", "r9"]);
    });

    it("refuses a move into a scene that does not exist", () => {
        const doc = document([scene("a", "A", [narration("r1", "one")])]);
        expect(moveBlocksToScene(doc, "a", "gone", ["r1"], { parentId: null, beforeBlockId: null })).toBe(0);
        expect(doc.scenes.a.rootBlockIds).toEqual(["r1"]);
    });
});

describe("planSceneSplit", () => {
    it("asks for a jump when the first half would run off its own end", () => {
        const scene0 = scene("a", "A", [narration("r1", "one"), narration("r2", "two"), narration("r3", "three")]);
        const plan = planSceneSplit(scene0, "r2");
        expect(plan).toEqual({ movingRootIds: ["r2", "r3"], needsJump: true, ties: [] });
    });

    it("asks for none when the first half already hands control on", () => {
        const scene0 = scene("a", "A", [narration("r1", "one"), jump("j1", "z"), narration("r3", "three")]);
        expect(planSceneSplit(scene0, "r3")?.needsJump).toBe(false);
    });

    it("ignores a disabled last row when deciding", () => {
        const tail = jump("j1", "z");
        tail.disabled = true;
        const scene0 = scene("a", "A", [narration("r1", "one"), tail, narration("r3", "three")]);
        expect(planSceneSplit(scene0, "r3")?.needsJump).toBe(true);
    });

    it("names a stage object the second half would be left addressing", () => {
        const show: StoryBlock = {
            id: "show", parentId: null, childrenIds: [], kind: "action",
            payload: { action: "image", operation: "create", objectName: "poster", assetId: "a1" },
        };
        const hide: StoryBlock = {
            id: "hide", parentId: null, childrenIds: [], kind: "action",
            payload: { action: "image", operation: "hide", objectName: "poster" },
        };
        const scene0 = scene("a", "A", [show, narration("r1", "one"), hide]);

        expect(planSceneSplit(scene0, "r1")?.ties).toEqual([{ kind: "stageObject", label: "poster" }]);
        // Cut after the row that addresses it and nothing spans the cut any more.
        expect(planSceneSplit(scene0, "hide")?.ties).toEqual([{ kind: "stageObject", label: "poster" }]);
        expect(planSceneSplit(scene0, "show")?.ties).toEqual([]);
    });

    it("names a label a `/goto` after the cut would no longer reach", () => {
        const label: StoryBlock = {
            id: "label", parentId: null, childrenIds: [], kind: "control",
            payload: { control: "label", name: "start" },
        };
        const goto: StoryBlock = {
            id: "goto", parentId: null, childrenIds: [], kind: "control",
            payload: { control: "goto", targetLabel: "start" },
        };
        const scene0 = scene("a", "A", [label, narration("r1", "one"), goto]);

        expect(planSceneSplit(scene0, "r1")?.ties).toEqual([{ kind: "label", label: "start" }]);
        expect(planSceneSplit(scene0, "label")?.ties).toEqual([]);
    });

    it("names a scene variable the second half would find undeclared", () => {
        const declaration: StoryBlock = {
            id: "var", parentId: null, childrenIds: [], kind: "declaration",
            payload: { scope: "scene", name: "Gold", valueType: "number", storageKey: "var" },
        };
        const setter: StoryBlock = {
            id: "set", parentId: null, childrenIds: [], kind: "action",
            payload: { action: "setVariable", target: { scope: "scene", variableId: "var" }, value: 1 },
        };
        const scene0 = scene("a", "A", [declaration, narration("r1", "one"), setter]);

        expect(planSceneSplit(scene0, "r1")?.ties).toEqual([{ kind: "variable", label: "Gold" }]);
        expect(planSceneSplit(scene0, "declaration" as StoryBlockId)?.ties).toBeUndefined();
        expect(planSceneSplit(scene0, "var")?.ties).toEqual([]);
    });

    it("refuses a row that is not at the top level", () => {
        const child = narration("c1", "inner");
        child.parentId = "box";
        const scene0 = scene("a", "A", [container("box", ["c1"]), child], ["box"]);
        expect(planSceneSplit(scene0, "c1")).toBeNull();
    });
});

describe("planSceneMerge / applySceneMerge", () => {
    it("drops the trailing jump a split wrote and puts the rows back in order", () => {
        const doc = document([
            scene("a", "A", [narration("r1", "one"), jump("j1", "b")]),
            scene("b", "B", [narration("r2", "two"), narration("r3", "three")]),
        ], "a");
        const before = playbackOrder(doc, "a");

        const plan = planSceneMerge(doc, "a", "b")!;
        expect(plan.droppedJumpBlockId).toBe("j1");
        applySceneMerge(doc, plan);

        expect(doc.scenes.a.rootBlockIds).toEqual(["r1", "r2", "r3"]);
        expect(doc.scenes.b).toBeUndefined();
        expect(doc.chapters[0].sceneIds).toEqual(["a"]);
        expect(playbackOrder(doc, "a")).toEqual(before);
    });

    it("re-points a jump from elsewhere at the surviving scene", () => {
        const doc = document([
            scene("a", "A", [narration("r1", "one"), jump("j1", "b")]),
            scene("b", "B", [narration("r2", "two")]),
            scene("c", "C", [jump("j2", "b")]),
        ]);

        const plan = planSceneMerge(doc, "a", "b")!;
        expect(plan.rewrittenJumpBlockIds).toEqual(["j2"]);
        applySceneMerge(doc, plan);

        const rewritten = doc.scenes.c.blocks.j2;
        expect(rewritten.kind === "jump" && rewritten.payload.targetSceneId).toBe("a");
    });

    it("moves the entry pointer off a scene it removes", () => {
        const doc = document([
            scene("a", "A", [narration("r1", "one")]),
            scene("b", "B", [narration("r2", "two")]),
        ], "b");

        applySceneMerge(doc, planSceneMerge(doc, "a", "b")!);
        expect(doc.entrySceneId).toBe("a");
    });

    it("writes nothing while anything outside the story still names the scene", () => {
        const doc = document([
            scene("a", "A", [narration("r1", "one")]),
            scene("b", "B", [narration("r2", "two")]),
        ]);
        const plan = planSceneMerge(doc, "a", "b", [{ kind: "blueprint", label: "Quit" }])!;
        expect(plan.blockers).toHaveLength(1);

        applySceneMerge(doc, plan);
        expect(doc.scenes.b).toBeDefined();
        expect(doc.scenes.a.rootBlockIds).toEqual(["r1"]);
    });

    it("survives a round trip: split then merge leaves the same playback", () => {
        const doc = document([
            scene("a", "A", [narration("r1", "one"), narration("r2", "two"), narration("r3", "three")]),
        ], "a");
        const before = playbackOrder(doc, "a");

        // What `StoryService.splitScene` does, without the service around it.
        const plan = planSceneSplit(doc.scenes.a, "r2")!;
        doc.scenes.b = scene("b", "A 2", []);
        doc.chapters[0].sceneIds.push("b");
        moveBlocksToScene(doc, "a", "b", plan.movingRootIds, { parentId: null, beforeBlockId: null });
        doc.scenes.a.blocks.j1 = jump("j1", "b");
        doc.scenes.a.rootBlockIds.push("j1");

        expect(playbackOrder(doc, "a")).toEqual(before);

        applySceneMerge(doc, planSceneMerge(doc, "a", "b")!);
        expect(playbackOrder(doc, "a")).toEqual(before);
        expect(doc.scenes.a.rootBlockIds).toEqual(["r1", "r2", "r3"]);
    });
});

describe("sceneNeighbours", () => {
    it("answers null at either end of the story", () => {
        const doc = document([
            scene("a", "A", []),
            scene("b", "B", []),
            scene("c", "C", []),
        ]);
        expect(sceneNeighbours(doc, "a")).toEqual({ previousSceneId: null, nextSceneId: "b" });
        expect(sceneNeighbours(doc, "b")).toEqual({ previousSceneId: "a", nextSceneId: "c" });
        expect(sceneNeighbours(doc, "c")).toEqual({ previousSceneId: "b", nextSceneId: null });
    });
});

describe("findSceneReferrersInBlueprints", () => {
    it("names the blueprints that hold the id, and no others", () => {
        const blueprints = {
            blueprints: {
                one: { name: "Start", program: { graphs: { main: { nodes: { n1: { params: { sceneId: "b" } } } } } } },
                two: { name: "Quit", program: { graphs: { main: { nodes: { n1: { params: { sceneId: "z" } } } } } } },
            },
        };
        expect(findSceneReferrersInBlueprints(blueprints, "b")).toEqual([{ kind: "blueprint", label: "Start" }]);
        expect(findSceneReferrersInBlueprints(blueprints, "q")).toEqual([]);
        expect(findSceneReferrersInBlueprints(null, "b")).toEqual([]);
    });
});
