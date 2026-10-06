import { useEffect } from "react";
import { ListPlus } from "lucide-react";
import { translate } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { useWorkspace } from "../../../context";
import { PanelPosition } from "../../../registry/types";
import { StoryActionCreatorPanel } from "./StoryActionCreatorPanel";
import { STORY_ACTION_CREATOR_PANEL_ID, type StoryActionCreatorPanelPayload } from "./storyActionCreatorEvents";
import { getStoryPreviewHub } from "./preview/storyPreviewHub";
import { holdStoryCommandManualOnRail } from "./storyCommandManualRail";

/**
 * The command manual's place on the right rail, held for as long as any story scene is open.
 *
 * The manual describes the command language rather than one scene, so what it hangs on is whether
 * there is a story open to write commands into - not which editor happens to be in front. Held by
 * the scene tab in front, it came and went with every look at another editor, and coming back to the
 * scene found the dock on some other panel. Closing the last scene takes it off the rail; the dock
 * keeps its selection (see `dockActivePanel`), so opening a scene again brings the manual back if it
 * was open.
 *
 * Mounted once by the workspace shell, like the other always-on story pieces, and absent from a
 * recovery window, which has no story to write into.
 */
export function StoryCommandManualDock(): null {
    const { context, isInitialized } = useWorkspace();

    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }
        const ui = context.services.get<UIService>(Services.UI);
        return holdStoryCommandManualOnRail(getStoryPreviewHub(context), ui.getStore(), {
            register: payload => ui.panels.register<StoryActionCreatorPanelPayload>({
                id: STORY_ACTION_CREATOR_PANEL_ID,
                titleKey: "story.commandManual.title",
                title: translate("story.commandManual.title"),
                icon: <ListPlus className="w-4 h-4" />,
                position: PanelPosition.Right,
                component: StoryActionCreatorPanel,
                defaultVisible: false,
                order: 10,
                payload,
            }),
            retarget: payload => ui.panels.updatePayload(STORY_ACTION_CREATOR_PANEL_ID, payload),
        });
    }, [context, isInitialized]);

    return null;
}
