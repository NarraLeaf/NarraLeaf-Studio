import { getInterface } from "@/lib/app/bridge";
import { DEFAULT_LOCALE } from "@shared/i18n";
import { i18nStore } from "@/lib/i18n/store";
import { translate } from "@/lib/i18n";
import type { CommandLineRunFinding } from "@shared/types/commandLineRun";
import type { DevModeConsoleLogLevel } from "@shared/types/devMode";
import { Services, type WorkspaceContext } from "../workspace/services/services";
import {
    countBlockingLintFindings,
    formatLintFinding,
} from "../workspace/services/core/BuildService";
import { LintService } from "../workspace/services/core/LintService";
import { ProjectService } from "../workspace/services/core/ProjectService";
import { describeLintLocation } from "./locationText";
import type { LintReport } from "./types";

/**
 * The workspace half of `narraleaf-studio --lint`.
 *
 * **`LintService.run()` is called exactly as the Lint tab and the build gate call it**, which is
 * the whole reason this runs in a workspace at all: the rules read a context assembled out of a
 * dozen services - the story documents, the asset library, the reference index, the blueprint and
 * interface documents - and a second implementation of that context would eventually let a
 * command-line sweep pass a project the build gate refuses.
 *
 * Nothing here decides which rules run or how much a finding matters. The project decides both, in
 * `Project > Project`: a rule the project turned off is skipped, and the severity a finding carries
 * is the one the project configured. This only reports.
 *
 * ## What counts as a failure
 *
 * The build gate's own predicate, `countBlockingLintFindings`, over the project's `failBuildOn`. So
 * an error always fails the run, and a warning fails it exactly on the projects that have said
 * warnings should stop a build. Inventing a second threshold here would give an operator a green
 * sweep and a refused build from one project on one day.
 *
 * `runOnBuild` is deliberately not consulted: that setting says whether a *build* stops to lint, and
 * this launch asked for a sweep outright.
 *
 * ## Why the log is pinned to the source language
 *
 * The same reason `runCommandLineBuild` gives: a machine's language is not a choice anybody made
 * about this log, and half a sweep's console comes from code that is not translated at all.
 */
export async function runCommandLineLint(context: WorkspaceContext): Promise<void> {
    // Before the first line is written, because `translate` reads this at the moment one is.
    // Window-local: it sets this renderer's store, not the `app.language` preference.
    i18nStore.setLocale(DEFAULT_LOCALE);

    const workspace = getInterface().workspace;
    const services = context.services;
    const lintService = services.get<LintService>(Services.Lint);
    const projectService = services.get<ProjectService>(Services.Project);

    const emit = (level: DevModeConsoleLogLevel, message: string): void => {
        workspace.reportCommandLineRun({
            kind: "log",
            timestamp: Date.now(),
            level,
            source: "Lint",
            message,
        });
    };

    let report: LintReport;
    try {
        report = await lintService.run();
    } catch (error) {
        workspace.reportCommandLineRun({
            kind: "finished",
            ok: false,
            error: error instanceof Error ? error.message : String(error),
        });
        return;
    }

    // One line per finding, in the order the sweep produced them, and in the words the build
    // console uses - `formatLintFinding` is the same function the Build tab prints through.
    for (const entry of report.entries) {
        emit(entry.severity === "error" ? "error" : entry.severity === "warning" ? "warning" : "info",
            formatLintFinding(entry));
    }

    const config = projectService.getLintingConfiguration();
    const blocking = countBlockingLintFindings(report, config.failBuildOn);
    emit(blocking > 0 ? "error" : "success", translate("lint.console.finished", {
        errors: report.counts.error,
        warnings: report.counts.warning,
        duration: `${((report.finishedAt - report.startedAt) / 1000).toFixed(1)}s`,
    }));

    const findings: CommandLineRunFinding[] = report.entries.map(entry => {
        const location = describeLintLocation(entry.location);
        return {
            severity: entry.severity,
            id: entry.ruleId,
            message: translate(entry.messageKey, entry.messageParams),
            ...(location ? { location } : {}),
        };
    });

    workspace.reportCommandLineRun({
        kind: "finished",
        ok: blocking === 0,
        ...(blocking > 0
            ? {
                error: `Lint found ${blocking} ${blocking === 1 ? "finding" : "findings"} this project treats as blocking`
                    + ` (failBuildOn: ${config.failBuildOn}).`,
            }
            : {}),
        startedAt: report.startedAt,
        finishedAt: report.finishedAt,
        lint: {
            counts: report.counts,
            findings,
            rulesRun: [...report.rulesRun],
            skipped: [...report.skipped],
            startedAt: report.startedAt,
            finishedAt: report.finishedAt,
        },
    });
}
