import { BookOpen } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { StoryPanel } from "./panel/StoryPanel";
import { STORY_PANEL_ID } from "./panel/storyPanelReveal";

export const storyPanelModule: PanelModule = {
    metadata: {
        id: STORY_PANEL_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.story",
        get title() {
            return translate("placeholders.moduleTitles.story");
        },
        icon: <BookOpen className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: -10,
    },
    component: StoryPanel,
};

export { StoryPanel };
