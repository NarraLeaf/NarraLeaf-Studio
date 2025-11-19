import { Settings } from "lucide-react";
import { PanelModule } from "../types";
import { PropertiesPanel } from "./PropertiesPanel";
import { PanelPosition } from "../../registry/types";

/**
 * Properties panel module
 * Displays and edits properties of selected items
 */
export const propertiesModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:properties",
        title: "Properties",
        icon: <Settings className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: true,
        order: 0,
    },
    component: PropertiesPanel,
};

