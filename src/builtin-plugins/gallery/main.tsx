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
import { createGalleryStore } from "./store";
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

        const openEditor = () => app.services.ui.editors.open({
            id: EDITOR_TAB_ID,
            title: "Gallery",
            icon: <Images size={14} />,
            closable: true,
            component: () => <GalleryEditorTab app={app} store={store} />,
        });

        const unregisterReloader = app.services.workspace.registerReloader(() => store.reload());

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

        const unregisterPanel = app.services.ui.panels.register({
            id: PANEL_ID,
            title: "Gallery",
            icon: <Images size={16} />,
            position: PanelPosition.Left,
            component: () => <GalleryPanel app={app} store={store} onOpenEditor={openEditor} />,
            defaultVisible: false,
            order: 640,
        });

        return () => {
            unregisterPanel();
            unregisterReloader();
            unregisterArtworkOptions();
            unregisterVariantOptions();
            unregisterGroupOptions();
            // Object URLs outlive React unmounts by design (see components.tsx),
            // so unload is the one place they get released.
            disposeAssetUrls();
        };
    },
});
