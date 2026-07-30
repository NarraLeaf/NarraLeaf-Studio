import type {
    StoryBlock,
    StoryBlockId,
    StoryDisplayableTargetKind,
    StoryDocument,
    StoryMotionTargetKind,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import { displayableSourceIdentity, resolveDisplayableTargetRef } from "@shared/types/story";

export type StoryMotionPreviewTarget = {
    kind: StoryMotionTargetKind;
    label: string;
    assetId?: string;
    text?: string;
    fontSize?: number;
    fontColor?: string;
    /** Whether the runtime fits this displayable to the stage width (characters always do). */
    autoFit?: boolean;
};

/**
 * A named displayable that exists on stage at a given point in a scene, used to let the
 * action inspector offer pick-from-context targets instead of a free-text name + kind infer.
 */
export type SceneDisplayableRef = {
    kind: StoryDisplayableTargetKind;
    /** Stage key the compiler registers this object under — what a target ref must carry. */
    name: string;
    /** Author-facing name — the only one safe to render (a stage key can be a character UUID). */
    label: string;
    assetId?: string;
    text?: string;
    /** Id of the creator action block — the stable identity a target binds to. */
    sourceBlockId: string;
};

export function resolveStoryMotionPreviewTarget(input: {
    document: StoryDocument | null | undefined;
    sceneId: StorySceneId | undefined;
    blockId: StoryBlockId | undefined;
    fallbackKind: StoryMotionTargetKind;
    fallbackLabel: string;
    previewAssetId?: string;
}): StoryMotionPreviewTarget {
    return withPreviewAsset(resolveTargetWithoutPreview(input), input.previewAssetId);
}

function resolveTargetWithoutPreview(input: {
    document: StoryDocument | null | undefined;
    sceneId: StorySceneId | undefined;
    blockId: StoryBlockId | undefined;
    fallbackKind: StoryMotionTargetKind;
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
    // Resolve the target through its stable anchor first so the preview follows renames, then walk
    // backward to inherit the asset from whichever action introduced that displayable.
    const resolvedRef = resolveDisplayableTargetRef(scene, block.payload.target);
    const resolvedDirect: StoryMotionPreviewTarget = {
        kind: resolvedRef.kind ?? "image",
        label: resolvedRef.label || "Displayable",
    };
    return {
        ...fallback,
        ...resolveDisplayableFromScene(scene, input.blockId, resolvedDirect),
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
    // Creator actions label themselves through the shared identity rule, so the label matching in
    // `resolveDisplayableFromScene` lines up with what a resolved target reports.
    const identity = displayableSourceIdentity(block);
    if (payload.action === "character") {
        return {
            kind: "character",
            label: identity?.label ?? "Character",
            assetId: payload.assetId,
            // The compiler always shows characters with autoFit enabled.
            autoFit: true,
        };
    }
    if (payload.action === "image") {
        return {
            kind: "image",
            label: identity?.label ?? "Image",
            assetId: payload.assetId,
            autoFit: payload.autoFit ?? false,
        };
    }
    if (payload.action === "text") {
        return {
            kind: "text",
            label: identity?.label ?? "Text",
            text: payload.text,
            fontSize: payload.fontSize,
            fontColor: payload.fontColor,
        };
    }
    if (payload.action === "layer") {
        return {
            kind: "layer",
            label: identity?.label ?? "Layer",
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
    if (payload.action === "camera") {
        // A camera motion moves the whole frame, so the preview's subject is the stage itself rather
        // than any object standing on it — `StoryMotionStagePreview` draws that as a viewport.
        return {
            kind: "camera",
            label: "Camera",
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

function labelForKind(kind: StoryMotionTargetKind): string {
    if (kind === "character") return "Character";
    if (kind === "text") return "Text";
    if (kind === "layer") return "Layer";
    if (kind === "camera") return "Camera";
    return "Image";
}

/**
 * Collect the named displayables that are in scope *before* a given action block, so the
 * inspector can present them as pick-from-context targets. Walks the scene in execution
 * order up to (but excluding) `blockId`, keyed by kind + case-insensitive name; the most
 * recent asset/text for a name wins so the picker preview matches what is on stage there.
 *
 * Only creator-style actions (character / image / text / layer) and displayable ops that
 * carry an explicit kind contribute — infer-kind displayable references are skipped so a
 * name is never listed under a guessed kind.
 */
export function listSceneDisplayableTargets(
    document: StoryDocument | null | undefined,
    sceneId: StorySceneId | undefined,
    blockId: StoryBlockId | undefined,
): SceneDisplayableRef[] {
    if (!document || !sceneId) {
        return [];
    }
    const scene = document.scenes[sceneId];
    if (!scene) {
        return [];
    }
    const blocks = flattenSceneBlocks(scene);
    const activeIndex = blockId ? blocks.findIndex(block => block.id === blockId) : -1;
    const priorBlocks = activeIndex >= 0 ? blocks.slice(0, activeIndex) : blocks;

    const order: string[] = [];
    const byKey = new Map<string, SceneDisplayableRef>();
    for (const block of priorBlocks) {
        const introduced = displayableRefFromBlock(block);
        if (!introduced) {
            continue;
        }
        const name = introduced.name.trim();
        if (!name) {
            continue;
        }
        const key = `${introduced.kind} ${name.toLowerCase()}`;
        const existing = byKey.get(key);
        if (existing) {
            byKey.set(key, {
                ...existing,
                assetId: introduced.assetId ?? existing.assetId,
                text: introduced.text ?? existing.text,
            });
            continue;
        }
        order.push(key);
        byKey.set(key, { ...introduced, name });
    }
    return order.map(key => byKey.get(key)!);
}

function displayableRefFromBlock(block: StoryBlock): SceneDisplayableRef | null {
    const identity = displayableSourceIdentity(block);
    if (!identity || block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    const assetId = payload.action === "character" || payload.action === "image" ? payload.assetId : undefined;
    const text = payload.action === "text" ? payload.text : undefined;
    return { ...identity, assetId, text, sourceBlockId: block.id };
}
