import { BookOpen } from "lucide-react";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { StoryPanel } from "./panel/StoryPanel";

export const storyPanelModule: PanelModule = {
    metadata: {
        id: "narraleaf-studio:story",
        title: "Story",
        icon: <BookOpen className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: -10,
    },
    component: StoryPanel,
};

export { StoryPanel };
