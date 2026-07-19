import { Waypoints } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { openDefaultSceneFlowTab } from "./openSceneFlowTab";

/**
 * Like the dashboard, this rail entry is a button rather than a panel: the flow map needs the full
 * editor width to be readable, so there is no sidebar body to show.
 */
export const storyFlowPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:story-flow",
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.storyFlow",
        get title() {
            return translate("placeholders.moduleTitles.storyFlow");
        },
        icon: <Waypoints className="w-4 h-4" />,
        position: PanelPosition.Left,
        order: -5,
    },
    railAction: ctx => openDefaultSceneFlowTab(ctx),
};

export { createSceneFlowTab, openSceneFlowTab, openDefaultSceneFlowTab } from "./openSceneFlowTab";
export { getSceneFlowTabId, type SceneFlowTabPayload } from "./sceneFlowTabId";
export { buildSceneFlowGraph, type SceneFlowGraph } from "./sceneFlowModel";
