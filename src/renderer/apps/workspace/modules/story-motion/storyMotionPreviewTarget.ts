import type {
    StoryBlock,
    StoryBlockId,
    StoryDisplayableTargetKind,
    StoryDocument,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";

export type StoryMotionPreviewTarget = {
    kind: StoryDisplayableTargetKind;
    label: string;
    assetId?: string;
    text?: string;
    fontSize?: number;
    fontColor?: string;
};

export function resolveStoryMotionPreviewTarget(input: {
    document: StoryDocument | null | undefined;
    sceneId: StorySceneId | undefined;
    blockId: StoryBlockId | undefined;
    fallbackKind: StoryDisplayableTargetKind;
    fallbackLabel: string;
    previewAssetId?: string;
}): StoryMotionPreviewTarget {
    return withPreviewAsset(resolveTargetWithoutPreview(input), input.previewAssetId);
}

function resolveTargetWithoutPreview(input: {
    document: StoryDocument | null | undefined;
    sceneId: StorySceneId | undefined;
    blockId: StoryBlockId | undefined;
    fallbackKind: StoryDisplayableTargetKind;
    fallbackLabel: string;
}): StoryMotionPreviewTarget {
    const fallback: StoryMotionPreviewTarget = {
        kind: input.fallbackKind,
        label: input.fallbackLabel.trim() || labelForKind(input.fallbackKind),
    };
    if (!input.document || !input.sceneId || !input.blockId) {
        return fallback;
    }
    const scene = input.document.scenes[input.sceneId];
    const block = scene?.blocks[input.blockId];
    if (!scene || !block || block.kind !== "action") {
        return fallback;
    }
    const direct = previewTargetFromBlock(block);
    if (!direct) {
        return fallback;
    }
    if (block.payload.action !== "displayable") {
        return { ...fallback, ...direct };
    }
    return {
        ...fallback,
        ...resolveDisplayableFromScene(scene, input.blockId, direct),
    };
}

function withPreviewAsset(target: StoryMotionPreviewTarget, previewAssetId: string | undefined): StoryMotionPreviewTarget {
    if (target.assetId || !previewAssetId) {
        return target;
    }
    return { ...target, assetId: previewAssetId };
}

function previewTargetFromBlock(block: StoryBlock): StoryMotionPreviewTarget | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "character") {
        return {
            kind: "character",
            label: payload.objectName || "Character",
            assetId: payload.assetId,
        };
    }
    if (payload.action === "image") {
        return {
            kind: "image",
            label: payload.objectName || "Image",
            assetId: payload.assetId,
        };
    }
    if (payload.action === "text") {
        return {
            kind: "text",
            label: payload.objectName || "Text",
            text: payload.text,
            fontSize: payload.fontSize,
            fontColor: payload.fontColor,
        };
    }
    if (payload.action === "layer") {
        return {
            kind: "layer",
            label: payload.objectName || "Layer",
        };
    }
    if (payload.action === "displayable") {
        return {
            kind: payload.target.kind ?? "image",
            label: payload.target.name || "Displayable",
        };
    }
    if (payload.action === "nvl") {
        return {
            kind: "layer",
            label: "NVL",
        };
    }
    return null;
}

function resolveDisplayableFromScene(
    scene: StoryScene,
    blockId: StoryBlockId,
    requested: StoryMotionPreviewTarget,
): StoryMotionPreviewTarget {
    const blocks = flattenSceneBlocks(scene);
    const activeIndex = blocks.findIndex(block => block.id === blockId);
    const previousBlocks = activeIndex >= 0 ? blocks.slice(0, activeIndex) : blocks;
    let resolved = requested;
    for (const block of previousBlocks) {
        if (block.kind !== "action") {
            continue;
        }
        const target = previewTargetFromBlock(block);
        if (!target || target.kind !== requested.kind || !sameStageName(target.label, requested.label)) {
            continue;
        }
        resolved = {
            ...resolved,
            ...target,
        };
    }
    return resolved;
}

function flattenSceneBlocks(scene: StoryScene): StoryBlock[] {
    const result: StoryBlock[] = [];
    const visit = (blockId: StoryBlockId) => {
        const block = scene.blocks[blockId];
        if (!block) {
            return;
        }
        result.push(block);
        block.childrenIds.forEach(visit);
    };
    scene.rootBlockIds.forEach(visit);
    return result;
}

function sameStageName(left: string, right: string): boolean {
    return left.trim().toLowerCase() === right.trim().toLowerCase();
}

function labelForKind(kind: StoryDisplayableTargetKind): string {
    if (kind === "character") return "Character";
    if (kind === "text") return "Text";
    if (kind === "layer") return "Layer";
    return "Image";
}
