import type {
    StoryBlock,
    StoryDisplayableTargetKind,
    StoryTransformRef,
} from "@shared/types/story";

export type StoryMotionDescriptor = {
    transform: StoryTransformRef | undefined;
    targetKind: StoryDisplayableTargetKind;
    label: string;
    operation: "show" | "hide" | "transform";
    setTransform: (transform: StoryTransformRef | undefined) => StoryBlock["payload"];
};

export function getStoryMotionDescriptor(block: StoryBlock): StoryMotionDescriptor | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "character") {
        return {
            transform: payload.transform,
            targetKind: "character",
            label: `${payload.characterId || payload.objectName || "Character"} ${payload.operation}`,
            operation: payload.operation === "exit" ? "hide" : payload.operation === "move" ? "transform" : "show",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "image") {
        return {
            transform: payload.transform,
            targetKind: "image",
            label: `${payload.objectName || "Image"} ${payload.operation}`,
            operation: payload.operation === "hide" ? "hide" : payload.operation === "show" || payload.operation === "create" ? "show" : "transform",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "displayable") {
        if (payload.operation !== "show" && payload.operation !== "hide" && payload.operation !== "transform") {
            // Effect operations (mask/filter/darken/...) do not carry a Transform.
            return null;
        }
        return {
            transform: payload.transform,
            targetKind: payload.target.kind ?? "image",
            label: `${payload.target.name || "Displayable"} ${payload.operation}`,
            operation: payload.operation,
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "text") {
        return {
            transform: payload.transform,
            targetKind: "text",
            label: `${payload.objectName || "Text"} ${payload.operation}`,
            operation: payload.operation === "hide" ? "hide" : payload.operation === "show" || payload.operation === "create" ? "show" : "transform",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "layer") {
        return {
            transform: payload.transform,
            targetKind: "layer",
            label: `${payload.objectName || "Layer"} ${payload.operation}`,
            operation: payload.operation === "hide" ? "hide" : payload.operation === "show" || payload.operation === "create" ? "show" : "transform",
            setTransform: transform => ({ ...payload, transform }),
        };
    }
    if (payload.action === "nvl") {
        return {
            transform: payload.transition,
            targetKind: "layer",
            label: "NVL transition",
            operation: "show",
            setTransform: transition => ({ ...payload, transition }),
        };
    }
    return null;
}
