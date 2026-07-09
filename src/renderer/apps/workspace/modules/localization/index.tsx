import { Languages } from "lucide-react";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { LocalizationPanel } from "./LocalizationPanel";

export const localizationPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:localization",
        title: "Localization",
        icon: <Languages className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: 25,
    },
    component: LocalizationPanel,
};

export { LocalizationPanel };
