import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { aboutModule } from "./index";

/** Live tab definition for the About screen; shared by the open path and any session restore. */
export function createAboutTab(): EditorTabDefinition {
    return {
        id: aboutModule.metadata.id,
        title: aboutModule.metadata.title,
        icon: aboutModule.metadata.icon,
        component: aboutModule.component as EditorTabDefinition["component"],
        closable: aboutModule.metadata.closable,
    };
}

/** Open the About screen, or focus it if it is already open. */
export function openAboutTab(ctx: WorkspaceContext, options?: { activate?: boolean }): void {
    const uiService = ctx.services.get<UIService>(Services.UI);
    uiService.editor.open(createAboutTab(), undefined, options);
}
