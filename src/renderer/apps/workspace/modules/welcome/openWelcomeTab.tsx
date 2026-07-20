import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { welcomeModule } from "./index";

/**
 * Marks that the welcome tab has had its one showing.
 *
 * Studio-wide rather than per-project (the way the dashboard's toggle is): "welcome" is about
 * meeting Studio for the first time, so a second project is not a second first run.
 */
export const WELCOME_SHOWN_KEY = "welcome.shown";

/**
 * Live tab definition for the welcome screen. Shared by the auto-open path and by session
 * restore, so a restored welcome tab is identical to a freshly opened one.
 */
export function createWelcomeTab(): EditorTabDefinition {
    return {
        id: welcomeModule.metadata.id,
        title: welcomeModule.metadata.title,
        icon: welcomeModule.metadata.icon,
        component: welcomeModule.component as EditorTabDefinition["component"],
        closable: welcomeModule.metadata.closable,
    };
}

/** Open the welcome screen, or focus it if it is already open. */
export function openWelcomeTab(ctx: WorkspaceContext, options?: { activate?: boolean }): void {
    const uiService = ctx.services.get<UIService>(Services.UI);
    uiService.editor.open(createWelcomeTab(), undefined, options);
}
