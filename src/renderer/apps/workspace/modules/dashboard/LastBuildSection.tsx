/**
 * The last run of the build pipeline, folded into the dashboard.
 *
 * The build activity list beside it answers "how have builds been going" - a run per line, with its
 * console output. This answers "what did the last one actually ship", which is a different question
 * and a heavier one: the artifacts, and what the run carried out of the asset library.
 *
 * Folded shut, because it is not what the dashboard is for. An author opening the workspace wants
 * the writing figures; the build they cut last night is something they come looking for. Open it and
 * the numbers are here, and the full report is one button away.
 *
 * It reads the record the pipeline wrote rather than anything this session holds, so it survives
 * closing the project - which is the whole reason the record exists.
 */

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronRight, FolderOpen, XCircle } from "lucide-react";
import type { LastGameBuildRun } from "@shared/types/gameBuild";
import { RELEASE_APP_TAG } from "@shared/types/appTag";
import { Button } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { revealInFileManagerKey } from "@/lib/app/platform";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { BuildService } from "@/lib/workspace/services/core/BuildService";
import { openBuildReportTab } from "../build-report";
import {
    buildArtifactRows,
    formatBuildDuration as formatReportDuration,
    shippedAssetReport,
    totalArtifactBytes,
} from "../build-report/buildReportModel";
import { formatByteSize } from "../asset-overview/assetOverviewModel";
import { DashboardSection, StatList, StatRow } from "./DashboardPrimitives";

export function LastBuildSection({ context }: { context: WorkspaceContext }) {
    const { t, formatNumber } = useTranslation();
    const [run, setRun] = useState<LastGameBuildRun | null>(null);
    const [open, setOpen] = useState(false);

    useEffect(() => {
        let current = true;
        let buildService: BuildService;
        try {
            buildService = context.services.get<BuildService>(Services.Build);
        } catch {
            return;
        }
        const load = () => {
            void buildService.loadLastRun().then(next => {
                if (current) {
                    setRun(next);
                }
            });
        };
        load();
        const stop = buildService.onStateChanged(state => {
            if (state.status === "done" || state.status === "error") {
                load();
            }
        });
        return () => {
            current = false;
            stop();
        };
    }, [context]);

    // A project that has never been built has nothing to fold: an empty section here would be a
    // permanent heading over a permanent absence, which the dashboard already avoids for structure
    // and localization.
    if (!run) {
        return null;
    }

    const state = run.state;
    const succeeded = state.status === "done" && !run.cancelled;
    const artifacts = buildArtifactRows(state);
    const measured = artifacts.some(artifact => artifact.bytes !== undefined);
    const report = shippedAssetReport(state);
    const duration = formatReportDuration(state, t);

    return (
        <DashboardSection title={t("dashboard.lastBuild.title")}>
            <div className="overflow-hidden rounded-md border border-edge bg-fill-subtle">
                <button
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpen(value => !value)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left transition-colors hover:bg-fill"
                >
                    <div className="flex min-w-0 items-center gap-2">
                        <ChevronRight
                            className={cn(
                                "h-3.5 w-3.5 shrink-0 text-fg-subtle transition-transform duration-200",
                                open && "rotate-90",
                            )}
                        />
                        {succeeded ? (
                            <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                        ) : (
                            <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
                        )}
                        <span className="truncate text-xs text-fg-muted">
                            {t(run.kind === "patch" ? "build.report.kind.patch" : "build.report.kind.build")}
                        </span>
                        <span className="truncate text-2xs text-fg-subtle">
                            {run.appTagName.trim() || RELEASE_APP_TAG.name}
                        </span>
                    </div>
                    {duration ? (
                        <span className="shrink-0 tabular-nums text-2xs text-fg-subtle">{duration}</span>
                    ) : null}
                </button>
                {open && (
                    <div className="flex flex-col gap-3 border-t border-edge px-3 py-2.5">
                        <StatList>
                            <StatRow
                                label={t("build.report.artifacts")}
                                value={formatNumber(artifacts.length)}
                                {...(measured ? { hint: formatByteSize(totalArtifactBytes(artifacts)) } : {})}
                            />
                            {report ? (
                                <StatRow
                                    label={t("build.report.includedTitle")}
                                    value={formatNumber(report.included.length)}
                                    hint={formatByteSize(report.includedBytes)}
                                />
                            ) : null}
                            {report ? (
                                <StatRow
                                    label={t("build.report.excludedTitle")}
                                    value={formatNumber(report.excluded.length)}
                                    hint={formatByteSize(report.excludedBytes)}
                                />
                            ) : null}
                            {report && report.excludedCharacters.length > 0 ? (
                                <StatRow
                                    label={t("build.report.charactersTitle")}
                                    value={formatNumber(report.excludedCharacters.length)}
                                />
                            ) : null}
                        </StatList>
                        {report ? null : (
                            <p className="text-2xs text-fg-subtle">{t("build.report.wholeLibrary")}</p>
                        )}
                        <div className="flex flex-wrap items-center gap-2">
                            <Button variant="secondary" size="sm" onClick={() => openBuildReportTab(context)}>
                                {t("dashboard.lastBuild.openReport")}
                            </Button>
                            {state.outputDir ? (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() => {
                                        void context.services
                                            .get<BuildService>(Services.Build)
                                            .revealLastOutput();
                                    }}
                                >
                                    <FolderOpen className="h-3.5 w-3.5" />
                                    {t(revealInFileManagerKey())}
                                </Button>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>
        </DashboardSection>
    );
}
