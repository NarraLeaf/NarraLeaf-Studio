import { SquareFunction } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelPosition } from "../../registry/types";
import type { PanelModule } from "../types";
import { StoryCommandsPanel } from "./StoryCommandsPanel";

export const STORY_COMMANDS_PANEL_ID = "narraleaf-studio:story-commands";

/**
 * The project's own story commands, on the left rail beside the story panel.
 *
 * `order: -5` puts the icon directly under 故事: a command is written for the stories and called from
 * them, so the two read as one neighbourhood. `defaultVisible` stays false like the localization page,
 * so the icon is there and the panel opens when the author asks for it.
 */
export const storyCommandsPanelModule: PanelModule = {
    metadata: {
        id: STORY_COMMANDS_PANEL_ID,
        // Resolved lazily on read (module registration runs after i18n init).
        titleKey: "placeholders.moduleTitles.storyCommands",
        get title() {
            return translate("placeholders.moduleTitles.storyCommands");
        },
        icon: <SquareFunction className="w-4 h-4" />,
        position: PanelPosition.Left,
        defaultVisible: false,
        order: -5,
    },
    component: StoryCommandsPanel,
};

export { StoryCommandsPanel };
