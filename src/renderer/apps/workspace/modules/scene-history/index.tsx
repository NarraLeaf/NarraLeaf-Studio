import { History } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { SceneHistoryPanel } from "./SceneHistoryPanel";

export const SCENE_HISTORY_PANEL_ID = "narraleaf-studio:scene-history";

/**
 * Scene History panel (right dock): content snapshots of the focused scene.
 *
 * A static module beside the Scene Snapshot panel (`order: 3`), for the reason that one is static:
 * the place an author goes to get work back has to be findable before they are editing a row.
 * `defaultVisible: false` so existing projects' right-dock layouts are not rewritten.
 */
export const sceneHistoryPanelModule: PanelModule = {
    metadata: {
        id: SCENE_HISTORY_PANEL_ID,
        titleKey: "sceneHistory.panelTitle",
        get title() {
            return translate("sceneHistory.panelTitle");
        },
        icon: <History className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: false,
        order: 3,
    },
    component: SceneHistoryPanel,
};

export { SceneHistoryPanel } from "./SceneHistoryPanel";
