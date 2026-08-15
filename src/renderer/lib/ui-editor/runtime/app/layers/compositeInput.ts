/**
 * Input ownership across everything on screen at once.
 *
 * The composite reads bottom to top: the page lane occupies a single slot (however many entries are
 * mid-transition inside it), and the layer stack sits above it in mount order. Two questions come out
 * of it, and they are not the same question - which is why the single `active` flag the surface layer
 * used to derive both from had to be split in two.
 */

/** The page-lane entries currently mounted. Only their keys matter here. */
export type CompositeInputPageEntry = {
    key: string;
};

/** A stacked layer, bottom to top. Only its key and whether it is modal matter here. */
export type CompositeInputLayer = {
    key: string;
    modal: boolean;
};

export type CompositeInputState = {
    pageEntries: readonly CompositeInputPageEntry[];
    /** The entry the page lane is settling on - the top of its own stack, not of the composite. */
    activePageKey: string | null;
    layers: readonly CompositeInputLayer[];
};

export type CompositeInputResolution = {
    /**
     * Everything that takes pointer input this frame. A subset of the keys handed in, so a caller can
     * ask about any mounted entry and get an answer that is about that entry.
     */
    interactiveKeys: ReadonlySet<string>;
    /**
     * The one entry keyboard events belong to, or none.
     *
     * Names the page lane's active entry even in the frames where that entry is not mounted (a
     * transition that empties the lane while the incoming page prepaints). Ownership is a fact about
     * the stack, not about what has finished painting; readiness is a separate gate and the page lane
     * already applies its own.
     */
    keyboardOwnerKey: string | null;
};

/**
 * Resolve who can be clicked and who the keys go to.
 *
 * **Interactive** is a set. The topmost modal layer is a floor: everything below it - the whole page
 * lane included - goes inert, and it and everything above it stay live. With no modal layer there is
 * no floor, and the page lane keeps the rule it has always had: only the entry the stack is settling
 * on takes input, so a page still animating out does not, and neither does one held behind an
 * arriving page.
 *
 * **Keyboard owner** is exactly one, or none. It is the topmost modal layer; with no modal layer it
 * falls back to the page lane's active entry, which is what it was before layers existed.
 *
 * The topmost MODAL layer, not the topmost layer. With a modal below a non-modal both are clickable -
 * nothing above the floor is inert - and the keys still belong to the modal underneath. Reading it as
 * "the top layer" would hand the keys to a passive layer that never asked for them, and would take
 * them away from the one thing on screen that declared it wanted them.
 */
export function resolveCompositeInput(input: CompositeInputState): CompositeInputResolution {
    let topModalIndex = -1;
    for (let index = 0; index < input.layers.length; index++) {
        if (input.layers[index]!.modal) {
            topModalIndex = index;
        }
    }

    const interactiveKeys = new Set<string>();
    const activePageKey = input.activePageKey;
    if (
        topModalIndex < 0 &&
        activePageKey !== null &&
        input.pageEntries.some(entry => entry.key === activePageKey)
    ) {
        interactiveKeys.add(activePageKey);
    }
    for (let index = Math.max(topModalIndex, 0); index < input.layers.length; index++) {
        interactiveKeys.add(input.layers[index]!.key);
    }

    return {
        interactiveKeys,
        keyboardOwnerKey: topModalIndex >= 0 ? input.layers[topModalIndex]!.key : activePageKey,
    };
}
