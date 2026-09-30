/**
 * Menu Bar studio entry.
 *
 * Registers one thing - the side panel the author builds the bar in - and enrols its store in the
 * pass that replaces the project's documents (a restored version, a version view, a thaw), for the
 * reason the Gallery store is enrolled in it: the menu is versioned project content, and a store
 * that kept the pre-restore copy in memory would write it back on the next edit.
 *
 * There is no editor tab. A menu bar is a short ordered list with one row selected at a time, and
 * everything it needs fits the panel - a full tab would be the same controls with more space
 * around them.
 *
 * Comments in English per project convention.
 */

import { Menu } from "lucide-react";
import { PanelPosition, definePlugin } from "narraleaf-studio/plugin";
import { MENU_BAR_MESSAGES } from "./messages";
import { MenuBarPanel } from "./MenuBarPanel";
import { createMenuBarStore } from "./store";

const PLUGIN_ID = "narraleaf.menu-bar";
const PANEL_ID = `${PLUGIN_ID}.panel`;

export default definePlugin({
    async setup(app) {
        const store = createMenuBarStore(app);
        await store.load();
        // One translator, read at render: `.t()` resolves against the LIVE editor locale, and the
        // registration exposes the title as a getter, so a language switch re-titles the panel on
        // the next render with no re-registration.
        const tr = app.services.i18n.createTranslator(MENU_BAR_MESSAGES);

        const unregisterReloader = app.services.workspace.registerReloader(() => store.reload());

        const unregisterPanel = app.services.ui.panels.register({
            id: PANEL_ID,
            get title() {
                return tr.t("title");
            },
            icon: <Menu size={16} />,
            position: PanelPosition.Left,
            component: () => <MenuBarPanel app={app} store={store} />,
            defaultVisible: false,
            order: 650,
        });

        return () => {
            unregisterPanel();
            unregisterReloader();
        };
    },
});
