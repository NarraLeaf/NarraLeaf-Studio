import type { AppearanceSystemCondition } from "@shared/types/ui-editor/appearance";

/** Inputs to appearance resolution: pointer/focus-derived flags plus prop-driven disabled. */
export type SystemInteractionSignals = {
    hovered: boolean;
    active: boolean;
    disabled: boolean;
    focused: boolean;
    /**
     * True for everything inside the row a list has selected.
     *
     * A system signal rather than a semantic variant, for the reason `focused` is one: it is not a
     * meaning a particular widget invents, it is a state the host puts a whole subtree into, and
     * every widget in that subtree may or may not have something to show for it. It also composes -
     * "selected and hovered" is one conditional row, not a second variant.
     */
    selected: boolean;
};

export const DEFAULT_SYSTEM_INTERACTION_SIGNALS: SystemInteractionSignals = {
    hovered: false,
    active: false,
    disabled: false,
    focused: false,
    selected: false,
};

/** A conditional row matches when every specified key equals the current signal value. */
export function conditionMatches(
    conditions: AppearanceSystemCondition | null | undefined,
    signals: SystemInteractionSignals
): boolean {
    if (conditions == null || Object.keys(conditions).length === 0) {
        return true;
    }
    const c = conditions as Record<string, boolean | undefined>;
    for (const key of Object.keys(c)) {
        const expected = c[key];
        if (expected === undefined) {
            continue;
        }
        const sig = signals[key as keyof SystemInteractionSignals];
        if (sig !== expected) {
            return false;
        }
    }
    return true;
}
