import { SlidersHorizontal } from "lucide-react";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { SettingsPanel } from "./SettingsPanel";

export const settingsModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:settings",
        title: "Project Settings",
        icon: <SlidersHorizontal className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: 30,
    },
    component: SettingsPanel,
};

