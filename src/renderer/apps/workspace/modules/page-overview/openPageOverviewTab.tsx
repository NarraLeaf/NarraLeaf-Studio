import { Workflow } from "lucide-react";
import { translate } from "@/lib/i18n";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { PageOverviewTab } from "./PageOverviewTab";
import { PAGE_OVERVIEW_TAB_ID, type PageOverviewTabPayload } from "./pageOverviewTabId";

export function createPageOverviewTab(payload: PageOverviewTabPayload = {}): EditorTabDefinition<PageOverviewTabPayload> {
    return {
        id: PAGE_OVERVIEW_TAB_ID,
        title: translate("uiEditor.pageOverview.title"),
        icon: <Workflow className="w-4 h-4" />,
        component: PageOverviewTab,
        payload,
        closable: true,
    };
}

/**
 * Open the Page Overview, or bring it forward if it is already open.
 *
 * Naming a page shows that page: an open overview is moved to it rather than a second one opened,
 * and in "All pages" it scrolls there. Naming none leaves an open overview where it was.
 */
export function openPageOverviewTab(ctx: WorkspaceContext, surfaceId?: string): void {
    const editor = ctx.services.get<UIService>(Services.UI).editor;
    const current = editor.getPayload<PageOverviewTabPayload>(PAGE_OVERVIEW_TAB_ID);
    editor.open(createPageOverviewTab(current ?? (surfaceId ? { surfaceId } : {})));
    if (surfaceId) {
        editor.updatePayload<PageOverviewTabPayload>(PAGE_OVERVIEW_TAB_ID, { ...(current ?? {}), surfaceId });
    }
}
