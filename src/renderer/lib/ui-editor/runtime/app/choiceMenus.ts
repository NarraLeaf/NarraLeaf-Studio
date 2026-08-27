/**
 * The choice menus a running game has on the stage, and which drawing of the choice surface each
 * one is.
 *
 * A Game UI slot surface is authored once and can be drawn more than once: the engine renders one
 * menu component per menu the scene is showing, so a scene whose concurrent group opens two menus
 * has two drawings of the same surface alive at the same time. Everything the choice slot addresses
 * - the widget runtime keys its option list is written under, the surface state its widgets hold,
 * the blueprint scope its graphs run in, and the runtime `Select Choice` reaches - was keyed by the
 * surface alone, so the second drawing wrote over the first's options and the first to unmount took
 * the survivor's runtime with it.
 *
 * This is the same problem a list row and a component placement have, and the answer is the same
 * one: address the drawing, not the template. What differs is only how the drawing is named, and a
 * menu names itself by **slot** - the lowest position not currently taken.
 *
 * A slot rather than a unique id, for two reasons. It is bounded: menus come and go for the whole
 * length of a playthrough, and a fresh id per menu would leave a scope and a surface store behind
 * for every one of them. And **slot zero carries no suffix at all**, so a game that shows one menu
 * at a time - which is every game until an author writes a concurrent group of them - keeps the
 * exact scope id, widget keys and surface state it has always had.
 */

/** What a mounted choice menu offers the rest of the runtime. */
export type ChoiceSlotRuntime = {
    count: number;
    items: readonly ChoiceSlotItem[];
    choose: (index: number) => void;
};

export type ChoiceSlotItem = {
    text: string;
    index: number;
    disabled: boolean;
    /**
     * The option's voice unit id, or "" when it has no take in any dub language.
     *
     * Put on the item rather than looked up on demand because a blueprint running inside a choice
     * row can only see that row: `Play Choice Voice` reads this field, and without it the row has
     * no handle on the take at all.
     */
    voiceId: string;
};

export type ChoiceMenus = {
    /**
     * The slot this drawing occupies, the lowest one free when it first asks.
     *
     * Keyed by the caller's own id and idempotent, so asking twice for the same drawing - which is
     * what a double-invoked render does - answers with the slot it already holds rather than taking
     * a second one.
     */
    claimSlot(id: string): number;
    /** Give the slot back, and with it whatever runtime was registered under it. */
    release(id: string): void;
    /** Register (or clear) what this drawing offers `Select Choice` and `Get Choice Count`. */
    setRuntime(id: string, runtime: ChoiceSlotRuntime | null): void;
    /**
     * The most recently registered menu still on the stage, for the callers that are not inside one
     * - the skip loop asking whether to stop, and Dev Mode's test controls. A blueprint running
     * *inside* a menu never comes here: its own host API is bound to its own menu.
     */
    current(): ChoiceSlotRuntime | null;
    /**
     * Be told when a menu has registered what it is showing.
     *
     * The one moment a menu's options and the index each of them answers to are both in hand, which
     * is what a plugin watching for a choice wants. A listener here rather than in the slot surface
     * so a host that mounts no Game UI choice slot simply never reports one, instead of reporting an
     * empty menu.
     */
    onShown(listener: (runtime: ChoiceSlotRuntime) => void): () => void;
    /** Forget every menu. For a session ending, where the whole player tree goes at once. */
    clear(): void;
};

export function createChoiceMenus(): ChoiceMenus {
    /** Slot by drawing id, in the order the drawings registered a runtime. */
    const slots = new Map<string, number>();
    const runtimes = new Map<string, ChoiceSlotRuntime>();
    /** Newest last; a drawing appears here only once it has a runtime to offer. */
    let order: string[] = [];
    const shownListeners = new Set<(runtime: ChoiceSlotRuntime) => void>();

    return {
        claimSlot(id: string): number {
            const held = slots.get(id);
            if (held !== undefined) {
                return held;
            }
            const taken = new Set(slots.values());
            let slot = 0;
            while (taken.has(slot)) {
                slot += 1;
            }
            slots.set(id, slot);
            return slot;
        },
        release(id: string): void {
            slots.delete(id);
            runtimes.delete(id);
            order = order.filter(entry => entry !== id);
        },
        setRuntime(id: string, runtime: ChoiceSlotRuntime | null): void {
            order = order.filter(entry => entry !== id);
            if (runtime) {
                runtimes.set(id, runtime);
                order.push(id);
                shownListeners.forEach(listener => listener(runtime));
            } else {
                runtimes.delete(id);
            }
        },
        onShown(listener: (runtime: ChoiceSlotRuntime) => void): () => void {
            shownListeners.add(listener);
            return () => {
                shownListeners.delete(listener);
            };
        },
        current(): ChoiceSlotRuntime | null {
            for (let at = order.length - 1; at >= 0; at -= 1) {
                const runtime = runtimes.get(order[at]);
                if (runtime) {
                    return runtime;
                }
            }
            return null;
        },
        clear(): void {
            slots.clear();
            runtimes.clear();
            order = [];
        },
    };
}
