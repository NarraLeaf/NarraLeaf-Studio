import { MessageSquare } from "lucide-react";
import { translate } from "@/lib/i18n";
import { PanelModule } from "../types";
import { PanelPosition } from "../../registry/types";
import { StoryCommentsPanel } from "./StoryCommentsPanel";
import { STORY_COMMENTS_PANEL_ID } from "./storyCommentsState";

/**
 * Comments panel (right dock): every review thread on a story row, by scene.
 *
 * A static module like the dictionary panel above it, because the threads are a project document
 * and the list has to be reachable with no story open. `defaultVisible` stays false so existing
 * saved layouts are left as they are; the icon is on the rail either way.
 */
export const storyCommentsPanelModule: PanelModule = {
    metadata: {
        id: STORY_COMMENTS_PANEL_ID,
        titleKey: "placeholders.moduleTitles.storyComments",
        get title() {
            return translate("placeholders.moduleTitles.storyComments");
        },
        icon: <MessageSquare className="w-4 h-4" />,
        position: PanelPosition.Right,
        defaultVisible: false,
        order: 3,
    },
    component: StoryCommentsPanel,
};

export { StoryCommentsPanel } from "./StoryCommentsPanel";
export { STORY_COMMENTS_PANEL_ID, openStoryCommentsPanel } from "./storyCommentsState";
