import { ListChecks } from "lucide-react";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { translate } from "@/lib/i18n";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { LintReportTab } from "./LintReportTab";
import { LINT_REPORT_TAB_ID } from "./lintIds";

/**
 * The report opens as an editor tab, not a panel (ruling R6): a project-wide report is a document,
 * and the workspace already opens documents in tabs.
 */
export function createLintReportTab(): EditorTabDefinition<void> {
    return {
        id: LINT_REPORT_TAB_ID,
        title: translate("lint.report.title"),
        icon: <ListChecks className="h-4 w-4" />,
        component: LintReportTab,
        closable: true,
    };
}

/**
 * Open the report, or focus it when it is already open.
 *
 * `openOrUpdate` rather than `open` because the id is fixed: an existing tab is replaced in place
 * and activated, and since the component reference is stable across calls React keeps the mounted
 * instance - so re-running does not reset the reader's filter or grouping.
 */
export function openLintReportTab(ctx: WorkspaceContext, groupId?: string): void {
    ctx.services.get<UIService>(Services.UI).editor.openOrUpdate(createLintReportTab(), groupId);
}
