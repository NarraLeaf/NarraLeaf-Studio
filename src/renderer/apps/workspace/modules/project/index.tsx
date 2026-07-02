import { Package } from "lucide-react";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { ProjectPanel } from "./ProjectPanel";

export const projectPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:project",
        title: "Project",
        icon: <Package className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: -20,
    },
    component: ProjectPanel,
};

export { ProjectPanel };
