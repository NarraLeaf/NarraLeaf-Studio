import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { LintLocation, LintReport, LintReportEntry, LintRuleId, LintSeverity } from "@/lib/lint";
import { LintService } from "@/lib/workspace/services/core/LintService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { Services } from "@/lib/workspace/services/services";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { isFreezeExemptCommand } from "../../components/ui/freezeActionPolicy";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { jumpToSearchTarget } from "../search/searchJump";
import { LINT_PROJECT_COMMAND_ID } from "./lintIds";
import { isLintRunning, runProjectLint, subscribeLintRunning } from "./lintRunController";
import {
    filterLintEntries,
    flattenLintGroups,
    groupLintEntries,
    lintLocationLabel,
    lintRuleTitleKey,
    lintSeverityLabelKey,
    type LintGroupMode,
    type LintSeverityFilter,
} from "./lintReportModel";

const ICON_BUTTON_CLASS = controlButtonClass();

/** Same three colours the blueprint problems list uses; severity is never a pill of its own. */
const SEVERITY_TEXT_CLASS: Record<LintSeverity, string> = {
    error: "text-danger",
    warning: "text-warning",
    info: "text-fg-muted",
};

const GROUP_ROW_HEIGHT_PX = 26;
const ENTRY_ROW_HEIGHT_PX = 24;

const SEVERITY_FILTER_OPTIONS: SelectOption[] = [
    { value: "all", labelKey: "lint.report.filterAll" as TranslationKey },
    { value: "error", labelKey: "lint.severity.error" as TranslationKey },
    { value: "warning", labelKey: "lint.severity.warning" as TranslationKey },
    { value: "info", labelKey: "lint.severity.info" as TranslationKey },
];

const GROUP_MODE_OPTIONS: SelectOption[] = [
    { value: "rule", labelKey: "lint.report.groupByRule" as TranslationKey },
    { value: "location", labelKey: "lint.report.groupByLocation" as TranslationKey },
];

/**
 * The project lint report (ruling R6).
 *
 * One control row over one windowed list, and nothing else. What the shape is defending:
 *
 *  - **The list is flat and virtualised.** A sweep of a real VN produces thousands of findings -
 *    `localization/missing` alone is one per line per target locale - and a report that took a
 *    second to open would be a report nobody runs. Headings are rows in the same sequence, because
 *    a virtualiser can only window one flat list (see `flattenLintGroups`).
 *  - **Running is a state of its own.** Mid-sweep the header says so rather than showing the
 *    previous report's summary, and "no problems found" is only ever shown about a run that
 *    finished - a stale clean bill is the one wrong answer this tab could give.
 *  - **An entry without a `target` is not a button.** Most findings deep-link through
 *    {@link jumpToSearchTarget}; the ones that cannot (a whole-project finding, an asset with no
 *    preview) must not offer a click that does nothing.
 *  - **Re-run stays live while frozen.** The sweep writes nothing and the exemption table says so;
 *    see `freezeActionPolicy`.
 */
export function LintReportTab() {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const freeze = useFreezeGuard();

    const lintService = useMemo(
        () => (context && isInitialized ? context.services.get<LintService>(Services.Lint) : null),
        [context, isInitialized],
    );

    const [report, setReport] = useState<LintReport | null>(null);
    const [running, setRunning] = useState(false);
    const [severityFilter, setSeverityFilter] = useState<LintSeverityFilter>("all");
    const [groupMode, setGroupMode] = useState<LintGroupMode>("rule");
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!lintService) {
            return;
        }
        setReport(lintService.getLastReport());
        return lintService.onReportChanged(setReport);
    }, [lintService]);

    useEffect(() => {
        setRunning(isLintRunning());
        return subscribeLintRunning(setRunning);
    }, []);

    /** What a project-scope finding is filed under - the project's own name, not the word for it. */
    const projectName = useMemo(() => {
        if (!context || !isInitialized) {
            return "";
        }
        try {
            return context.services.get<ProjectService>(Services.Project).getProjectConfig().name ?? "";
        } catch {
            return "";
        }
    }, [context, isInitialized]);

    const ruleTitle = useCallback((ruleId: LintRuleId) => t(lintRuleTitleKey(ruleId)), [t]);
    const locationLabel = useCallback(
        (location: LintLocation) => lintLocationLabel(location, projectName),
        [projectName],
    );

    const rows = useMemo(() => {
        const entries = filterLintEntries(report?.entries ?? [], severityFilter);
        return flattenLintGroups(groupLintEntries(entries, groupMode, { ruleTitle, locationLabel }));
    }, [report, severityFilter, groupMode, ruleTitle, locationLabel]);

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: index => (rows[index]?.kind === "group" ? GROUP_ROW_HEIGHT_PX : ENTRY_ROW_HEIGHT_PX),
        overscan: 16,
        getItemKey: index => rows[index]?.key ?? index,
    });

    const handleJump = useCallback(
        (entry: LintReportEntry) => {
            if (!entry.target) {
                return;
            }
            jumpToSearchTarget(entry.target, { openEditorTab, setPanelVisibility, context });
        },
        [openEditorTab, setPanelVisibility, context],
    );

    const rerunFrozenOut = freeze.frozen && !isFreezeExemptCommand(LINT_PROJECT_COMMAND_ID);
    const handleRerun = useCallback(() => {
        if (!context) {
            return;
        }
        void runProjectLint(context).catch(error => {
            console.warn("[LintReportTab] project lint failed", error);
        });
    }, [context]);

    const counts = report?.counts;
    const headline = running
        ? t("lint.report.running")
        : counts
          ? t("lint.report.summary", {
                errors: counts.error,
                warnings: counts.warning,
                infos: counts.info,
            })
          : "";

    /**
     * What stands in for an empty list, and when nothing does.
     *
     * "No problems found" is claimed about exactly one situation: a finished sweep that found
     * nothing. Not while one is running, not before the first one, and not when the severity filter
     * is what emptied the list - in those the pane is simply blank, because the header and the
     * filter already say which of them it is.
     */
    const placeholder = running
        ? t("lint.report.running")
        : report && report.entries.length === 0
          ? t("lint.report.empty")
          : "";

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface" data-help-topic="lint">
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{headline}</span>
                <Select
                    size="sm"
                    options={SEVERITY_FILTER_OPTIONS}
                    value={severityFilter}
                    onChange={value => setSeverityFilter(value as LintSeverityFilter)}
                    portalMenu
                />
                <Select
                    size="sm"
                    options={GROUP_MODE_OPTIONS}
                    value={groupMode}
                    onChange={value => setGroupMode(value as LintGroupMode)}
                    portalMenu
                />
                <button
                    type="button"
                    className={ICON_BUTTON_CLASS}
                    aria-label={t("lint.report.rerun")}
                    disabled={running || rerunFrozenOut || !context}
                    onClick={handleRerun}
                >
                    <RefreshCw className={cn("h-4 w-4", running && "animate-spin")} />
                </button>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
                {rows.length === 0 ? (
                    placeholder ? <p className="px-1 py-1 text-xs text-fg-subtle">{placeholder}</p> : null
                ) : (
                    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                        {virtualizer.getVirtualItems().map(item => {
                            const row = rows[item.index];
                            if (!row) {
                                return null;
                            }
                            return (
                                <div
                                    key={item.key}
                                    className="absolute left-0 top-0 w-full"
                                    style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                                >
                                    {row.kind === "group" ? (
                                        <div className="flex items-baseline gap-2 px-1 pt-1">
                                            <span
                                                className={cn(
                                                    "min-w-0 truncate text-2xs font-semibold",
                                                    SEVERITY_TEXT_CLASS[row.group.severity],
                                                )}
                                            >
                                                {row.group.title}
                                            </span>
                                            <span className="shrink-0 text-2xs text-fg-subtle">
                                                {row.group.entries.length}
                                            </span>
                                        </div>
                                    ) : (
                                        <LintEntryRow
                                            entry={row.entry}
                                            secondary={
                                                groupMode === "rule"
                                                    ? locationLabel(row.entry.location)
                                                    : ruleTitle(row.entry.ruleId)
                                            }
                                            onJump={handleJump}
                                        />
                                    )}
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function LintEntryRow({
    entry,
    secondary,
    onJump,
}: {
    entry: LintReportEntry;
    secondary: string;
    onJump: (entry: LintReportEntry) => void;
}) {
    const { t } = useTranslation();
    const message = t(entry.messageKey, entry.messageParams);
    const body = (
        <>
            <span className={cn("shrink-0 text-2xs", SEVERITY_TEXT_CLASS[entry.severity])}>
                {t(lintSeverityLabelKey(entry.severity))}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{message}</span>
            {secondary ? (
                <span className="max-w-[40%] shrink-0 truncate text-2xs text-fg-subtle">{secondary}</span>
            ) : null}
        </>
    );

    if (!entry.target) {
        return <div className="flex w-full items-baseline gap-2 rounded-md px-2 py-0.5 text-left">{body}</div>;
    }
    return (
        <button
            type="button"
            className="flex w-full cursor-default items-baseline gap-2 rounded-md px-2 py-0.5 text-left hover:bg-fill-subtle"
            onClick={() => onJump(entry)}
        >
            {body}
        </button>
    );
}
