/**
 * Gallery runtime entry: registers the blueprint node execute bindings in
 * game execution environments (Dev Mode window, Preview, Production).
 * Editor palette metadata stays owned by the studio entry (main.tsx).
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { GALLERY_STORE_NAMESPACE } from "./catalog";
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
    },
});
