import { FolderOpen } from "lucide-react";
import { translate } from "@/lib/i18n";
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
        titleKey: "placeholders.moduleTitles.assets",
        get title() { return translate("placeholders.moduleTitles.assets"); },
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
 * The bottom tray's asset browser: a folder tree beside the contents of one folder.
 *
 * The same panel as the sidebar's - the same library, menus, shortcuts and drags - in the shape a
 * wide, short tray suits (see `browser/AssetBrowserView.tsx`).
 */
export const assetsBottomModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:assets-bottom",
        titleKey: "placeholders.moduleTitles.assets",
        get title() { return translate("placeholders.moduleTitles.assets"); },
        icon: <FolderOpen className="w-4 h-4" />,
        position: PanelPosition.Bottom,
        defaultVisible: false,
        order: 10,
        payload: {
            focusArea: FocusArea.BottomPanel,
            layout: "browser",
        },
    },
    component: AssetsPanel,
};
