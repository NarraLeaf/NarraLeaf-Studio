import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { SquareDashed } from "lucide-react";
import { createElement } from "react";
import { translate } from "@/lib/i18n";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { NewTabEditor } from "./NewTabEditor";
import { getNewTabId } from "./newTabId";

/**
 * Live tab definition for a blank new-tab page. Shared by the "+" button and by session restore,
 * so a restored blank tab is identical to a freshly opened one.
 */
export function createNewTabTab(token: string): EditorTabDefinition {
    return {
        id: getNewTabId(token),
        title: translate("workspace.shell.newTabPage.title"),
        // A dashed outline reads as "nothing here yet" without borrowing the strip's own "+".
        icon: createElement(SquareDashed, { className: "w-4 h-4" }),
        component: NewTabEditor,
        closable: true,
    };
}

/** Open a fresh blank tab, browser-style — every call creates a new one. */
export function openNewTab(ctx: WorkspaceContext, groupId?: string): void {
    const uiService = ctx.services.get<UIService>(Services.UI);
    uiService.editor.open(createNewTabTab(crypto.randomUUID()), groupId);
}
