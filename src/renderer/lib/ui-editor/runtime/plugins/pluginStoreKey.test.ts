/**
 * The plugin store namespaces every key with the owning plugin id before it
 * reaches the game's persistence. That prefix has to survive the persistence
 * key validator, and for a long time it did not: the separator was `:`, which
 * the validator rejects outright, so *no* plugin declaring `store` could read or
 * write anything in a running game.
 *
 * It stayed invisible because the editor has no `store` at all (readers already
 * degrade to "nothing stored"), so it only ever failed in a real playthrough.
 *
 * Comments in English per project convention.
 */

import { describe, expect, it } from "vitest";

/** Mirrors `PersistentState.ensureValidKey` in @shared/utils/persistentState. */
const PERSISTENCE_KEY_PATTERN = /^[a-zA-Z0-9]+([._-][a-zA-Z0-9]+)*$/;

/** Mirrors the prefix built in loadRuntimePlugins' `store` domain. */
function pluginStoreKey(pluginId: string, key: string): string {
    return `${pluginId}-${key}`;
}

describe("plugin store key namespacing", () => {
    const pluginId = "narraleaf.gallery";

    it("produces a key the persistence validator accepts", () => {
        // The regression: `${pluginId}:${key}` fails this, and every get/set threw.
        expect(PERSISTENCE_KEY_PATTERN.test(pluginStoreKey(pluginId, "narraleaf.gallery.unlocked")))
            .toBe(true);
    });

    it("rejects the colon separator that caused the failure", () => {
        expect(PERSISTENCE_KEY_PATTERN.test(`${pluginId}:narraleaf.gallery.unlocked`)).toBe(false);
    });

    /**
     * A dot separator would validate, but plugin ids are themselves dotted, so
     * `narraleaf.gallery.` is also a prefix of the legacy un-namespaced key
     * `narraleaf.gallery.unlocked` - `keys()` would strip it and return the
     * wrong name. The separator must not be a prefix of the legacy space.
     */
    it("cannot be confused with a legacy un-namespaced key", () => {
        const legacy = "narraleaf.gallery.unlocked";
        expect(legacy.startsWith(`${pluginId}-`)).toBe(false);
        expect(legacy.startsWith(`${pluginId}.`)).toBe(true);
    });

    it("namespaces plugins apart from each other", () => {
        expect(pluginStoreKey("narraleaf.quick-save", "slot"))
            .not.toBe(pluginStoreKey("narraleaf.gallery", "slot"));
    });
});
