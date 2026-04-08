import type { AppearanceFieldTransition, AppearancePropertyKey } from "@shared/types/ui-editor/appearance";

export function firstTransitionForKeys(
    transitions: Partial<Record<AppearancePropertyKey, AppearanceFieldTransition>>,
    keys: AppearancePropertyKey[]
): AppearanceFieldTransition | null {
    for (const key of keys) {
        const transition = transitions[key];
        if (transition) {
            return transition;
        }
    }
    return null;
}
