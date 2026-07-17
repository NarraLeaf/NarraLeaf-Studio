import { LayoutDashboard } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { DashboardTab } from "./DashboardTab";
import { DASHBOARD_TAB_ID } from "./dashboardTabId";

export function createDashboardTab(): EditorTabDefinition {
    return {
        id: DASHBOARD_TAB_ID,
        title: translate("placeholders.moduleTitles.dashboard"),
        icon: <LayoutDashboard className="w-4 h-4" />,
        component: DashboardTab,
        closable: true,
    };
}

/** Open the dashboard, or focus it if it is already open. */
export function openDashboardTab(ctx: WorkspaceContext, options?: { activate?: boolean }): void {
    const uiService = ctx.services.get<UIService>(Services.UI);
    uiService.editor.open(createDashboardTab(), undefined, options);
}
