import type {
    StoryBlock,
    StoryBlockId,
    StoryDisplayableTargetKind,
    StoryDocument,
    StoryMotionTargetKind,
    StoryScene,
    StorySceneId,
} from "@shared/types/story";
import { declaresStageObject, displayableCreatorIdentity, displayableSourceIdentity, normalizeStageObjectName, resolveDisplayableTargetRef, sceneLayerStack } from "@shared/types/story";

export type StoryMotionPreviewTarget = {
    kind: StoryMotionTargetKind;
    label: string;
    assetId?: string;
    text?: string;
    fontSize?: number;
    fontColor?: string;
    /** Whether the runtime fits this displayable to the stage width. */
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
        if ((block.payload.action === "image" || block.payload.action === "text" || block.payload.action === "character")
            && !declaresStageObject(block.payload)) {
            const identity = targetIdentityInScene(scene, block);
            if (identity) {
                return { ...fallback, ...resolveDisplayableFromScene(scene, input.blockId, { kind: identity.kind, label: identity.label }, identity.name) };
            }
        }
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
        ...resolveDisplayableFromScene(scene, input.blockId, resolvedDirect, resolvedRef.name),
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
            // A sprite is drawn at its own pixels in design space: `autoFit` is the rule for a
            // picture that covers the stage, and a character is not one.
            autoFit: false,
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

/**
 * The displayable a row names, with whatever the action that introduced it says about it.
 *
 * Walk backward from the row: the nearest action that writes each field wins, and the declaring
 * action supplies the remaining fields. Layers are declared by the scene rather than a row.
 *
 * This runs once per mounted transform or show/hide row, so its cost is paid on every frame of a
 * scroll. It used to flatten the whole scene and scan every row above this one, allocating a target
 * for each: on a seven-thousand-line chapter that was most of what a scroll through those rows did.
 * The walk is now as long as the distance back to the creator - a few rows in practice.
 */
function resolveDisplayableFromScene(
    scene: StoryScene,
    blockId: StoryBlockId,
    requested: StoryMotionPreviewTarget,
    requestedName: string,
): StoryMotionPreviewTarget {
    const resolved: Record<string, unknown> = { ...requested };
    const said = new Set<string>();
    const actions = ACTIONS_TARGETING_KIND[requested.kind];
    const wantedName = stageNameKey(requestedName);
    const visit = (block: StoryBlock) => {
        // Most of what the walk passes is dialogue, unrelated actions and moves of OTHER objects,
        // and on a long scene it passes thousands of them: rule those out before building a target.
        if (block.kind !== "action" || !actions.has(block.payload.action)) {
            return false;
        }
        const identity = targetIdentityInScene(scene, block);
        if (!identity || identity.kind !== requested.kind || stageNameKey(identity.name) !== wantedName) {
            return false;
        }
        if (!said.has("label")) {
            said.add("label");
            resolved.label = identity.label;
        }
        const payload = block.payload;
        const declares = declaresStageObject(payload);
        const target = previewTargetFromBlock(block);
        for (const [key, value] of Object.entries(target ?? {})) {
            if (key === "kind" || key === "label" || (!declares && value === undefined)) {
                continue;
            }
            // Fit is set when an image is declared; source and text/font operations change only
            // their own fields and leave the other properties of the displayable in place.
            if (key === "autoFit" && !declares) {
                continue;
            }
            if (!said.has(key)) {
                said.add(key);
                resolved[key] = value;
            }
        }
        return declares;
    };
    const reachable = walkBlocksBefore(scene, blockId, visit);
    if (!reachable) {
        // An unreachable row has no position in the scene, so every reachable row precedes it.
        for (const block of flattenSceneBlocks(scene).reverse()) {
            if (visit(block)) break;
        }
    }
    return resolved as StoryMotionPreviewTarget;
}

/** The actions whose target can be of each kind - see `previewTargetFromBlock`. */
const ACTIONS_TARGETING_KIND: Record<StoryMotionTargetKind, ReadonlySet<string>> = {
    image: new Set(["image", "displayable"]),
    character: new Set(["character", "displayable"]),
    text: new Set(["text", "displayable"]),
    layer: new Set(["layer", "nvl", "displayable"]),
    camera: new Set(["camera", "displayable"]),
};

/**
 * Visit the blocks that run before `blockId`, nearest first - execution order (a depth-first
 * pre-order walk from the roots) read backwards, without building it - until `visit` returns true.
 *
 * A plain loop rather than a generator: the walk can pass every row of a long scene (a transform on
 * a background has no creator above it to stop at), and a generator step costs several times what
 * the check it feeds does.
 *
 * Returns false, having visited nothing, when the block cannot be reached from the roots.
 */
function walkBlocksBefore(scene: StoryScene, blockId: StoryBlockId, visit: (block: StoryBlock) => boolean): boolean {
    const chain: StoryBlock[] = [];
    let current = scene.blocks[blockId];
    while (current) {
        if (chain.length > 0 && chain.includes(current)) {
            return false;
        }
        chain.push(current);
        if (current.parentId == null) {
            break;
        }
        current = scene.blocks[current.parentId];
    }
    const top = chain[chain.length - 1];
    if (!top || top.parentId != null) {
        return false;
    }
    // Each level's position among its siblings, found once: on a flat scene the roots are the whole
    // scene, and this is the one scan of them the walk needs.
    const positions: number[] = [];
    for (let level = 0; level < chain.length; level += 1) {
        const parent = level + 1 < chain.length ? chain[level + 1]! : null;
        const position = (parent ? parent.childrenIds : scene.rootBlockIds).indexOf(chain[level]!.id);
        if (position < 0) {
            return false;
        }
        positions.push(position);
    }
    for (let level = 0; level < chain.length; level += 1) {
        const parent = level + 1 < chain.length ? chain[level + 1]! : null;
        const siblings = parent ? parent.childrenIds : scene.rootBlockIds;
        for (let index = positions[level]! - 1; index >= 0; index -= 1) {
            const sibling = scene.blocks[siblings[index]!];
            if (sibling && visitSubtreeBackward(scene, sibling, visit)) {
                return true;
            }
        }
        if (parent && visit(parent)) {
            return true;
        }
    }
    return true;
}

/** One block and everything under it in reverse execution order; true once `visit` asks to stop. */
function visitSubtreeBackward(scene: StoryScene, block: StoryBlock, visit: (block: StoryBlock) => boolean): boolean {
    for (let index = block.childrenIds.length - 1; index >= 0; index -= 1) {
        const child = scene.blocks[block.childrenIds[index]!];
        if (child && visitSubtreeBackward(scene, child, visit)) {
            return true;
        }
    }
    return visit(block);
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

function stageNameKey(name: string): string {
    return name.trim();
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
 * order up to (but excluding) `blockId`, keyed by kind and stage name; the most
 * recent asset/text for a name wins so the picker preview matches what is on stage there.
 *
 * Image, character and text declarations contribute entries; later operations refresh their
 * content. Custom layers come from the scene's layer stack.
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
    return scene ? listDisplayableTargetsInScene(scene, blockId) : [];
}

/**
 * {@link listSceneDisplayableTargets} for a scene the caller already holds.
 *
 * For a caller whose scene is not (yet) the one the document carries - the story command line's
 * second reading of a `.story` file, whose scene holds the rows the file is adding - so a name the
 * file declares above a row resolves on that row, as it does once the file is applied.
 */
export function listDisplayableTargetsInScene(scene: StoryScene, blockId: StoryBlockId | undefined): SceneDisplayableRef[] {
    const blocks = flattenSceneBlocks(scene);
    const activeIndex = blockId ? blocks.findIndex(block => block.id === blockId) : -1;
    const priorBlocks = activeIndex >= 0 ? blocks.slice(0, activeIndex) : blocks;

    const order: string[] = [];
    const byKey = new Map<string, SceneDisplayableRef>();
    // The scene's own layers come first and are there for every row: the scene puts them up before
    // its first row runs. Front to back, the order the stack lists them in.
    for (const layer of sceneLayerStack(scene)) {
        const name = layer.kind === "custom" ? layer.name.trim() : "";
        if (layer.kind !== "custom" || !name) {
            continue;
        }
        const key = `layer\u0000${name}`;
        if (!byKey.has(key)) {
            order.push(key);
            byKey.set(key, { kind: "layer", name: normalizeStageObjectName(name), label: name, sourceBlockId: layer.id });
        }
    }
    for (const block of priorBlocks) {
        if (block.kind !== "action") {
            continue;
        }
        const creator = displayableCreatorIdentity(block);
        const identity = creator ?? targetIdentityInScene(scene, block);
        if (!identity) continue;
        const name = identity.name.trim();
        if (!name) {
            continue;
        }
        const key = `${identity.kind}\u0000${name}`;
        const existing = byKey.get(key);
        const payload = block.payload;
        const assetId = payload.action === "character" || payload.action === "image" ? payload.assetId : undefined;
        const text = payload.action === "text" ? payload.text : undefined;
        if (existing) {
            byKey.set(key, {
                ...existing,
                assetId: assetId ?? existing.assetId,
                text: text ?? existing.text,
            });
            continue;
        }
        if (!creator) continue;
        order.push(key);
        byKey.set(key, { ...creator, name, assetId, text, sourceBlockId: block.id });
    }
    return order.map(key => byKey.get(key)!);
}

function targetIdentityInScene(scene: StoryScene, block: StoryBlock): { kind: StoryDisplayableTargetKind; name: string; label: string } | null {
    if (block.kind !== "action") {
        return null;
    }
    const payload = block.payload;
    if (payload.action === "displayable") {
        const resolved = resolveDisplayableTargetRef(scene, payload.target);
        return { ...resolved, kind: resolved.kind ?? "image" };
    }
    if ((payload.action === "image" || payload.action === "text") && payload.target && !declaresStageObject(payload)) {
        const resolved = resolveDisplayableTargetRef(scene, payload.target);
        return { ...resolved, kind: payload.action };
    }
    return displayableSourceIdentity(block);
}
