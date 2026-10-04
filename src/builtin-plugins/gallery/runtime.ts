/**
 * Gallery runtime entry: registers the blueprint node execute bindings in
 * game execution environments (Dev Mode window, Preview, Production), and
 * collects the entries the player reaches, hears and is spoken to.
 *
 * Editor palette metadata stays owned by the studio entry (main.tsx).
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import {
    GALLERY_STORE_NAMESPACE,
    collectAudioAssetVariantIds,
    collectSceneVariantIds,
    collectVoiceUnitVariantIds,
    normalizeGalleryStore,
    type GalleryArtwork,
} from "./catalog";
import { createGalleryBlueprintNodes } from "./nodes";
import { updateUnlockRecord } from "./unlockRecord";

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
         * Three of the four columns collect themselves as the player plays.
         *
         * A recollection is collected on reaching its scene, a track on being played, a voice line
         * on being spoken. CG entries have no such moment - nothing says which picture counts as
         * seen - so they stay on an explicit Unlock Gallery in the story. Worth telling authors, or
         * the inconsistency reads as a bug; the editor's idle inspector says it per column.
         *
         * Every source here is an *execution* signal: a remount, a rollback or a replay fires it
         * again. That is harmless because collecting is an idempotent set insert, and the write is
         * skipped when the set did not move - which keeps a write per signal off the disk on every
         * scene transition and every line of dialogue.
         *
         * Collecting runs in turn with the lock/unlock nodes (see `unlockRecord.ts`): a scene whose
         * entry graph unlocks a CG fires both at once, and neither may write over the other.
         */
        const events = app.game.events;
        const store = app.game.store;
        if (!events || !store) {
            return;
        }

        const collect = (
            what: string,
            pick: (items: GalleryArtwork[]) => string[],
        ): void => {
            void (async () => {
                try {
                    const data = normalizeGalleryStore(readCatalog());
                    const reached = pick(data.items);
                    if (reached.length === 0) {
                        return;
                    }
                    await updateUnlockRecord(store, data.items, unlocked => {
                        for (const id of reached) {
                            unlocked.add(id);
                        }
                    });
                } catch (error) {
                    app.game.log(
                        "warning",
                        `gallery: could not collect ${what}: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            })();
        };

        events.on("sceneEnter", ({ sceneId }) => {
            if (sceneId) {
                collect("a recollection", items => collectSceneVariantIds(items, sceneId));
            }
        });

        // Covers a `/bgm` row, a `/sound` row and a scene whose configured music starts with the
        // mount. A clip a Page starts through Play Sound is interface sound and is not reported
        // here, so a button click cannot collect a track.
        events.on("audioPlayed", ({ assetId }) => {
            if (assetId) {
                collect("a track", items => collectAudioAssetVariantIds(items, assetId));
            }
        });

        // The unit id a voice entry carries is the line's text id, so the line the player just
        // finished names the entry directly.
        events.on("dialogueEnd", ({ textId }) => {
            if (textId) {
                collect("a voice line", items => collectVoiceUnitVariantIds(items, textId));
            }
        });
    },
});
