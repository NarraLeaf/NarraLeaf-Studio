/**
 * Gallery runtime entry: registers the blueprint node execute bindings in
 * game execution environments (Dev Mode window, Preview, Production).
 * Editor palette metadata stays owned by the studio entry (main.tsx).
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { createGalleryBlueprintNodes } from "./nodes";

export default defineRuntimePlugin({
    setup(app) {
        app.game.blueprintNodes.registerMany(createGalleryBlueprintNodes());
    },
});
