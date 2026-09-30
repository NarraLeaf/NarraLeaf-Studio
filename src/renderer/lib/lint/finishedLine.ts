import { translate, translateN } from "@/lib/i18n";
import type { LintReport } from "./types";

/**
 * The line a console prints when a sweep ends: "1 error, 3 warnings in 0.4s".
 *
 * One function for the three consoles that close a sweep with it - the Lint channel, the build
 * channel and `--lint` - so they cannot word it three ways. Each count takes its own plural form
 * before the template joins them: one template cannot agree with two numbers at once.
 */
export function formatLintFinishedLine(report: Pick<LintReport, "counts" | "startedAt" | "finishedAt">): string {
    return translate("lint.console.finishedCounts", {
        errors: translateN("common.count.errors", report.counts.error),
        warnings: translateN("common.count.warnings", report.counts.warning),
        duration: `${((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s`,
    });
}
