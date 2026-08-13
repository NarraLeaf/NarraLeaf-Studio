import type {
    GameAppCompositeLayer,
    GameAppCompositeQueuedLayer,
    GameAppCompositeSlot,
    GameAppCompositeView,
} from "@/lib/ui-editor/runtime/app/GameAppHost";

/** What every row of the panel carries, whatever slot it describes. */
type CompositeStackRowBase = {
    key: string;
    /**
     * The trailing segment of the key.
     *
     * The whole key is a scope id and reads as one; what a reader needs off it is the part that
     * tells two mounts of the same surface apart, which is the counter at the end.
     */
    keyTail: string;
    /** The surface's name, or its bare id when this project has no surface with that id. */
    label: string;
    /** True when {@link label} had to fall back to the id. */
    surfaceMissing: boolean;
};

export type CompositeStackPageRow = CompositeStackRowBase & {
    kind: "page";
    interactive: boolean;
    keyboardOwner: boolean;
};

export type CompositeStackLayerRow = CompositeStackRowBase & {
    kind: "layer";
    interactive: boolean;
    keyboardOwner: boolean;
    modal: boolean;
    dismissible: boolean;
    group: string | null;
    /** Whoever showed it, named the way its own row is named. Null when it reports no owner. */
    owner: string | null;
    /** False for a layer the stack holds and the screen does not have. */
    onScreen: boolean;
};

export type CompositeStackQueuedRow = CompositeStackRowBase & {
    kind: "queued";
    modal: boolean;
    group: string | null;
    owner: string | null;
};

export type CompositeStackView = {
    /** Bottom to top: the page lane, then every layer in mount order. */
    rows: readonly (CompositeStackPageRow | CompositeStackLayerRow)[];
    /** Layers waiting for their group, in arrival order. */
    queued: readonly CompositeStackQueuedRow[];
    /** How many layers the stack holds, and how many of them the screen has. */
    layerCount: number;
    onScreenCount: number;
    exitPending: boolean;
};

function keyTailOf(key: string): string {
    const segments = key.split(":");
    return segments[segments.length - 1] ?? key;
}

function labelOf(slot: { surfaceId: string; surfaceName: string | null }): string {
    return slot.surfaceName ?? slot.surfaceId;
}

/**
 * Read the composite stack as a list.
 *
 * Every input-ownership answer here is copied from the composite, never worked out again: this
 * panel exists to report the one arbitration the running app made, and a second opinion computed
 * beside it would agree until exactly the frame someone opened the panel to explain.
 *
 * The order is bottom to top, which is the order the screen stacks them in and the order the
 * ownership rules read in - the topmost modal is the floor everything below it goes inert under.
 */
export function buildCompositeStackView(composite: GameAppCompositeView): CompositeStackView {
    // Owners are named by their own row wherever the stack still holds them, so "shown by" points at
    // something visible in the same list instead of at a raw scope id. A scope that has since closed,
    // or one that belongs to a nested surface inside a page, keeps its id: it is still the answer to
    // "who showed this", and inventing a friendlier name for it would be inventing a fact.
    const namesByKey = new Map<string, string>();
    const remember = (slot: GameAppCompositeSlot | GameAppCompositeLayer | null): void => {
        if (slot) {
            namesByKey.set(slot.key, labelOf(slot));
        }
    };
    remember(composite.page);
    composite.layers.forEach(remember);

    const ownerOf = (ownerScopeId: string): string | null => {
        if (!ownerScopeId) {
            return null;
        }
        return namesByKey.get(ownerScopeId) ?? ownerScopeId;
    };

    const rows: (CompositeStackPageRow | CompositeStackLayerRow)[] = [];
    if (composite.page) {
        rows.push({
            kind: "page",
            key: composite.page.key,
            keyTail: keyTailOf(composite.page.key),
            label: labelOf(composite.page),
            surfaceMissing: composite.page.surfaceName === null,
            interactive: composite.page.interactive,
            keyboardOwner: composite.page.keyboardOwner,
        });
    }
    for (const layer of composite.layers) {
        rows.push({
            kind: "layer",
            key: layer.key,
            keyTail: keyTailOf(layer.key),
            label: labelOf(layer),
            surfaceMissing: layer.surfaceName === null,
            interactive: layer.interactive,
            keyboardOwner: layer.keyboardOwner,
            modal: layer.modal,
            dismissible: layer.dismissible,
            group: layer.group,
            owner: ownerOf(layer.ownerScopeId),
            onScreen: layer.onScreen,
        });
    }

    const queued: CompositeStackQueuedRow[] = composite.queued.map((layer: GameAppCompositeQueuedLayer) => ({
        kind: "queued",
        key: layer.key,
        keyTail: keyTailOf(layer.key),
        label: labelOf(layer),
        surfaceMissing: layer.surfaceName === null,
        modal: layer.modal,
        group: layer.group,
        owner: ownerOf(layer.ownerScopeId),
    }));

    return {
        rows,
        queued,
        layerCount: composite.layers.length,
        onScreenCount: composite.layers.filter(layer => layer.onScreen).length,
        exitPending: composite.exitPending,
    };
}
