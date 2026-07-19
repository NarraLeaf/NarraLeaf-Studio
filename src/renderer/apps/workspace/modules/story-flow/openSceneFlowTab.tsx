import { Waypoints } from "lucide-react";
import type { StoryId } from "@shared/types/story";
import { translate } from "@/lib/i18n";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { SceneFlowTab } from "./SceneFlowTab";
import { getSceneFlowTabId, type SceneFlowTabPayload } from "./sceneFlowTabId";

export function createSceneFlowTab(
    storyId: StoryId,
    storyName?: string,
): EditorTabDefinition<SceneFlowTabPayload> {
    return {
        id: getSceneFlowTabId(storyId),
        title: storyName
            ? translate("story.flow.tabTitleNamed", { name: storyName })
            : translate("story.flow.tabTitle"),
        icon: <Waypoints className="w-4 h-4" />,
        component: SceneFlowTab,
        payload: { storyId },
        closable: true,
    };
}

/** Open a story's flow map, or focus it if already open. */
export function openSceneFlowTab(
    ctx: WorkspaceContext,
    storyId: StoryId,
    storyName?: string,
): void {
    const uiService = ctx.services.get<UIService>(Services.UI);
    // `openOrUpdate` rather than `open`: re-opening must not clobber the positions and viewport the
    // live tab has already written back into its payload.
    const existing = uiService.editor.get(getSceneFlowTabId(storyId));
    if (existing) {
        uiService.editor.setActive(existing.id);
        return;
    }
    uiService.editor.open(createSceneFlowTab(storyId, storyName));
}

/**
 * Rail/palette entry point: the flow map is per-story, so fall back to the project's default story
 * (and then to the only one there is) when the caller has no story in hand.
 */
export function openDefaultSceneFlowTab(ctx: WorkspaceContext): void {
    const storyService = ctx.services.get<StoryService>(Services.Story);
    const stories = storyService.listStories();
    const storyId = storyService.getDefaultStoryId() ?? stories[0]?.id;
    if (!storyId) {
        return;
    }
    openSceneFlowTab(ctx, storyId, stories.find(entry => entry.id === storyId)?.name);
}
