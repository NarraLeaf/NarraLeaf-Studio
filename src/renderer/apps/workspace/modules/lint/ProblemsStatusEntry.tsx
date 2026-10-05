import { useEffect, useMemo, useState } from "react";
import { CircleX, Loader2, TriangleAlert } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import type { LintReport } from "@/lib/lint/types";
import type { LintService, LintServiceState } from "@/lib/workspace/services/core/LintService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../context";
import { StatusEntry } from "../status-bar/StatusEntry";
import { PROBLEMS_PANEL_ID } from "./lintIds";

/**
 * The project's error and warning counts, always in the status bar, and the way to the Problems
 * panel.
 *
 * In the bar rather than only on the panel because the panel is closed most of the time, and the
 * one thing an author needs to know without opening it is whether anything is wrong. The counts are
 * the whole project's, whatever the panel's scope is set to - the bar has no scope to show.
 *
 * Nothing before the first check has finished: a zero there would be a clean bill nobody issued.
 */
export function ProblemsStatusEntry() {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const lintService = useMemo(
        () => (context && isInitialized ? context.services.get<LintService>(Services.Lint) : null),
        [context, isInitialized],
    );
    const [report, setReport] = useState<LintReport | null>(null);
    const [state, setState] = useState<LintServiceState | null>(null);

    useEffect(() => {
        if (!lintService) {
            return;
        }
        setReport(lintService.getLastReport());
        setState(lintService.getState());
        const offReport = lintService.onReportChanged(setReport);
        const offState = lintService.onStateChanged(setState);
        return () => {
            offReport();
            offState();
        };
    }, [lintService]);

    if (!lintService || (!report && !state?.pending)) {
        return null;
    }

    const toggle = () => {
        context?.services.get<UIService>(Services.UI).panels.toggle(PROBLEMS_PANEL_ID);
    };

    // Busy only before the first answer and while a check somebody asked for runs. The checks that
    // follow edits are not announced here: they run after every pause in typing, and a cell that
    // spun each time would be a status bar flickering under the author's hands.
    const busy = !report || (state?.requestedRunning ?? false);
    const counts = report?.counts ?? { error: 0, warning: 0, info: 0 };
    const summary = report
        ? t("lint.statusBar.counts", {
              errors: tn("common.count.errors", counts.error),
              warnings: tn("common.count.warnings", counts.warning),
              infos: tn("common.count.infos", counts.info),
          })
        : t("lint.report.running");
    const tooltip = busy && report ? `${summary}\n${t("lint.report.running")}` : summary;

    return (
        <StatusEntry onClick={toggle} tooltip={tooltip} ariaLabel={summary} dataAttributes={{ "data-problems-entry": "" }}>
            {report ? (
                <>
                    <CircleX className="h-3 w-3" aria-hidden />
                    <span className="tabular-nums">{counts.error}</span>
                    <TriangleAlert className="ml-1 h-3 w-3" aria-hidden />
                    <span className="tabular-nums">{counts.warning}</span>
                </>
            ) : null}
            {busy ? <Loader2 className={report ? "ml-1 h-3 w-3 animate-spin" : "h-3 w-3 animate-spin"} aria-hidden /> : null}
        </StatusEntry>
    );
}
