import { Variable } from "lucide-react";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { StoryVariablesPanel } from "./StoryVariablesPanel";

/**
 * Story Variables panel module (right sidebar). Manages Scene and Saved variables for the active
 * story scene and lists the shared Persistent variables.
 */
export const storyVariablesPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:story-variables",
        title: "Story Variables",
        icon: <Variable className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: false,
        order: 5,
    },
    component: StoryVariablesPanel,
};

export { StoryVariablesPanel };
