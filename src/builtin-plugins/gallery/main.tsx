/**
 * Gallery studio entry.
 *
 * Registers three things against the editor: the authoring surfaces (a side
 * panel and the editor tab it opens), the dynamic dropdown sources that let a
 * blueprint node's inspector list artworks / variants / groups, and the node
 * definitions themselves.
 *
 * The node defs registered here read the *live* panel store, so an author sees
 * their edits in an in-editor preview immediately. The runtime entry registers
 * the same defs against the copy published with the game (see runtime.ts).
 *
 * The names, descriptions and locked title the author writes are offered to the
 * project's translation table (`galleryWords`), so they are translated like the
 * words on the game's interface; the game reads them back in the player's
 * language (`localizeGalleryStore`).
 *
 * The fourth registration is the catalog's place in version control: the store
 * holds a versioned project document in memory, so it re-reads whenever Studio
 * replaces the project's documents. Without it, restoring a past version would
 * leave the gallery showing - and about to save - the catalog from before the
 * restore.
 */

import { Images } from "lucide-react";
import { PanelPosition, definePlugin } from "narraleaf-studio/plugin";
import { disposeAssetUrls } from "./components";
import { GalleryEditorTab } from "./GalleryEditorTab";
import { GalleryPanel } from "./GalleryPanel";
import { createGalleryTranslator, galleryTitle } from "./messages";
import { createGalleryStore } from "./store";
import { createGalleryAgentTools } from "./agentTools";
import { galleryWords } from "./catalog";
import {
    DYNAMIC_OPTIONS_SOURCE,
    GROUP_OPTIONS_SOURCE,
    PLUGIN_ID,
    VARIANT_OPTIONS_SOURCE,
    createGalleryBlueprintNodes,
} from "./nodes";

const PANEL_ID = `${PLUGIN_ID}.panel`;
const EDITOR_TAB_ID = `${PLUGIN_ID}.editor`;

export default definePlugin({
    async setup(app) {
        const store = createGalleryStore(app);
        await store.load();
        // One translator, read at render: `.t()` and `.locale` follow the LIVE editor locale, and both
        // registrations below expose the title as a getter, so a language switch re-titles them on
        // the next render with no re-registration (the same shape the core panel modules use).
        const tr = createGalleryTranslator(app);

        const openEditor = () => app.services.ui.editors.open({
            id: EDITOR_TAB_ID,
            get title() {
                return galleryTitle(tr);
            },
            icon: <Images size={14} />,
            closable: true,
            component: () => <GalleryEditorTab app={app} store={store} />,
        });

        const unregisterReloader = app.services.workspace.registerReloader(() => store.reload());

        const unregisterWords = app.services.localization.registerWords({
            list: () => galleryWords(store.getData()),
            subscribe: listener => store.subscribe(listener),
        });

        const unregisterArtworkOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
            DYNAMIC_OPTIONS_SOURCE,
            () => store.getArtworkOptions(),
        );
        const unregisterVariantOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
            VARIANT_OPTIONS_SOURCE,
            () => store.getVariantOptions(),
        );
        const unregisterGroupOptions = app.services.blueprintNodes.registerDynamicSelectOptionsSource(
            GROUP_OPTIONS_SOURCE,
            () => store.getGroupOptions(),
        );
        // In the editor the catalog is the live panel store; the runtime entry
        // reads the copy published with the game instead.
        app.services.blueprintNodes.registerMany(createGalleryBlueprintNodes(() => store.getData()));

        // The EXTRA page for AI agents connected to Studio: the same store, behind six batch tools.
        // Each write commits once, so the host turns each call into one step of undo. Offering them
        // is an extra: if the host refuses (a manifest it read before this build declared them), the
        // author keeps the Gallery and only agents go without.
        let unregisterAgentTools: () => void | Promise<void> = () => undefined;
        try {
            unregisterAgentTools = app.services.agent.registerTools(createGalleryAgentTools(app, store));
        } catch (error) {
            console.warn("[plugin:narraleaf.gallery] agent tools were not offered:", error);
        }

        const unregisterPanel = app.services.ui.panels.register({
            id: PANEL_ID,
            get title() {
                return galleryTitle(tr);
            },
            icon: <Images size={16} />,
            position: PanelPosition.Left,
            component: () => <GalleryPanel app={app} store={store} onOpenEditor={openEditor} />,
            defaultVisible: false,
            order: 640,
        });

        return () => {
            unregisterPanel();
            unregisterReloader();
            unregisterWords();
            unregisterArtworkOptions();
            unregisterVariantOptions();
            unregisterGroupOptions();
            void unregisterAgentTools();
            // Object URLs outlive React unmounts by design (see components.tsx),
            // so unload is the one place they get released.
            disposeAssetUrls();
        };
    },
});
