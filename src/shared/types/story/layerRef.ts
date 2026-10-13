import type { StoryLayerRef, StoryScene } from "./document";
import { findSceneLayer, findSceneLayerByName } from "./sceneLayers";

export type StoryDefaultLayer = "background" | "displayable";

const DEFAULT_LAYER_LABELS: Record<StoryDefaultLayer, string> = {
    background: "Background layer",
    displayable: "Displayable layer",
};

export type ResolvedStoryLayer =
    | { kind: "default"; layer: StoryDefaultLayer; name: string }
    | { kind: "custom"; name: string; sourceBlockId?: string; resolved: boolean };

/**
 * Resolve a layer reference to the label + kind that should be shown *right now*. A `custom` ref
 * reports the scene layer it is bound to by id - so the reference follows renames - and failing that
 * the scene layer its stored `name` names; one that matches neither is flagged `resolved: false` (a
 * layer since removed from the scene). An absent ref is treated as the default displayable layer,
 * matching the runtime default.
 */
export function resolveStoryLayerRef(
    scene: Pick<StoryScene, "layers"> | null | undefined,
    ref: StoryLayerRef | undefined,
): ResolvedStoryLayer {
    if (!ref || ref.kind === "default") {
        const layer: StoryDefaultLayer = ref?.kind === "default" ? ref.layer : "displayable";
        return { kind: "default", layer, name: DEFAULT_LAYER_LABELS[layer] };
    }
    const bound = (ref.sourceBlockId ? findSceneLayer(scene, ref.sourceBlockId) : undefined)
        ?? (ref.name?.trim() ? findSceneLayerByName(scene, ref.name) : undefined);
    if (bound) {
        return { kind: "custom", name: bound.name, sourceBlockId: bound.id, resolved: true };
    }
    return {
        kind: "custom",
        name: ref.name ?? "",
        sourceBlockId: ref.sourceBlockId,
        resolved: false,
    };
}

/**
 * The layer a `layer` row acts on: its explicit `target` ref when set, otherwise a legacy
 * `objectName` promoted to an (unbound) custom ref so pre-target documents still resolve to the same
 * name-keyed layer. Absent both, `undefined` - the scene's default displayable layer.
 */
export function layerActionTargetRef(
    target: StoryLayerRef | undefined,
    objectName: string | undefined,
): StoryLayerRef | undefined {
    if (target) {
        return target;
    }
    const name = objectName?.trim();
    return name ? { kind: "custom", name } : undefined;
}
