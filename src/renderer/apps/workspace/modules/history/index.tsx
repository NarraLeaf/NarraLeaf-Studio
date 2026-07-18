import { History } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { HistoryPanel } from "./HistoryPanel";

export const HISTORY_PANEL_ID = "narraleaf-studio:history";

/** Bottom-dock panel exposing the active editor's undo/redo via the unified history contract. */
export const historyPanelModule: PanelModule = {
    metadata: {
        id: HISTORY_PANEL_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.history",
        get title() {
            return translate("placeholders.moduleTitles.history");
        },
        icon: <History className="w-4 h-4" />,
        position: PanelPosition.Bottom,
        defaultVisible: false,
        order: 20,
    },
    component: HistoryPanel,
};
