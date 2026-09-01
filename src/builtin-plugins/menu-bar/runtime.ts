/**
 * Menu Bar runtime entry: publish the authored menu to the game that draws it.
 *
 * All this does is hand the tree over. What each row *means* is the game's (see the runtime's own
 * `gameMenu`), what it looks like is the shell's, and what it *says* is the project's - each label
 * carries a localization key, and the game resolves it against the project's own tables on every
 * redraw. So this publishes once, at setup, and never has to publish again: a language change
 * re-reads the same keys on the far side.
 *
 * Comments in English per project convention.
 */

import { defineRuntimePlugin } from "narraleaf-studio/runtime";
import { MENU_BAR_STORE_NAMESPACE, normalizeMenuBarDocument, toGameMenuSpec } from "./document";

export default defineRuntimePlugin({
    setup(app) {
        const menu = app.game.menu;
        if (!menu) {
            // Every shell without a bar: the web export, and Studio's own Dev Mode window. Not a
            // failure and not worth a warning - a game that runs in a page simply has nowhere to
            // put one, and the same build has to run in both places.
            return;
        }
        const stored = app.game.data.readJson(MENU_BAR_STORE_NAMESPACE);
        if (!stored) {
            // A project that never opened the panel publishes no document. Nothing to draw, and
            // nothing to say about it: the absence IS the author's answer.
            return;
        }
        const spec = toGameMenuSpec(normalizeMenuBarDocument(stored));
        // Held by the host until the game app is up (setup runs during boot, ahead of it), so this
        // is the only publish a launch needs.
        void menu.set(spec).catch((error: unknown) => {
            app.game.log("warning", `Menu bar was not published: ${describe(error)}`);
        });
    },
});

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
