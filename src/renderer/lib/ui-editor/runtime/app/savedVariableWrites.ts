/**
 * Saved variables of the running playthrough, announced when they change.
 *
 * A screen reads a saved variable through `Get Saved Var`, and a value binding can do the same
 * through a Fn. The writes come from everywhere a playthrough is changed from: a story line setting
 * it, a screen's `Set Saved Var`, a save being loaded, a new game. All of them land in the engine's
 * store, and the engine says so - one change per key that moved, one restore for a whole store put
 * back - so that is where they are heard, rather than at each of the writers.
 *
 * Comments in English per project convention.
 */

import type { StorySavedVariableDefinition } from "@shared/types/story";
import {
    announceBlueprintStateWrite,
    EVERY_SAVED_STATE_KEY,
    savedVariableStateKey,
} from "@/lib/ui-editor/blueprint-runtime/blueprintStateWrites";

/** The part of the engine's store this listens to. */
export type SavedVariableStore = {
    onChange(namespace: string, listener: (change: { key: string }) => void): { cancel(): void };
    onRestore(listener: (restore: unknown) => void): { cancel(): void };
};

/**
 * Announce every saved-variable write the engine reports, by the variable's id, until cancelled.
 *
 * The engine reports a key by the storage key its value lives under; the blueprint names it by id.
 * The compile's own table is the one that maps the two, which is also the table `Get Saved Var`
 * resolves through - so a change is announced under exactly the key the reader recorded.
 */
export function announceSavedVariableWrites(
    store: SavedVariableStore,
    compiled: {
        savedNamespaceName: string;
        savedVariables: Record<string, Pick<StorySavedVariableDefinition, "id" | "storageKey">>;
    },
): { cancel(): void } {
    if (!compiled.savedNamespaceName) {
        return { cancel: () => undefined };
    }
    const idByStorageKey = new Map(
        Object.entries(compiled.savedVariables).map(([id, definition]) => [definition.storageKey, id] as const),
    );
    const change = store.onChange(compiled.savedNamespaceName, ({ key }) => {
        const id = idByStorageKey.get(String(key));
        announceBlueprintStateWrite(id ? savedVariableStateKey(id) : EVERY_SAVED_STATE_KEY);
    });
    const restore = store.onRestore(() => {
        announceBlueprintStateWrite(EVERY_SAVED_STATE_KEY);
    });
    return {
        cancel: () => {
            change.cancel();
            restore.cancel();
        },
    };
}
