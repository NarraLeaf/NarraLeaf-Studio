import { Spline } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { StoryMotionPanel } from "./StoryMotionPanel";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import type { StoryMotionPanelPayload } from "./storyMotionTypes";
export { createStoryMotionEditorTab } from "./StoryMotionEditorTab";
export { StoryMotionPicker } from "./StoryMotionPicker";
export { MotionSelector, MotionField } from "./MotionSelector";
export type { StoryMotionActionContext, StoryMotionEditorPayload, StoryMotionPanelPayload } from "./storyMotionTypes";

export const STORY_MOTION_PANEL_ID = "narraleaf-studio:story-motion";

export const storyMotionPanelModule: PanelModule<StoryMotionPanelPayload> = {
    metadata: {
        id: STORY_MOTION_PANEL_ID,
        get title() { return translate("placeholders.moduleTitles.storyMotion"); },
        icon: <Spline className="w-4 h-4" />,
        position: PanelPosition.Bottom,
        defaultVisible: false,
        order: 8,
    },
    component: StoryMotionPanel,
};

export function openStoryMotionPanel(workspace: WorkspaceContext, payload: StoryMotionPanelPayload = {}): void {
    const uiService = workspace.services.get<UIService>(Services.UI);
    uiService.panels.updatePayload(STORY_MOTION_PANEL_ID, payload);
    uiService.panels.show(STORY_MOTION_PANEL_ID);
}
