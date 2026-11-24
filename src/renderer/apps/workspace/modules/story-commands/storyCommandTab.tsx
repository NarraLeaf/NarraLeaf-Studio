import { SquareFunction } from "lucide-react";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { StoryCommandEditorTab, type StoryCommandTabPayload } from "./StoryCommandEditorTab";

/** One tab per command: opening a command that is already open focuses its tab. */
export const STORY_COMMAND_TAB_PREFIX = "narraleaf-studio:story-command:";

export function storyCommandTabId(commandId: string): string {
    return `${STORY_COMMAND_TAB_PREFIX}${commandId}`;
}

export function createStoryCommandTab(commandId: string, name: string): EditorTabDefinition<StoryCommandTabPayload> {
    return {
        id: storyCommandTabId(commandId),
        title: name,
        icon: <SquareFunction className="w-4 h-4" />,
        component: StoryCommandEditorTab,
        payload: { commandId },
        closable: true,
    };
}

export function openStoryCommandTab(ctx: WorkspaceContext, commandId: string, name: string): void {
    ctx.services.get<UIService>(Services.UI).editor.open(createStoryCommandTab(commandId, name));
}
