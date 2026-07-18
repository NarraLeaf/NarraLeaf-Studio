import { Search } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { SearchPanel } from "./SearchPanel";

export const SEARCH_PANEL_ID = "narraleaf-studio:search";

export const searchPanelModule: PanelModule = {
    metadata: {
        id: SEARCH_PANEL_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.search",
        get title() {
            return translate("placeholders.moduleTitles.search");
        },
        icon: <Search className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: true,
        order: 12,
    },
    component: SearchPanel,
};
