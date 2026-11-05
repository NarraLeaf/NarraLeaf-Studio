/**
 * Text Effects runtime entry: draws the runs of dialogue the author set one of the plugin's effects
 * on, in every game execution environment (Dev Mode window, Preview, Production).
 *
 * Comments in English per project convention.
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { SHAKE_EFFECT_ID, ShakeText } from "./shake";

export default defineRuntimePlugin({
    setup(app) {
        app.game.inlineTextEffects.register({ id: SHAKE_EFFECT_ID, render: ShakeText });
    },
});
