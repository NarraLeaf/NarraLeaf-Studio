import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, ChevronRight, XCircle } from "lucide-react";
import { createEmptyProjectStats, type BuildActivityRecord, type ProjectStatsV1 } from "@shared/types/stats";
import {
    DASHBOARD_OPEN_DEFAULT_KEY,
    getDashboardOpenProjectKey,
    resolveDashboardOpen,
} from "@shared/constants/dashboard";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { GlobalSettingsService } from "@/lib/workspace/services/GlobalSettingsService";
import type { ProjectStatsService } from "@/lib/workspace/services/stats/ProjectStatsService";
import {
    computeProjectStatsSnapshot,
    type LocaleProgressStat,
    type ProjectStatsSnapshot,
} from "@/lib/workspace/stats/projectStatsSnapshot";
import { Button, Switch } from "@/lib/components/elements";
import { cn } from "@/lib/utils/cn";
import { getInterface } from "@/lib/app/bridge";
import { useTranslation } from "@/lib/i18n";
import { useWorkspace } from "../../context";
import { DashboardSection, StatTile } from "./DashboardPrimitives";
import { WritingActivityChart } from "./WritingActivityChart";
import {
    buildActivityTimeline,
    computeWritingStreak,
    formatActiveTime,
    formatBuildDuration,
    formatGreeting,
    formatRelativeTime,
    getActivityWindow,
    summarizeActivityWindow,
} from "./dashboardModel";

const BUILD_HISTORY_LIMIT = 8;

function useProjectStats(statsService: ProjectStatsService | null): ProjectStatsV1 {
    const [stats, setStats] = useState<ProjectStatsV1>(
        () => statsService?.getStats() ?? createEmptyProjectStats(),
    );

    useEffect(() => {
        if (!statsService) {
            return;
        }
        // The service mutates its record in place and emits the same reference, so a plain
        // `setStats(next)` would be a no-op bail-out. Shallow-cloning is what makes the push land.
        setStats({ ...statsService.getStats() });
        return statsService.onChanged(next => setStats({ ...next }));
    }, [statsService]);

    return stats;
}

/**
 * One build, expanding to the console output that build produced. The log is archived text, not
 * live console state — it is printed back verbatim and never re-filtered or re-styled, so a plain
 * read-only code block is the whole of it.
 */
function BuildRow({ build, now }: { build: BuildActivityRecord; now: number }) {
    const translator = useTranslation();
    const { t, formatNumber } = translator;
    const [open, setOpen] = useState(false);

    return (
        <li className="overflow-hidden rounded-md border border-edge bg-fill-subtle">
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
                    {build.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0 text-success" />
                    ) : (
                        <XCircle className="h-3.5 w-3.5 shrink-0 text-danger" />
                    )}
                    <span className="truncate text-xs text-fg-muted">
                        {build.ok ? t("dashboard.builds.ok") : t("dashboard.builds.failed")}
                    </span>
                    {build.platform && <span className="truncate text-2xs text-fg-subtle">{build.platform}</span>}
                </div>
                <div className="flex shrink-0 items-center gap-3 text-2xs tabular-nums text-fg-subtle">
                    <span>{formatBuildDuration(translator, build.durationMs)}</span>
                    <span>{formatRelativeTime(translator, build.finishedAt, now)}</span>
                </div>
            </button>
            {open && (
                <div className="flex flex-col gap-1 border-t border-edge px-3 py-2">
                    {build.logOmittedLines ? (
                        <span className="text-2xs text-fg-subtle">
                            {t("dashboard.builds.logOmitted", { count: formatNumber(build.logOmittedLines) })}
                        </span>
                    ) : null}
                    {build.log?.length ? (
                        /* Wraps rather than scrolls sideways: the dashboard column is narrow, and a
                           build's payload — the error, the artifact path — is at the end of the line. */
                        <pre className="max-h-72 select-text overflow-y-auto whitespace-pre-wrap break-words rounded border border-edge bg-surface px-2.5 py-2 font-mono text-2xs leading-5 text-fg-muted">
                            {build.log.join("\n")}
                        </pre>
                    ) : (
                        <span className="text-2xs text-fg-subtle">{t("dashboard.builds.logEmpty")}</span>
                    )}
                </div>
            )}
        </li>
    );
}

function LocaleProgressRow({ stat }: { stat: LocaleProgressStat }) {
    const { t, formatNumber } = useTranslation();

    const total = Math.max(0, stat.total);
    const reviewed = Math.min(Math.max(0, stat.reviewed), total);
    const translated = Math.min(Math.max(0, stat.completed - reviewed), Math.max(0, total - reviewed));
    const untranslated = Math.max(0, total - reviewed - translated);
    const toPercent = (value: number) => (total > 0 ? (value / total) * 100 : 0);

    return (
        <li className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate text-xs text-fg-muted">{stat.locale}</span>
                <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">
                    {t("dashboard.localization.summary", {
                        completed: formatNumber(reviewed + translated),
                        total: formatNumber(total),
                    })}
                </span>
            </div>
            <div className="flex h-1.5 overflow-hidden rounded-full bg-fill">
                <div className="h-full bg-primary" style={{ width: `${toPercent(reviewed)}%` }} />
                <div className="h-full bg-primary/45" style={{ width: `${toPercent(translated)}%` }} />
            </div>
            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-2xs text-fg-subtle">
                <span>
                    {t("dashboard.localization.reviewed")} {formatNumber(reviewed)}
                </span>
                <span>
                    {t("dashboard.localization.translated")} {formatNumber(translated)}
                </span>
                <span>
                    {t("dashboard.localization.untranslated")} {formatNumber(untranslated)}
                </span>
            </div>
        </li>
    );
}

export function DashboardTab({ active }: EditorTabComponentProps) {
    const { context } = useWorkspace();
    const translator = useTranslation();
    const { t, tn, formatNumber } = translator;

    const [snapshot, setSnapshot] = useState<ProjectStatsSnapshot | null>(null);
    const [failed, setFailed] = useState(false);
    const requestRef = useRef(0);

    const statsService = useMemo(() => {
        try {
            return context?.services.get<ProjectStatsService>(Services.ProjectStats) ?? null;
        } catch {
            return null;
        }
    }, [context]);
    const stats = useProjectStats(statsService);

    const projectName = useMemo(() => {
        try {
            return context?.services.get<ProjectService>(Services.Project).getProjectConfig().name ?? "";
        } catch {
            return "";
        }
    }, [context]);

    const projectKey = useMemo(() => {
        if (!context) {
            return null;
        }
        try {
            return getDashboardOpenProjectKey({
                projectPath: context.project.getConfig().projectPath,
                projectIdentifier: context.services
                    .get<ProjectService>(Services.Project)
                    .getProjectConfig().identifier,
            });
        } catch {
            return null;
        }
    }, [context]);

    const refresh = useCallback(() => {
        if (!context) {
            return;
        }
        const requestId = ++requestRef.current;
        setFailed(false);
        void computeProjectStatsSnapshot(context)
            .then(next => {
                if (requestRef.current === requestId) {
                    setSnapshot(next);
                }
            })
            .catch(error => {
                console.warn("[Dashboard] Failed to compute project snapshot", error);
                if (requestRef.current === requestId) {
                    setFailed(true);
                }
            });
    }, [context]);

    // The snapshot walks every story, so it is recomputed only while the tab is on screen. Editor
    // tabs are keep-alive: a hidden dashboard stays mounted, and must not pay for a scan nobody is
    // looking at. Re-running on the false -> true edge is what keeps a re-shown tab current.
    useEffect(() => {
        if (!active) {
            return;
        }
        refresh();
    }, [active, refresh]);

    const now = Date.now();
    // `active` is a dependency so re-entering the tab re-anchors the curve on today: a workspace
    // left open across midnight would otherwise keep plotting against the day it was opened.
    const timeline = useMemo(() => buildActivityTimeline(stats, Date.now()), [stats, active]);
    const windowPoints = useMemo(() => getActivityWindow(timeline), [timeline]);
    const summary = useMemo(() => summarizeActivityWindow(windowPoints), [windowPoints]);
    const streak = useMemo(() => computeWritingStreak(timeline), [timeline]);
    const hasCurve = windowPoints.some(point => point.status === "tracked" && (point.delta ?? 0) > 0);

    const recentBuilds = useMemo(
        () => [...stats.builds].sort((a, b) => b.finishedAt - a.finishedAt).slice(0, BUILD_HISTORY_LIMIT),
        [stats],
    );

    const handleClear = useCallback(() => {
        if (!context || !statsService) {
            return;
        }
        void (async () => {
            try {
                const uiService = context.services.get<UIService>(Services.UI);
                const confirmed = await uiService.dialogs.confirm(
                    t("dashboard.footer.clearConfirm"),
                    t("dashboard.footer.clearDetail"),
                );
                if (confirmed) {
                    await statsService.clear();
                }
            } catch (error) {
                console.warn("[Dashboard] Failed to clear project statistics", error);
            }
        })();
    }, [context, statsService, t]);

    const [openOnWorkspaceOpen, setOpenOnWorkspaceOpen] = useState(true);
    const settingsService = useMemo(() => {
        try {
            return context?.services.get<GlobalSettingsService>(Services.GlobalSettings) ?? null;
        } catch {
            return null;
        }
    }, [context]);

    useEffect(() => {
        if (!settingsService || !projectKey) {
            return;
        }
        let cancelled = false;
        void Promise.all([
            settingsService.get<boolean>(projectKey),
            settingsService.get<boolean>(DASHBOARD_OPEN_DEFAULT_KEY, true),
        ])
            .then(([projectChoice, globalDefault]) => {
                if (!cancelled) {
                    setOpenOnWorkspaceOpen(resolveDashboardOpen(projectChoice, globalDefault));
                }
            })
            .catch(() => undefined);

        // Until this project has a choice of its own it shows the global default, which the
        // Settings window can change from another window — so follow that too, rather than
        // displaying a stale default until the workspace restarts.
        const token = getInterface().app.state.onGlobalStateChanged?.(change => {
            if (cancelled) {
                return;
            }
            if (change.key === projectKey) {
                setOpenOnWorkspaceOpen(change.value !== false);
                return;
            }
            if (change.key === DASHBOARD_OPEN_DEFAULT_KEY && !settingsService.has(projectKey)) {
                setOpenOnWorkspaceOpen(change.value !== false);
            }
        });

        return () => {
            cancelled = true;
            token?.cancel();
        };
    }, [settingsService, projectKey]);

    const handleToggleOpenOnWorkspaceOpen = useCallback(
        (checked: boolean) => {
            if (!projectKey) {
                return;
            }
            setOpenOnWorkspaceOpen(checked);
            void settingsService?.set(projectKey, checked).catch(error => {
                console.warn("[Dashboard] Failed to persist setting", error);
            });
        },
        [projectKey, settingsService],
    );

    const scale = snapshot?.scale;
    const structure = snapshot?.structure;
    const localization = snapshot?.localization ?? [];
    const variableCount = scale ? scale.variables.scene + scale.variables.saved + scale.variables.persistent : 0;

    return (
        <div className="h-full overflow-y-auto overflow-x-hidden bg-surface">
            <div className="mx-auto flex max-w-4xl flex-col gap-8 px-6 py-6">
                <header className="flex flex-col gap-1">
                    <h1 className="truncate text-xl font-medium text-fg">
                        {formatGreeting(translator, now)}
                    </h1>
                    <p className="truncate text-sm text-fg-muted">{projectName}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-2xs text-fg-subtle">
                        <span>
                            {t("dashboard.header.lastActive")}{" "}
                            {stats.lastActiveAt
                                ? formatRelativeTime(translator, stats.lastActiveAt, now)
                                : t("dashboard.header.never")}
                        </span>
                        <span>
                            {t("dashboard.header.trackedSince")}{" "}
                            {stats.firstSeenAt
                                ? translator.formatDate(stats.firstSeenAt, {
                                      year: "numeric",
                                      month: "short",
                                      day: "numeric",
                                  })
                                : t("dashboard.header.never")}
                        </span>
                    </div>
                </header>

                {failed && (
                    <div className="flex items-center justify-between gap-3 rounded-md border border-edge bg-fill-subtle px-3 py-2">
                        <span className="text-xs text-fg-muted">{t("dashboard.failed")}</span>
                        <Button size="sm" variant="secondary" onClick={refresh}>
                            {t("dashboard.retry")}
                        </Button>
                    </div>
                )}

                <DashboardSection title={t("dashboard.scale.title")}>
                    {scale ? (
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <StatTile label={t("dashboard.scale.scenes")} value={formatNumber(scale.scenes)} />
                            <StatTile
                                label={t("dashboard.scale.dialogueLines")}
                                value={formatNumber(scale.dialogueLines)}
                            />
                            <StatTile label={t("dashboard.scale.totalWords")} value={formatNumber(scale.totalWords)} />
                            <StatTile label={t("dashboard.scale.characters")} value={formatNumber(scale.characters)} />
                            <StatTile label={t("dashboard.scale.assets")} value={formatNumber(scale.assets)} />
                            <StatTile
                                label={t("dashboard.scale.blueprints")}
                                value={formatNumber(scale.blueprints)}
                                hint={tn("dashboard.units.nodes", scale.blueprintNodes, {
                                    count: scale.blueprintNodes,
                                })}
                            />
                            <StatTile label={t("dashboard.scale.uiSurfaces")} value={formatNumber(scale.uiSurfaces)} />
                            <StatTile label={t("dashboard.scale.variables")} value={formatNumber(variableCount)} />
                        </div>
                    ) : (
                        <p className="text-xs text-fg-subtle">{failed ? t("dashboard.failed") : t("dashboard.loading")}</p>
                    )}
                </DashboardSection>

                <DashboardSection title={t("dashboard.activity.title")} description={t("dashboard.activity.description")}>
                    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                        <StatTile
                            label={t("dashboard.activity.wordsWritten")}
                            value={formatNumber(summary.wordsWritten)}
                        />
                        <StatTile
                            label={t("dashboard.activity.activeTime")}
                            value={formatActiveTime(translator, summary.activeSeconds)}
                        />
                        <StatTile label={t("dashboard.activity.edits")} value={formatNumber(summary.edits)} />
                        <StatTile
                            label={t("dashboard.activity.streak")}
                            value={
                                streak > 0
                                    ? tn("dashboard.units.days", streak, { count: streak })
                                    : t("dashboard.activity.streakNone")
                            }
                        />
                    </div>
                    <WritingActivityChart points={windowPoints} peak={summary.peakDelta} />
                    {!hasCurve && <p className="text-2xs text-fg-subtle">{t("dashboard.activity.empty")}</p>}
                </DashboardSection>

                <DashboardSection title={t("dashboard.builds.title")}>
                    {recentBuilds.length > 0 ? (
                        <ul className="flex flex-col gap-1.5">
                            {recentBuilds.map(build => (
                                <BuildRow key={`${build.startedAt}-${build.finishedAt}`} build={build} now={now} />
                            ))}
                        </ul>
                    ) : (
                        <div className="flex flex-col gap-0.5">
                            <p className="text-xs text-fg-muted">{t("dashboard.builds.empty")}</p>
                            <p className="text-2xs text-fg-subtle">{t("dashboard.builds.emptyHint")}</p>
                        </div>
                    )}
                </DashboardSection>

                {structure && (
                    <DashboardSection title={t("dashboard.structure.title")}>
                        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                            <StatTile
                                label={t("dashboard.structure.chapters")}
                                value={formatNumber(scale?.chapters ?? 0)}
                            />
                            <StatTile label={t("dashboard.structure.branches")} value={formatNumber(structure.branches)} />
                        </div>
                    </DashboardSection>
                )}

                {localization.length > 0 && (
                    <DashboardSection title={t("dashboard.localization.title")}>
                        <ul className="flex flex-col gap-3">
                            {localization.map(stat => (
                                <LocaleProgressRow key={stat.locale} stat={stat} />
                            ))}
                        </ul>
                    </DashboardSection>
                )}

                <footer className="flex flex-col gap-3 border-t border-edge pt-5">
                    <label className="flex items-center justify-between gap-4">
                        <span className="text-xs text-fg-muted">{t("dashboard.footer.openOnWorkspaceOpen")}</span>
                        <Switch
                            size="sm"
                            checked={openOnWorkspaceOpen}
                            onCheckedChange={handleToggleOpenOnWorkspaceOpen}
                        />
                    </label>
                    <div className="flex justify-start">
                        <Button size="sm" variant="danger" onClick={handleClear} disabled={!statsService}>
                            {t("dashboard.footer.clear")}
                        </Button>
                    </div>
                </footer>
            </div>
        </div>
    );
}
