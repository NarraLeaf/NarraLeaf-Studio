/**
 * Quick Save studio entry: registers the blueprint node palette metadata and
 * in-editor preview execution. Game-side execute bindings live in runtime.ts.
 */

import { definePlugin } from "narraleaf-studio/plugin";
import { createQuickSaveBlueprintNodes } from "./nodes";

export default definePlugin({
    setup(app) {
        app.services.blueprintNodes.registerMany(createQuickSaveBlueprintNodes());
    },
});
