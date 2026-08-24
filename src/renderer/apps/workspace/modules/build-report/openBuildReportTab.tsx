import { Package } from "lucide-react";
import type { EditorTabDefinition } from "@/apps/workspace/registry/types";
import { translate } from "@/lib/i18n";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { EditorModule } from "../types";
import { BuildReportTab } from "./BuildReportTab";
import { BUILD_REPORT_TAB_ID } from "./buildReportIds";

/**
 * The report opens as an editor tab, like the lint and test reports: a finished run is a document,
 * and the workspace already opens documents in tabs. The live half of a build is the console
 * channel, which is where it stays.
 */
export function createBuildReportTab(): EditorTabDefinition<void> {
    return {
        id: BUILD_REPORT_TAB_ID,
        title: translate("build.report.title"),
        icon: <Package className="h-4 w-4" />,
        component: BuildReportTab,
        closable: true,
    };
}

/**
 * Open the report, or focus it when it is already open.
 *
 * `openOrUpdate` on a fixed id: the tab reads the last finished run off the build service, so a
 * second build re-points the page that is already open instead of stacking another one beside it.
 */
export function openBuildReportTab(ctx: WorkspaceContext, groupId?: string): void {
    ctx.services.get<UIService>(Services.UI).editor.openOrUpdate(createBuildReportTab(), groupId);
}

/**
 * The registry entry. The tab is opened through the definition above rather than looked up by module
 * id; this is what declares the report exists alongside the other built-in editors, and what lets a
 * tab left open be restored.
 */
export const buildReportModule: EditorModule<void> = {
    metadata: {
        id: BUILD_REPORT_TAB_ID,
        get title() { return translate("build.report.title"); },
        titleKey: "build.report.title",
        icon: <Package className="h-4 w-4" />,
        closable: true,
    },
    component: BuildReportTab,
};
