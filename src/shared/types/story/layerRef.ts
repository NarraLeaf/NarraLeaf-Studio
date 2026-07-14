import type { StoryLayerRef, StoryScene } from "./document";
import { displayableSourceIdentity } from "./displayableTarget";

export type StoryDefaultLayer = "background" | "displayable";

/** The two render layers every NarraLeaf-React scene ships with, in display order. */
export const DEFAULT_LAYER_OPTIONS: { layer: StoryDefaultLayer; label: string; hint: string }[] = [
    { layer: "displayable", label: "Displayable layer", hint: "Default layer (z-index 0)" },
    { layer: "background", label: "Background layer", hint: "Behind everything (z-index -1)" },
];

const DEFAULT_LAYER_LABELS: Record<StoryDefaultLayer, string> = {
    background: "Background layer",
    displayable: "Displayable layer",
};

export type ResolvedStoryLayer =
    | { kind: "default"; layer: StoryDefaultLayer; name: string }
    | { kind: "custom"; name: string; sourceBlockId?: string; resolved: boolean };

/**
 * Resolve a layer reference to the label + kind that should be shown *right now*. A `custom` ref
 * with a stable `sourceBlockId` that still resolves to a `layer` create block reports that block's
 * current name, so the reference follows renames; otherwise the stored `name` is used (legacy
 * documents, or a create block that was deleted — flagged via `resolved: false`). An absent ref is
 * treated as the default displayable layer, matching the runtime default.
 */
export function resolveStoryLayerRef(
    scene: StoryScene | null | undefined,
    ref: StoryLayerRef | undefined,
): ResolvedStoryLayer {
    if (!ref || ref.kind === "default") {
        const layer: StoryDefaultLayer = ref?.kind === "default" ? ref.layer : "displayable";
        return { kind: "default", layer, name: DEFAULT_LAYER_LABELS[layer] };
    }
    if (ref.sourceBlockId) {
        const source = scene?.blocks[ref.sourceBlockId];
        const identity = source ? displayableSourceIdentity(source) : null;
        if (identity && identity.kind === "layer") {
            return { kind: "custom", name: identity.name, sourceBlockId: ref.sourceBlockId, resolved: true };
        }
    }
    return {
        kind: "custom",
        name: ref.name ?? "",
        sourceBlockId: ref.sourceBlockId,
        resolved: false,
    };
}

/**
 * The layer a non-`create` `layer` action operates on: its explicit `target` ref when set, otherwise
 * a legacy `objectName` promoted to an (unbound) custom ref so pre-target documents still resolve to
 * the same name-keyed layer. Absent both, `undefined` — the scene's default displayable layer.
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
