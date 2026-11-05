/**
 * Text Effects studio entry: offers the plugin's effects in the dialogue toolbar's effects panel.
 * The runtime entry (runtime.ts) draws them in the game under the same ids.
 *
 * Comments in English per project convention.
 */

import { definePlugin } from "narraleaf-studio/plugin";
import { TEXT_EFFECTS_MESSAGES } from "./messages";
import { SHAKE_EFFECT_ID, SHAKE_PARAMS } from "./shake";

export default definePlugin({
    setup(app) {
        // Labels are getters over one translator, so the panel follows a change of the editor's
        // language without the effect being registered again.
        const tr = app.services.i18n.createTranslator(TEXT_EFFECTS_MESSAGES);
        app.services.inlineTextEffects.register({
            id: SHAKE_EFFECT_ID,
            get label() {
                return tr.t("shake");
            },
            params: [
                {
                    key: "intensity",
                    get label() {
                        return tr.t("intensity");
                    },
                    ...SHAKE_PARAMS.intensity,
                },
                {
                    key: "speed",
                    get label() {
                        return tr.t("speed");
                    },
                    ...SHAKE_PARAMS.speed,
                },
            ],
        });
    },
});
