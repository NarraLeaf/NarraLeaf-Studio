import { ChartGantt } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { StageTimelinePanel } from "./StageTimelinePanel";
import { STAGE_TIMELINE_PANEL_ID } from "./stageTimelineIds";

/**
 * The stage timeline, in the bottom dock: a wide, short view that sits under the script it follows,
 * beside Story Motion.
 */
export const stageTimelinePanelModule: PanelModule = {
    metadata: {
        id: STAGE_TIMELINE_PANEL_ID,
        titleKey: "placeholders.moduleTitles.stageTimeline",
        get title() {
            return translate("placeholders.moduleTitles.stageTimeline");
        },
        icon: <ChartGantt className="w-4 h-4" />,
        position: PanelPosition.Bottom,
        defaultVisible: false,
        order: 9,
    },
    component: StageTimelinePanel,
};
