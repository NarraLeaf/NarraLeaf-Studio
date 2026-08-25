import { Columns2 } from "lucide-react";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { VcsCompareTab } from "./VcsCompareTab";
import { vcsCompareTabId, type VcsComparePayload } from "./vcsCompareIds";

/**
 * One document at two versions, opened as an editor tab.
 *
 * A tab rather than a wider detail column, for the reason the comparison itself is one: a story, a
 * page of the interface and a blueprint graph are read at the size they are authored at, and the
 * comparison's detail column is a few hundred pixels beside an index of every changed file.
 */
export function createVcsCompareTab(payload: VcsComparePayload): EditorTabDefinition<VcsComparePayload> {
    return {
        id: vcsCompareTabId(payload),
        // The document's own name. The two versions are named inside the tab, above each half, so
        // the strip does not spend its width on a pair of numbers that never change.
        title: payload.name,
        icon: <Columns2 className="h-4 w-4" />,
        component: VcsCompareTab,
        closable: true,
        payload,
    };
}

/**
 * Open it, or focus it when it is already open.
 *
 * `openOrUpdate`, so pressing the button twice on the same row lands in the tab that is already
 * showing that document instead of stacking a second copy of it.
 */
export function openVcsCompareTab(ctx: WorkspaceContext, payload: VcsComparePayload, groupId?: string): void {
    ctx.services.get<UIService>(Services.UI).editor.openOrUpdate(createVcsCompareTab(payload), groupId);
}
