import { PanelsTopLeft } from "lucide-react";
import { PanelModule } from "../types";
import { UISurfacesPanel } from "./UISurfacesPanel";
import { PanelPosition } from "../../registry/types";
import { FocusArea } from "@/lib/workspace/services/ui/types";

export const uiEditorSurfacesModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:ui-surfaces",
        title: "UI",
        icon: <PanelsTopLeft className="w-4 h-4" />,
        position: PanelPosition.Left,
        order: 0,
        defaultVisible: true,
        payload: {
            focusArea: FocusArea.LeftPanel,
        },
    },
    component: UISurfacesPanel,
};
