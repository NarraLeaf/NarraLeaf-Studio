import { LayoutDashboard } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { openDashboardTab } from "./openDashboardTab";

/**
 * The dashboard's rail entry is a button, not a panel: it has no sidebar body and instead opens
 * the dashboard's editor tab, which needs the full editor width to be worth reading.
 */
export const dashboardPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:dashboard",
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.dashboard",
        get title() {
            return translate("placeholders.moduleTitles.dashboard");
        },
        icon: <LayoutDashboard className="w-4 h-4" />,
        position: PanelPosition.Left,
        order: -30,
    },
    railAction: (ctx) => openDashboardTab(ctx),
};

export { openDashboardTab, createDashboardTab } from "./openDashboardTab";
export { DASHBOARD_TAB_ID } from "./dashboardTabId";
