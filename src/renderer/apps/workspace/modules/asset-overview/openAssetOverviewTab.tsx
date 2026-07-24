import { Boxes } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { AssetOverviewTab } from "./AssetOverviewTab";
import { ASSET_OVERVIEW_TAB_ID } from "./assetOverviewTabId";

export function createAssetOverviewTab(): EditorTabDefinition {
    return {
        id: ASSET_OVERVIEW_TAB_ID,
        title: translate("assets.overview.tabTitle"),
        icon: <Boxes className="w-4 h-4" />,
        component: AssetOverviewTab,
        closable: true,
    };
}

/** Open the asset overview, or focus it if it is already open. */
export function openAssetOverviewTab(ctx: WorkspaceContext, options?: { activate?: boolean }): void {
    const uiService = ctx.services.get<UIService>(Services.UI);
    uiService.editor.open(createAssetOverviewTab(), undefined, options);
}
