import type { StoryBlock, StoryBlockId, StoryLayerDepth, StoryLayerRef, StoryScene } from "@shared/types/story";
import {
    DEFAULT_STORY_LAYER_DEPTH,
    declaresStageObject,
    isBackgroundLayerDepthRow,
    isStoryLayerDepth,
    listSceneBlocksInDocumentOrder,
    resolveStoryLayerRef,
    storyLayerDepthParallax,
} from "@shared/types/story";

/** What stands on a layer, as the panel names it. */
export type StoryLayerContent =
    | { kind: "object"; name: string }
    | { kind: "character"; characterId: string; name: string }
    | { kind: "sceneBackground" };

/** One layer of a scene, as the layer panel lists it. */
export type StoryLayerPanelEntry = {
    /** Stable across renders: the built-in's name, or the id of the row that creates the layer. */
    key: string;
    kind: "background" | "displayable" | "custom";
    /** A custom layer's name; empty for the built-ins, which the panel names in the interface language. */
    name: string;
    /** The row that creates a custom layer. */
    sourceBlockId?: StoryBlockId;
    /** The row that says how far away the background layer is, when the scene has one. */
    depthRowId?: StoryBlockId;
    zIndex: number;
    depth: StoryLayerDepth;
    /** The characters' layer: what the camera is aimed at, so its depth is not the author's to move. */
    fixed: boolean;
    contents: StoryLayerContent[];
};

export type StoryLayerPanelModel = {
    /** Front to back - the order the stage draws them in, reversed so the nearest is on top. */
    entries: StoryLayerPanelEntry[];
    /**
     * The first pair drawn in an order their depths contradict: `front` is drawn over `back` but sits
     * farther from the camera, so a pan slides the nearer layer behind the farther one.
     */
    conflict: { front: StoryLayerPanelEntry; back: StoryLayerPanelEntry } | null;
};

function layerKeyForRef(scene: StoryScene, ref: StoryLayerRef | undefined): string | null {
    if (!ref || ref.kind === "default") {
        return ref?.kind === "default" && ref.layer === "background" ? "background" : "displayable";
    }
    const resolved = resolveStoryLayerRef(scene, ref);
    return resolved.kind === "custom" && resolved.resolved && resolved.sourceBlockId ? `custom:${resolved.sourceBlockId}` : null;
}

/**
 * Every layer of a scene, in the order the stage draws them, with what stands on each and how far
 * from the camera each sits - read off the rows, which are the only place any of it is kept.
 *
 * The order is the engine's: by z-index, ties broken by the order the layers were made, which is the
 * two built-ins first and then the custom layers as their `create` rows come. So a custom layer at
 * z 0 draws in front of the characters, and one at -1 between them and the background.
 */
export function buildStoryLayerPanel(
    scene: StoryScene | null | undefined,
    characterName: (characterId: string) => string | undefined = () => undefined,
): StoryLayerPanelModel {
    const background: StoryLayerPanelEntry = {
        key: "background",
        kind: "background",
        name: "",
        zIndex: -1,
        depth: DEFAULT_STORY_LAYER_DEPTH,
        fixed: false,
        contents: [],
    };
    const displayable: StoryLayerPanelEntry = {
        key: "displayable",
        kind: "displayable",
        name: "",
        zIndex: 0,
        depth: DEFAULT_STORY_LAYER_DEPTH,
        fixed: true,
        contents: [],
    };
    const made: StoryLayerPanelEntry[] = [background, displayable];
    const byKey = new Map<string, StoryLayerPanelEntry>(made.map(entry => [entry.key, entry]));
    if (!scene) {
        return { entries: [displayable, background], conflict: null };
    }
    const blocks = listSceneBlocksInDocumentOrder(scene, { skipSubtree: block => block.disabled === true });

    for (const block of blocks) {
        if (block.kind !== "action" || block.payload.action !== "layer") {
            continue;
        }
        const payload = block.payload;
        if (payload.operation === "create") {
            const entry: StoryLayerPanelEntry = {
                key: `custom:${block.id}`,
                kind: "custom",
                name: payload.objectName?.trim() ?? "",
                sourceBlockId: block.id,
                zIndex: typeof payload.zIndex === "number" && Number.isFinite(payload.zIndex) ? payload.zIndex : 0,
                depth: payload.depth && isStoryLayerDepth(payload.depth) ? payload.depth : DEFAULT_STORY_LAYER_DEPTH,
                fixed: false,
                contents: [],
            };
            made.push(entry);
            byKey.set(entry.key, entry);
        } else if (isBackgroundLayerDepthRow(block)) {
            background.depthRowId = block.id;
            background.depth = payload.depth && isStoryLayerDepth(payload.depth) ? payload.depth : DEFAULT_STORY_LAYER_DEPTH;
        }
    }

    if (scene.defaultBackgroundAssetId) {
        background.contents.push({ kind: "sceneBackground" });
    }
    const seen = new Set<string>();
    const add = (key: string | null, content: StoryLayerContent, identity: string) => {
        const entry = key ? byKey.get(key) : undefined;
        if (!entry || seen.has(`${entry.key}|${identity}`)) {
            return;
        }
        seen.add(`${entry.key}|${identity}`);
        entry.contents.push(content);
    };
    for (const block of blocks) {
        if (block.kind !== "action") {
            continue;
        }
        const payload = block.payload;
        if (payload.action === "setBackground") {
            if (!background.contents.some(content => content.kind === "sceneBackground")) {
                background.contents.push({ kind: "sceneBackground" });
            }
        } else if ((payload.action === "image" || payload.action === "text") && declaresStageObject(payload)) {
            const name = payload.objectName?.trim();
            if (name) {
                add(layerKeyForRef(scene, payload.layer), { kind: "object", name }, `object:${name.toLowerCase()}`);
            }
        } else if (payload.action === "character" && payload.operation === "enter" && payload.characterId) {
            const name = characterName(payload.characterId) ?? payload.objectName?.trim() ?? payload.characterId;
            add("displayable", { kind: "character", characterId: payload.characterId, name }, `character:${payload.characterId}`);
        }
    }

    // The engine's order: a stable sort by z-index over the order the layers were made.
    const drawn = made
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => a.entry.zIndex - b.entry.zIndex || a.index - b.index)
        .map(item => item.entry);
    const entries = drawn.slice().reverse();
    return { entries, conflict: findDepthConflict(entries) };
}

/** The first pair, front to back, where the one drawn in front is the farther one. */
export function findDepthConflict(entries: readonly StoryLayerPanelEntry[]): StoryLayerPanelModel["conflict"] {
    for (let front = 0; front < entries.length; front += 1) {
        for (let back = front + 1; back < entries.length; back += 1) {
            if (storyLayerDepthParallax(entries[front].depth) < storyLayerDepthParallax(entries[back].depth)) {
                return { front: entries[front], back: entries[back] };
            }
        }
    }
    return null;
}

/** The row edit that puts a layer at a depth, or null when the layer cannot move. */
export function layerDepthEdit(
    scene: StoryScene,
    entry: StoryLayerPanelEntry,
    depth: StoryLayerDepth,
):
    | { kind: "update"; blockId: StoryBlockId; payload: StoryBlock["payload"] }
    | { kind: "insert"; depth: StoryLayerDepth }
    | null {
    if (entry.fixed) {
        return null;
    }
    if (entry.kind === "custom" && entry.sourceBlockId) {
        const block = scene.blocks[entry.sourceBlockId];
        if (block?.kind !== "action" || block.payload.action !== "layer") {
            return null;
        }
        // The default is the absent value, so a layer put back with the camera reads as it always did.
        const { depth: _previous, ...rest } = block.payload;
        void _previous;
        return { kind: "update", blockId: block.id, payload: depth === DEFAULT_STORY_LAYER_DEPTH ? rest : { ...rest, depth } };
    }
    if (entry.kind === "background") {
        if (entry.depthRowId) {
            const block = scene.blocks[entry.depthRowId];
            if (block?.kind !== "action" || block.payload.action !== "layer") {
                return null;
            }
            // The row stays and says so, rather than vanishing from under the author's eyes.
            return { kind: "update", blockId: block.id, payload: { ...block.payload, depth } };
        }
        return depth === DEFAULT_STORY_LAYER_DEPTH ? null : { kind: "insert", depth };
    }
    return null;
}
