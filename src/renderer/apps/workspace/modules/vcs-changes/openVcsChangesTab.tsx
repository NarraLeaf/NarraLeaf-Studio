import { GitCompare, GitMerge } from "lucide-react";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { translate } from "@/lib/i18n";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { shortRevision } from "../../components/layout/versionRailModel";
import { VcsChangesTab } from "./VcsChangesTab";
import { vcsChangesTabId, type VcsChangesPayload } from "./vcsChangesIds";

/**
 * The comparison opens as an editor tab, for the reason the lint report does: it is a document about
 * the whole project, and the workspace already opens documents in tabs. The rail's own summary stays
 * where it is - this is where the author goes when eight rows are not enough, and where a conflict is
 * resolved, which a 320px column cannot hold.
 */
export function createVcsChangesTab(payload: VcsChangesPayload): EditorTabDefinition<VcsChangesPayload> {
    return {
        id: vcsChangesTabId(payload),
        title: tabTitle(payload),
        // The one tab in this family that can change the project wears a different mark, so a strip
        // holding both does not read as two copies of the same thing.
        icon: payload.mode === "resolve"
            ? <GitMerge className="h-4 w-4" />
            : <GitCompare className="h-4 w-4" />,
        component: VcsChangesTab,
        closable: true,
        payload,
    };
}

/**
 * Open it, or focus it when it is already open.
 *
 * `openOrUpdate` rather than `open`, so pressing "view all" on a second file lands in the tab that is
 * already showing the working tree instead of stacking another copy of the same list - the ids in
 * `vcsChangesIds` are what decide which comparisons share a tab.
 */
export function openVcsChangesTab(ctx: WorkspaceContext, payload: VcsChangesPayload, groupId?: string): void {
    ctx.services.get<UIService>(Services.UI).editor.openOrUpdate(createVcsChangesTab(payload), groupId);
}

/**
 * What the tab strip calls it.
 *
 * Read through `translate` rather than a hook because a tab title is captured when the tab is
 * created; the body re-reads its own text reactively, so a language switch changes everything inside
 * the tab and leaves the strip until it is reopened - the same bargain every other tab here makes.
 */
function tabTitle(payload: VcsChangesPayload): string {
    switch (payload.mode) {
        case "working-tree":
            return translate("documentDiff.tab.workingTree");
        case "between":
            return translate("documentDiff.tab.between", {
                from: payload.fromLabel ?? shortRevision(payload.from),
                to: payload.toLabel ?? shortRevision(payload.to),
            });
        case "resolve":
            return translate("documentDiff.resolve.tab");
    }
}
