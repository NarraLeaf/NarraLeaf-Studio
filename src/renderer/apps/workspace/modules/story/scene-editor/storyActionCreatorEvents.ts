import type { ActionCommandId } from "./storyActionCommands";

export const STORY_ACTION_CREATOR_PANEL_ID = "narraleaf-studio:story-action-creator";
export const STORY_ACTION_CREATE_REQUEST_EVENT = "narraleaf-studio:story-action-create-request";

export type StoryActionCreatorPanelPayload = {
    tabId: string;
    storyId: string;
    sceneId: string;
    storyName?: string;
    sceneName?: string;
};

export type StoryActionCreateRequestDetail = {
    tabId: string;
    commandId: ActionCommandId;
};

export function dispatchStoryActionCreateRequest(detail: StoryActionCreateRequestDetail): void {
    window.dispatchEvent(new CustomEvent<StoryActionCreateRequestDetail>(STORY_ACTION_CREATE_REQUEST_EVENT, { detail }));
}
