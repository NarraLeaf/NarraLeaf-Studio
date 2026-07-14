import { Package } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { ProjectPanel } from "./ProjectPanel";

export const projectPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:project",
        // Resolved lazily on read (module registration runs after i18n init).
        get title() {
            return translate("placeholders.moduleTitles.project");
        },
        icon: <Package className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: -20,
    },
    component: ProjectPanel,
};

export { ProjectPanel };
