import type { AppearanceFieldTransition, AppearancePropertyKey } from "@shared/types/ui-editor/appearance";

export function firstTransitionForKeys<K extends AppearancePropertyKey>(
    transitions: Partial<Record<K, AppearanceFieldTransition>>,
    keys: K[]
): AppearanceFieldTransition | null {
    for (const key of keys) {
        const transition = transitions[key];
        if (transition) {
            return transition;
        }
    }
    return null;
}
