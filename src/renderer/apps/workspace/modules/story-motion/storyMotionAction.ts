import type {
    StoryBlock,
    StoryMotionTargetKind,
    StoryTransformRef,
} from "@shared/types/story";
import { layerActionTargetRef, resolveStoryLayerRef } from "@shared/types/story";
import { storySceneHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import type { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { StoryMotionActionContext } from "./storyMotionTypes";

export type StoryMotionDescriptor = {
    transform: StoryTransformRef | undefined;
    targetKind: StoryMotionTargetKind;
    label: string;
    operation: "show" | "hide" | "transform";
    setTransform: (transform: StoryTransformRef | undefined) => StoryBlock["payload"];
};

/** Bind a motion through the scene's history, the same scope the story editor uses. */
export function bindStoryMotionToRow(
    story: Pick<StoryService, "updateBlock">,
    history: Pick<HistoryService, "checkpoint" | "hasScope" | "pushCommand">,
    context: StoryMotionActionContext,
    block: StoryBlock,
    descriptor: StoryMotionDescriptor,
    animationId: string,
): void {
    const transform: StoryTransformRef = { ...descriptor.transform, mode: "animation", animationId };
    const next = descriptor.setTransform(transform);
    const scope = storySceneHistoryScope(context.storyId, context.sceneId);
    const label = { key: "workspace.history.entry.storyEdit" as const };
    if (history.hasScope(scope)) {
        history.checkpoint(scope, { label });
        story.updateBlock(context.storyId, context.sceneId, block.id, next);
        return;
    }
    const before = structuredClone(block.payload);
    story.updateBlock(context.storyId, context.sceneId, block.id, next);
    history.pushCommand(scope, {
        label,
        undo: () => story.updateBlock(context.storyId, context.sceneId, block.id, before),
        redo: () => story.updateBlock(context.storyId, context.sceneId, block.id, next),
    });
}

export function getStoryMotionDescriptor(block: StoryBlock): StoryMotionDescriptor | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "camera") {
        if (payload.operation !== "transform" && payload.operation !== "loop") {
            return null;
        }
        return {
            transform: payload.transform,
            targetKind: "camera",
            label: `Camera ${payload.operation}`,
            operation: "transform",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "character") {
        if (payload.operation !== "enter" && payload.operation !== "exit" && payload.operation !== "move") {
            return null;
        }
        return {
            transform: payload.transform,
            targetKind: "character",
            label: `${payload.characterId || payload.objectName || "Character"} ${payload.operation}`,
            operation: payload.operation === "exit" ? "hide" : payload.operation === "move" ? "transform" : "show",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "image") {
        if (payload.operation !== "create" && payload.operation !== "show" && payload.operation !== "hide") {
            return null;
        }
        return {
            transform: payload.transform,
            targetKind: "image",
            label: `${payload.objectName || "Image"} ${payload.operation}`,
            operation: payload.operation === "hide" ? "hide" : payload.operation === "show" || payload.operation === "create" ? "show" : "transform",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "displayable") {
        if (payload.operation !== "show" && payload.operation !== "hide" && payload.operation !== "transform" && payload.operation !== "loop") {
            return null;
        }
        return {
            transform: payload.transform,
            targetKind: payload.target.kind ?? "image",
            label: `${payload.target.name || "Displayable"} ${payload.operation}`,
            operation: payload.operation === "loop" ? "transform" : payload.operation,
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "text") {
        if (payload.operation !== "create" && payload.operation !== "show" && payload.operation !== "hide") {
            return null;
        }
        return {
            transform: payload.transform,
            targetKind: "text",
            label: `${payload.objectName || "Text"} ${payload.operation}`,
            operation: payload.operation === "hide" ? "hide" : payload.operation === "show" || payload.operation === "create" ? "show" : "transform",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "layer") {
        if (payload.operation !== "show" && payload.operation !== "hide" && payload.operation !== "transform") {
            return null;
        }
        const layerName = resolveStoryLayerRef(undefined, layerActionTargetRef(payload.target, payload.objectName)).name || "Layer";
        return {
            transform: payload.transform,
            targetKind: "layer",
            label: `${layerName} ${payload.operation}`,
            operation: payload.operation === "hide" ? "hide" : payload.operation === "show" ? "show" : "transform",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    return null;
}
