import { FolderOpen } from "lucide-react";
import { PanelModule } from "../types";
import { AssetsPanel } from "./AssetsPanel";
import { PanelPosition } from "../../registry/types";
import { FocusArea } from "@/lib/workspace/services/ui/types";

/**
 * Assets panel module
 * Manages project assets and resources inside the left sidebar.
 */
export const assetsModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:assets",
        title: "Assets",
        icon: <FolderOpen className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: true,
        order: 20,
        payload: {
            defaultViewMode: "list",
            defaultIconSize: 140,
            focusArea: FocusArea.LeftPanel,
        },
    },
    component: AssetsPanel,
};

/**
 * Secondary assets panel module that lives in the bottom tray.
 */
export const assetsBottomModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:assets-bottom",
        title: "Assets",
        icon: <FolderOpen className="w-4 h-4" />,
        position: PanelPosition.Bottom,
        defaultVisible: false,
        order: 10,
        payload: {
            defaultViewMode: "icons",
            defaultIconSize: 140,
            focusArea: FocusArea.BottomPanel,
            showHeader: false,
        },
    },
    component: AssetsPanel,
};
