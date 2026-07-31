/**
 * Gallery runtime entry: registers the blueprint node execute bindings in
 * game execution environments (Dev Mode window, Preview, Production), and
 * auto-unlocks recollections as the player reaches them.
 *
 * Editor palette metadata stays owned by the studio entry (main.tsx).
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import {
    GALLERY_STORE_NAMESPACE,
    RUNTIME_UNLOCKED_KEY,
    normalizeGalleryStore,
    readUnlockedVariantIds,
} from "./catalog";
import { createGalleryBlueprintNodes } from "./nodes";

export default defineRuntimePlugin({
    setup(app) {
        let warned = false;
        // The catalog is authored in the studio panel and published with the
        // game via contributes.runtimeData. Read lazily per node execution so a
        // Dev Mode session picks up edits on reload rather than caching a
        // snapshot taken at setup time.
        const readCatalog = () => {
            const data = app.game.data.readJson(GALLERY_STORE_NAMESPACE);
            if (!data && !warned) {
                warned = true;
                // Not fatal: a project that never opened the Gallery panel has
                // no catalog, and every node degrades to an empty gallery.
                app.game.log("warning", "No gallery catalog was published with this game.");
            }
            return data;
        };
        app.game.blueprintNodes.registerMany(createGalleryBlueprintNodes(readCatalog));

        /**
         * Recollections unlock themselves when the player reaches the scene.
         *
         * This is the only column that can: there is no "this image was shown"
         * or "this clip was played" event, so CG and music entries still need an
         * explicit Unlock Gallery in the story. Worth telling authors, or the
         * inconsistency reads as a bug.
         *
         * `sceneEnter` is a *rendering* event - a remount fires it again - which
         * is harmless here because unlocking is an idempotent set insert.
         */
        const events = app.game.events;
        const store = app.game.store;
        if (!events || !store) {
            return;
        }
        events.on("sceneEnter", ({ sceneId }) => {
            if (!sceneId) {
                return;
            }
            void (async () => {
                try {
                    const data = normalizeGalleryStore(readCatalog());
                    const reached = data.items.filter(item =>
                        item.kind === "scene" && item.scene?.sceneId === sceneId);
                    if (reached.length === 0) {
                        return;
                    }
                    const unlocked = readUnlockedVariantIds(
                        await store.get(RUNTIME_UNLOCKED_KEY),
                        data.items,
                    );
                    const before = unlocked.size;
                    for (const entry of reached) {
                        for (const variant of entry.variants) {
                            unlocked.add(variant.id);
                        }
                    }
                    // Only write when something changed: sceneEnter fires on
                    // every remount, and a persistence write per remount is a
                    // needless disk hit on every scene transition.
                    if (unlocked.size !== before) {
                        await store.set(RUNTIME_UNLOCKED_KEY, Array.from(unlocked));
                    }
                } catch (error) {
                    app.game.log(
                        "warning",
                        `gallery: could not auto-unlock a recollection: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            })();
        });
    },
});
