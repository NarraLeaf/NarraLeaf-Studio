import { FileText } from "lucide-react";
import type { EditorTabDefinition } from "../../../registry/types";
import { StorySceneEditorTab } from "./StorySceneEditorTab";
import { getStorySceneEditorTabId, type StorySceneEditorTabPayload } from "./storySceneEditorTabId";

export function createStorySceneEditorTab(
    payload: StorySceneEditorTabPayload,
    title: string,
): EditorTabDefinition<StorySceneEditorTabPayload> {
    return {
        id: getStorySceneEditorTabId(payload.storyId, payload.sceneId),
        title,
        icon: <FileText className="h-4 w-4" />,
        component: StorySceneEditorTab,
        payload,
        closable: true,
        modified: false,
    };
}
