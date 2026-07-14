import { Languages } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { LocalizationPanel } from "./LocalizationPanel";

export const localizationPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:localization",
        // Resolved lazily on read (module registration runs after i18n init).
        get title() {
            return translate("placeholders.moduleTitles.localization");
        },
        icon: <Languages className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: 25,
    },
    component: LocalizationPanel,
};

export { LocalizationPanel };
