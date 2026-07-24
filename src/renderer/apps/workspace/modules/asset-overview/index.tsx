import { Boxes } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { EditorModule } from "../types";
import { AssetOverviewTab } from "./AssetOverviewTab";
import { ASSET_OVERVIEW_TAB_ID } from "./assetOverviewTabId";

/**
 * Asset overview editor module — the full-page, read-only reading of the asset library.
 *
 * A page rather than a panel: the numbers only mean anything side by side, and the sidebar's job
 * (drag an asset into a scene) is a different one that this must not take over.
 */
export const assetOverviewModule: EditorModule = {
    metadata: {
        id: ASSET_OVERVIEW_TAB_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "assets.overview.tabTitle",
        get title() {
            return translate("assets.overview.tabTitle");
        },
        icon: <Boxes className="w-4 h-4" />,
        closable: true,
    },
    component: AssetOverviewTab,
};

export { AssetOverviewCommand } from "./AssetOverviewCommand";
export { createAssetOverviewTab, openAssetOverviewTab } from "./openAssetOverviewTab";
export { ASSET_OVERVIEW_TAB_ID } from "./assetOverviewTabId";
