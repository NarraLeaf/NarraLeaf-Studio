import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import type { HelpTopicId } from "@/lib/help";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { helpModule } from "./index";
import type { HelpEditorPayload } from "./HelpEditor";

export const HELP_TAB_ID = helpModule.metadata.id;

/**
 * Live tab definition for the help browser. Shared by the palette command, the popover's "All
 * topics" and session restore, so a restored help tab is identical to a freshly opened one.
 */
export function createHelpTab(topicId?: HelpTopicId): EditorTabDefinition<HelpEditorPayload> {
    return {
        id: HELP_TAB_ID,
        title: helpModule.metadata.title,
        icon: helpModule.metadata.icon,
        component: helpModule.component as EditorTabDefinition<HelpEditorPayload>["component"],
        closable: true,
        payload: topicId ? { topicId } : undefined,
    };
}

/**
 * Open the help browser, or bring the open one forward at the requested topic.
 *
 * A single tab rather than one per topic: `openOrUpdate` replaces the payload of the tab already
 * open, which is what "help" means here - one reader, currently showing something.
 */
export function openHelpTab(ctx: WorkspaceContext, topicId?: HelpTopicId): void {
    const uiService = ctx.services.get<UIService>(Services.UI);
    uiService.editor.openOrUpdate(createHelpTab(topicId));
}
