import { describe, expect, it } from "vitest";
import type { StoryBlock, StoryScene } from "@shared/types/story";
import { buildStoryLayerPanel, layerDepthEdit } from "./storyLayerPanelModel";

function row(id: string, payload: Record<string, unknown>, extra: Partial<StoryBlock> = {}): StoryBlock {
    return { id, kind: "action", childrenIds: [], payload, ...extra } as unknown as StoryBlock;
}

function sceneOf(blocks: StoryBlock[], extra: Partial<StoryScene> = {}): StoryScene {
    return {
        id: "s",
        name: "Street",
        rootBlockIds: blocks.map(block => block.id),
        blocks: Object.fromEntries(blocks.map(block => [block.id, block])),
        ...extra,
    } as unknown as StoryScene;
}

const hills = row("l_hills", { action: "layer", operation: "create", objectName: "hills", zIndex: -1, depth: "far" });
const branches = row("l_branches", { action: "layer", operation: "create", objectName: "branches", zIndex: 5, depth: "near" });
const bgDepth = row("l_bg", { action: "layer", operation: "setDepth", objectName: "", target: { kind: "default", layer: "background" }, depth: "farthest" });

describe("buildStoryLayerPanel", () => {
    it("lists the layers front to back in the order the stage draws them", () => {
        const model = buildStoryLayerPanel(sceneOf([hills, branches, bgDepth]));
        expect(model.entries.map(entry => entry.key)).toEqual(["custom:l_branches", "displayable", "custom:l_hills", "background"]);
    });

    it("breaks a z-index tie the way the engine does: the layer made later draws in front", () => {
        const level = row("l_level", { action: "layer", operation: "create", objectName: "level", zIndex: 0 });
        const model = buildStoryLayerPanel(sceneOf([level]));
        expect(model.entries.map(entry => entry.key)).toEqual(["custom:l_level", "displayable", "background"]);
    });

    it("reads each layer's depth off its rows and keeps the characters' layer where the camera is aimed", () => {
        const model = buildStoryLayerPanel(sceneOf([hills, branches, bgDepth]));
        const depth = Object.fromEntries(model.entries.map(entry => [entry.key, entry.depth]));
        expect(depth).toEqual({ "custom:l_branches": "near", displayable: "follow", "custom:l_hills": "far", background: "farthest" });
        expect(model.entries.find(entry => entry.kind === "displayable")?.fixed).toBe(true);
        expect(model.entries.find(entry => entry.kind === "background")?.depthRowId).toBe("l_bg");
    });

    it("names what stands on each layer, once each", () => {
        const model = buildStoryLayerPanel(sceneOf([
            hills,
            row("i_mtn", { action: "image", operation: "create", objectName: "mountains", layer: { kind: "custom", sourceBlockId: "l_hills" } }),
            row("i_mtn2", { action: "image", operation: "create", objectName: "mountains", layer: { kind: "custom", sourceBlockId: "l_hills" } }),
            row("c_alice", { action: "character", operation: "enter", characterId: "alice" }),
            row("bg", { action: "setBackground", assetId: "street" }),
        ]), id => (id === "alice" ? "Alice" : undefined));
        const contents = Object.fromEntries(model.entries.map(entry => [entry.key, entry.contents]));
        expect(contents["custom:l_hills"]).toEqual([{ kind: "object", name: "mountains" }]);
        expect(contents.displayable).toEqual([{ kind: "character", characterId: "alice", name: "Alice" }]);
        expect(contents.background).toEqual([{ kind: "sceneBackground" }]);
    });

    it("points out a layer drawn in front of one nearer to the camera", () => {
        const swapped = row("l_hills", { action: "layer", operation: "create", objectName: "hills", zIndex: 5, depth: "far" });
        const model = buildStoryLayerPanel(sceneOf([swapped]));
        expect(model.conflict?.front.key).toBe("custom:l_hills");
        expect(model.conflict?.back.key).toBe("displayable");
        expect(buildStoryLayerPanel(sceneOf([hills, branches, bgDepth])).conflict).toBeNull();
    });

    it("leaves rows that are switched off out, as the game does", () => {
        const model = buildStoryLayerPanel(sceneOf([row("l_off", { action: "layer", operation: "create", objectName: "off" }, { disabled: true })]));
        expect(model.entries.map(entry => entry.key)).toEqual(["displayable", "background"]);
    });
});

describe("layerDepthEdit", () => {
    const scene = sceneOf([hills, branches]);
    const model = buildStoryLayerPanel(scene);
    const entry = (key: string) => model.entries.find(candidate => candidate.key === key)!;

    it("writes a custom layer's depth onto its create row, and takes it off for the default", () => {
        expect(layerDepthEdit(scene, entry("custom:l_hills"), "mid")).toEqual({
            kind: "update",
            blockId: "l_hills",
            payload: { action: "layer", operation: "create", objectName: "hills", zIndex: -1, depth: "mid" },
        });
        expect(layerDepthEdit(scene, entry("custom:l_hills"), "follow")).toEqual({
            kind: "update",
            blockId: "l_hills",
            payload: { action: "layer", operation: "create", objectName: "hills", zIndex: -1 },
        });
    });

    it("adds the background layer's depth row only when there is a depth to state", () => {
        expect(layerDepthEdit(scene, entry("background"), "far")).toEqual({ kind: "insert", depth: "far" });
        expect(layerDepthEdit(scene, entry("background"), "follow")).toBeNull();
    });

    it("updates the background layer's depth row in place when it has one", () => {
        const withRow = sceneOf([bgDepth]);
        const background = buildStoryLayerPanel(withRow).entries.find(candidate => candidate.kind === "background")!;
        expect(layerDepthEdit(withRow, background, "follow")).toEqual({
            kind: "update",
            blockId: "l_bg",
            payload: { action: "layer", operation: "setDepth", objectName: "", target: { kind: "default", layer: "background" }, depth: "follow" },
        });
    });

    it("never moves the characters' layer", () => {
        expect(layerDepthEdit(scene, entry("displayable"), "far")).toBeNull();
    });
});
