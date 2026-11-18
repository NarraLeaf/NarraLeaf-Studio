import { describe, expect, it } from "vitest";
import type { StoryActionPayload, StoryBlock } from "@shared/types/story";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { storySceneHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { bindStoryMotionToRow, getStoryMotionDescriptor } from "./storyMotionAction";

describe("getStoryMotionDescriptor", () => {
    it("binds a camera transform to a camera motion", () => {
        const block: StoryBlock = {
            id: "camera",
            kind: "action",
            parentId: null,
            childrenIds: [],
            payload: { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 1.2 } } },
        };
        const descriptor = getStoryMotionDescriptor(block);
        expect(descriptor?.targetKind).toBe("camera");
        expect(descriptor?.setTransform({ mode: "animation", animationId: "motion" })).toEqual({
            action: "camera",
            operation: "transform",
            transform: { mode: "animation", animationId: "motion" },
        });
    });

    it("offers motion binding for loops that play a keyframed transform", () => {
        const camera: StoryBlock = { id: "camera", kind: "action", parentId: null, childrenIds: [], payload: { action: "camera", operation: "loop" } };
        const image: StoryBlock = { id: "image", kind: "action", parentId: null, childrenIds: [], payload: { action: "displayable", operation: "loop", target: { name: "hero", kind: "image" } } };
        expect(getStoryMotionDescriptor(camera)?.targetKind).toBe("camera");
        expect(getStoryMotionDescriptor(image)?.targetKind).toBe("image");
    });

    it("does not offer motion binding on operations that do not play a transform", () => {
        const payloads: StoryActionPayload[] = [
            { action: "character", operation: "expression", characterId: "alice" },
            { action: "character", operation: "setName", characterId: "alice" },
            { action: "image", operation: "setSource", objectName: "hero", assetId: "asset" },
            { action: "text", operation: "setText", objectName: "title", text: "Hello" },
            { action: "text", operation: "setFontColor", objectName: "title", fontColor: "#fff" },
            { action: "nvl" },
        ];
        for (const payload of payloads) {
            expect(getStoryMotionDescriptor({ id: "row", kind: "action", parentId: null, childrenIds: [], payload }), payload.action).toBeNull();
        }
    });

    it("records a library binding on the story scene's undo stack", () => {
        const context = { storyId: "story", sceneId: "scene", blockId: "row" };
        let block: StoryBlock = {
            id: "row", kind: "action", parentId: null, childrenIds: [],
            payload: { action: "camera", operation: "transform", transform: { mode: "props", to: { zoom: 1.2 } } },
        };
        const history = new HistoryService();
        history.setContext({ project: {} as never, services: {} as never, commandLineRun: false });
        const scope = storySceneHistoryScope(context.storyId, context.sceneId);
        history.registerScope({
            id: scope,
            label: { key: "workspace.history.entry.storyEdit" },
            capture: () => structuredClone(block),
            apply: snapshot => { block = snapshot; },
        });
        const story = { updateBlock: (_storyId: string, _sceneId: string, _blockId: string, payload: StoryBlock["payload"]) => { block = { ...block, payload } as StoryBlock; } };

        bindStoryMotionToRow(story, history, context, block, getStoryMotionDescriptor(block)!, "motion");
        expect(block.payload).toMatchObject({ transform: { mode: "animation", animationId: "motion" } });
        expect(history.undo(scope)).toBe(true);
        expect(block.payload).toMatchObject({ transform: { mode: "props", to: { zoom: 1.2 } } });
        expect(history.redo(scope)).toBe(true);
        expect(block.payload).toMatchObject({ transform: { mode: "animation", animationId: "motion" } });
    });

    it("keeps a scene binding undoable after its editor closes", () => {
        const context = { storyId: "story", sceneId: "scene", blockId: "row" };
        let block: StoryBlock = {
            id: "row", kind: "action", parentId: null, childrenIds: [],
            payload: { action: "camera", operation: "transform", transform: { mode: "props" } },
        };
        const history = new HistoryService();
        history.setContext({ project: {} as never, services: {} as never, commandLineRun: false });
        const story = { updateBlock: (_storyId: string, _sceneId: string, _blockId: string, payload: StoryBlock["payload"]) => { block = { ...block, payload } as StoryBlock; } };
        const scope = storySceneHistoryScope(context.storyId, context.sceneId);

        bindStoryMotionToRow(story, history, context, block, getStoryMotionDescriptor(block)!, "motion");
        expect(history.undo(scope)).toBe(true);
        expect(block.payload).toMatchObject({ transform: { mode: "props" } });
        expect(history.redo(scope)).toBe(true);
        expect(block.payload).toMatchObject({ transform: { mode: "animation", animationId: "motion" } });
    });
});
