import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
    ChevronDown,
    ChevronRight,
    ChevronsDownUp,
    ChevronsUpDown,
    CircleHelp,
    CircleX,
    Info,
    Loader2,
    RefreshCw,
    Settings2,
    TriangleAlert,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
    deriveLintRuleSlug,
    resolveLintMessageParams,
    type LintLocation,
    type LintReport,
    type LintReportEntry,
    type LintRuleId,
    type LintSeverity,
} from "@/lib/lint";
import { LintService, type LintServiceState } from "@/lib/workspace/services/core/LintService";
import type { ProjectService } from "@/lib/workspace/services/core/ProjectService";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { Services } from "@/lib/workspace/services/services";
import { Select, type SelectOption } from "@/lib/components/elements/Select";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import { getHelpTopic, lintRuleHelpTopicId, openHelpTopic } from "@/lib/help";
import type { TranslationKey } from "@shared/i18n";
import type { CompiledMatcher } from "@/lib/workspace/services/search/textMatcher";
import { useActiveEditorTab, useEditorTabs, useKeybinding, whenFocused } from "@/apps/workspace/hooks";
import { MarkedText } from "@/apps/workspace/components/ui/FindMarks";
import { TableFindOverlay } from "@/apps/workspace/components/ui/TableFindOverlay";
import { useFindMatches, useFindQuery } from "@/apps/workspace/components/ui/useTableFind";
import type { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { isFreezeExemptCommand } from "../../components/ui/freezeActionPolicy";
import { useFreezeGuard } from "../../components/ui/freezeGuard";
import { jumpToSearchTarget } from "../search/searchJump";
import { openProjectPanel } from "../project";
import { LINT_PROJECT_COMMAND_ID, PROBLEMS_PANEL_ID } from "./lintIds";
import {
    filterLintEntries,
    flattenLintGroups,
    groupLintEntries,
    lintEntryExcerpt,
    lintEntryLocator,
    lintLocationLabel,
    lintRuleDescriptionKey,
    lintRuleTitleKey,
    lintSeverityLabelKey,
    showGroupsWholeForHits,
    unfoldGroupsWithHits,
    LINT_GROUP_MODES,
    LINT_SEVERITY_FILTERS,
    type LintGroupMode,
    type LintSeverityFilter,
} from "./lintReportModel";
import { filterEntriesByScope, PROBLEMS_SCOPES, type ProblemsScope } from "./problemsScope";

const ICON_BUTTON_CLASS = controlButtonClass();

/** Text colour per severity. Info is the accent, as the design system assigns it. */
const SEVERITY_TEXT_CLASS: Record<LintSeverity, string> = {
    error: "text-danger",
    warning: "text-warning",
    info: "text-primary",
};

const SEVERITY_ICON: Record<LintSeverity, typeof CircleX> = {
    error: CircleX,
    warning: TriangleAlert,
    info: Info,
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

const SCOPE_OPTIONS: SelectOption[] = [
    { value: "project", labelKey: "lint.report.scopeProject" as TranslationKey },
    { value: "openEditors", labelKey: "lint.report.scopeOpenEditors" as TranslationKey },
    { value: "activeEditor", labelKey: "lint.report.scopeActiveEditor" as TranslationKey },
];

/** What the panel remembers between sessions: how the reader last chose to look at the list. */
type ProblemsPanelState = {
    scope?: ProblemsScope;
    severityFilter?: LintSeverityFilter;
    groupMode?: LintGroupMode;
};

/** The topic for a rule's `?`, or null while that rule has no topic to open. */
function ruleHelpTopic(ruleId: LintRuleId) {
    const id = lintRuleHelpTopicId(deriveLintRuleSlug(ruleId));
    return getHelpTopic(id) ? id : null;
}

/**
 * The Problems panel: every finding of the project's checks, kept current while the project is
 * edited, in the bottom dock beside the Console.
 *
 * It replaced a report that opened as an editor tab and only ever showed the last sweep somebody
 * asked for. What the shape is defending:
 *
 *  - **The findings are the project's as it is now.** The workspace window keeps the checks running
 *    after every pause in editing (see `LintService.startLive`), so the list follows the author's
 *    edits by itself; re-check is for reading the disk afresh, not for getting an answer at all.
 *    While a check is running or waiting to run, the heading says so beside the counts it is about
 *    to replace - the list is never emptied to wait for the next one.
 *  - **The scope narrows the list, never the check.** "Open editors" and "Current editor" show the
 *    findings about what those tabs show; the sweep behind them still covers the whole project,
 *    because a finding is often about the seam between two things.
 *  - **Every row explains itself.** The rule's name is on the row or on its heading, its
 *    description on the heading's hover, and the `?` on the row (or F1 over it) opens the rule's
 *    topic: what it found, what that does to the game, and what to do.
 *  - **The list is flat and virtualised**, a long group opens short, and severity is said once per
 *    group (see `lintReportModel`) - a real project can produce thousands of findings.
 *  - **An entry without a `target` is not a button**, and a jump that cannot land says so.
 *  - **Re-check stays live while frozen.** The sweep writes nothing; see `freezeActionPolicy`.
 */
export function ProblemsPanel({ panelId = PROBLEMS_PANEL_ID }: Partial<PanelComponentProps>) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const freeze = useFreezeGuard();
    const openTabs = useEditorTabs();
    const { tab: activeTab } = useActiveEditorTab();

    const lintService = useMemo(
        () => (context && isInitialized ? context.services.get<LintService>(Services.Lint) : null),
        [context, isInitialized],
    );
    const panelStateService = useMemo(
        () => context?.services.get<PanelStateService>(Services.PanelState) ?? null,
        [context],
    );

    const [report, setReport] = useState<LintReport | null>(null);
    const [lintState, setLintState] = useState<LintServiceState | null>(null);
    const [scope, setScope] = useState<ProblemsScope>("project");
    const [severityFilter, setSeverityFilter] = useState<LintSeverityFilter>("all");
    const [groupMode, setGroupMode] = useState<LintGroupMode>("rule");
    const [collapsedKeys, setCollapsedKeys] = useState<ReadonlySet<string>>(() => new Set());
    /**
     * The groups the reader has asked to see whole, past the preview the list opens them at.
     * Cleared when a group is folded: unfolding should put the reader back where the list started.
     */
    const [wholeKeys, setWholeKeys] = useState<ReadonlySet<string>>(() => new Set());
    const scrollRef = useRef<HTMLDivElement | null>(null);
    const stateLoadedRef = useRef(false);

    useEffect(() => {
        if (!lintService) {
            return;
        }
        setReport(lintService.getLastReport());
        setLintState(lintService.getState());
        const offReport = lintService.onReportChanged(setReport);
        const offState = lintService.onStateChanged(setLintState);
        return () => {
            offReport();
            offState();
        };
    }, [lintService]);

    useEffect(() => {
        if (!panelStateService) {
            return;
        }
        const stored = panelStateService.getPanelState<ProblemsPanelState>(panelId);
        if (stored?.scope && PROBLEMS_SCOPES.includes(stored.scope)) {
            setScope(stored.scope);
        }
        if (stored?.severityFilter && LINT_SEVERITY_FILTERS.includes(stored.severityFilter)) {
            setSeverityFilter(stored.severityFilter);
        }
        if (stored?.groupMode && LINT_GROUP_MODES.includes(stored.groupMode)) {
            setGroupMode(stored.groupMode);
        }
        stateLoadedRef.current = true;
    }, [panelId, panelStateService]);

    useEffect(() => {
        if (!panelStateService || !stateLoadedRef.current) {
            return;
        }
        panelStateService.setPanelState<ProblemsPanelState>(panelId, { scope, severityFilter, groupMode });
    }, [panelId, panelStateService, scope, severityFilter, groupMode]);

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
        (location: LintLocation) => lintLocationLabel(location, projectName, t),
        [projectName, t],
    );

    const scopedEntries = useMemo(
        () => filterEntriesByScope(report?.entries ?? [], scope, openTabs, activeTab),
        [report, scope, openTabs, activeTab],
    );

    const groups = useMemo(() => {
        const entries = filterLintEntries(scopedEntries, severityFilter);
        return groupLintEntries(entries, groupMode, { ruleTitle, locationLabel });
    }, [scopedEntries, severityFilter, groupMode, ruleTitle, locationLabel]);

    /**
     * Everything a finding shows, as one string for Mod+F: where it is, what it says, the author's
     * own words on the row, and the rule it came from - the rule whichever way the list is grouped,
     * so typing a rule's name finds its findings even when the name is only on a heading.
     */
    const entryHaystack = useCallback((entry: LintReportEntry): string => {
        const message = t(entry.messageKey, resolveLintMessageParams(entry, t, tn));
        const { label, line } = lintEntryLocator(entry.location, groupMode, locationLabel, message);
        return [
            label,
            line === null ? "" : String(line),
            message,
            lintEntryExcerpt(entry.location, t),
            ruleTitle(entry.ruleId),
        ].join("\n");
    }, [t, tn, groupMode, locationLabel, ruleTitle]);

    const findQuery = useFindQuery();

    /** A folded group that holds a hit opens itself while the find runs; the reader's folds stay. */
    const effectiveCollapsed = useMemo(() => {
        const matcher = findQuery.matcher;
        if (!matcher) {
            return collapsedKeys;
        }
        return unfoldGroupsWithHits(groups, collapsedKeys, entry => matcher.test(entryHaystack(entry)));
    }, [collapsedKeys, findQuery.matcher, groups, entryHaystack]);

    /** The same view over the previews: a hit below one opens that group, and only that group. */
    const effectiveWhole = useMemo(() => {
        const matcher = findQuery.matcher;
        if (!matcher) {
            return wholeKeys;
        }
        return showGroupsWholeForHits(groups, wholeKeys, entry => matcher.test(entryHaystack(entry)));
    }, [wholeKeys, findQuery.matcher, groups, entryHaystack]);

    const rows = useMemo(
        () => flattenLintGroups(groups, effectiveCollapsed, effectiveWhole),
        [groups, effectiveCollapsed, effectiveWhole],
    );

    const findItemText = useCallback((index: number): string | null => {
        const row = rows[index];
        return row?.kind === "entry" ? entryHaystack(row.entry) : null;
    }, [rows, entryHaystack]);

    const findUnfilteredTexts = useCallback(
        () => scopedEntries.map(entryHaystack),
        [scopedEntries, entryHaystack],
    );

    const find = useFindMatches(findQuery, {
        itemCount: rows.length,
        getItemText: findItemText,
        getUnfilteredTexts: findUnfilteredTexts,
    });

    useKeybinding({
        id: `problems-find-${panelId}`,
        catalogId: "lint.find",
        key: "mod+f",
        // The panel has no field to type into, so this only ever arrives from the find box itself -
        // which is exactly when it must still work, to pull focus back.
        allowInEditable: true,
        when: whenFocused(FocusArea.BottomPanel, panelId),
        handler: find.openFind,
    });

    const virtualizer = useVirtualizer({
        count: rows.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: index => (rows[index]?.kind === "group" ? GROUP_ROW_HEIGHT_PX : ENTRY_ROW_HEIGHT_PX),
        overscan: 16,
        getItemKey: index => rows[index]?.key ?? index,
    });

    const findActiveIndex = find.activeIndex;
    useEffect(() => {
        if (findActiveIndex !== null) {
            virtualizer.scrollToIndex(findActiveIndex, { align: "center" });
        }
    }, [findActiveIndex, virtualizer]);

    const handleJump = useCallback(
        (entry: LintReportEntry) => {
            if (!entry.target) {
                return;
            }
            const landed = jumpToSearchTarget(entry.target, { openEditorTab, setPanelVisibility, context });
            if (!landed && context) {
                // The thing the finding names has gone since the sweep - deleted, or renamed into
                // something else. Said rather than swallowed: a click that silently does nothing
                // reads as a broken panel. The next check drops the finding.
                context.services.get<UIService>(Services.UI).notifications.info(t("lint.report.jumpFailed"));
            }
        },
        [openEditorTab, setPanelVisibility, context, t],
    );

    const openRuleHelp = useCallback((ruleId: LintRuleId, anchor: HTMLElement | null) => {
        const topic = ruleHelpTopic(ruleId);
        if (topic) {
            openHelpTopic(topic, anchor);
        }
    }, []);

    const toggleGroup = useCallback((key: string) => {
        setCollapsedKeys(previous => {
            const next = new Set(previous);
            if (!next.delete(key)) {
                next.add(key);
            }
            return next;
        });
        setWholeKeys(previous => {
            if (!previous.has(key)) {
                return previous;
            }
            const next = new Set(previous);
            next.delete(key);
            return next;
        });
    }, []);

    const showGroupWhole = useCallback((key: string) => {
        setWholeKeys(previous => new Set(previous).add(key));
    }, []);

    const allCollapsed = groups.length > 0 && groups.every(group => collapsedKeys.has(group.key));
    const toggleAll = useCallback(() => {
        setCollapsedKeys(allCollapsed ? new Set() : new Set(groups.map(group => group.key)));
        setWholeKeys(previous => (previous.size === 0 ? previous : new Set()));
    }, [allCollapsed, groups]);

    const requestedRunning = lintState?.requestedRunning ?? false;
    const pending = lintState?.pending ?? false;
    const rerunFrozenOut = freeze.frozen && !isFreezeExemptCommand(LINT_PROJECT_COMMAND_ID);
    const handleRerun = useCallback(() => {
        void lintService?.run().catch(error => {
            console.warn("[ProblemsPanel] project check failed", error);
        });
    }, [lintService]);

    const openSettings = useCallback(() => {
        if (context) {
            openProjectPanel(context, { section: "project" });
        }
    }, [context]);

    // The counts are the scope's, so the heading always describes the list under it.
    const counts = useMemo(() => {
        const tally = { error: 0, warning: 0, info: 0 };
        for (const entry of scopedEntries) {
            tally[entry.severity] += 1;
        }
        return tally;
    }, [scopedEntries]);

    const headline = !report
        ? (pending ? t("lint.report.running") : "")
        : t("lint.report.counts", {
              errors: tn("common.count.errors", counts.error),
              warnings: tn("common.count.warnings", counts.warning),
              infos: tn("common.count.infos", counts.info),
          });

    /**
     * What stands in for an empty list.
     *
     * "No problems found" is claimed about one situation only: a finished check, nothing waiting to
     * be checked, and nothing narrowing the list. A narrowed list says what narrowed it.
     */
    const placeholder = (() => {
        if (!report) {
            return pending ? t("lint.report.running") : "";
        }
        if (scope !== "project" && scopedEntries.length === 0) {
            return t(scope === "openEditors" ? "lint.report.emptyOpenEditors" : "lint.report.emptyActiveEditor");
        }
        if (report.entries.length === 0) {
            return pending ? t("lint.report.running") : t("lint.report.empty");
        }
        return t("lint.report.emptyFiltered");
    })();

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface" data-help-topic="lint">
            <div className="flex h-9 shrink-0 items-center gap-2 border-b border-edge bg-surface-sunken px-3">
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs text-fg-subtle" aria-live="polite">
                    {pending ? (
                        <Loader2
                            className="h-3 w-3 shrink-0 animate-spin"
                            aria-label={t("lint.report.running")}
                            data-tip={t("lint.report.running")}
                        />
                    ) : null}
                    <span className="truncate">{headline}</span>
                </span>
                <Select
                    size="sm"
                    options={SCOPE_OPTIONS}
                    value={scope}
                    onChange={value => setScope(value as ProblemsScope)}
                    ariaLabel={t("lint.report.scopeAria")}
                    portalMenu
                />
                <Select
                    size="sm"
                    options={SEVERITY_FILTER_OPTIONS}
                    value={severityFilter}
                    onChange={value => setSeverityFilter(value as LintSeverityFilter)}
                    ariaLabel={t("lint.report.severityAria")}
                    portalMenu
                />
                <Select
                    size="sm"
                    options={GROUP_MODE_OPTIONS}
                    value={groupMode}
                    onChange={value => setGroupMode(value as LintGroupMode)}
                    ariaLabel={t("lint.report.groupAria")}
                    portalMenu
                />
                <button
                    type="button"
                    className={ICON_BUTTON_CLASS}
                    aria-label={t(allCollapsed ? "lint.report.expandAll" : "lint.report.collapseAll")}
                    data-tip={t(allCollapsed ? "lint.report.expandAll" : "lint.report.collapseAll")}
                    disabled={groups.length === 0}
                    onClick={toggleAll}
                >
                    {allCollapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />}
                </button>
                <button
                    type="button"
                    className={ICON_BUTTON_CLASS}
                    aria-label={t("lint.report.rerun")}
                    data-tip={t("lint.report.rerunHint")}
                    disabled={requestedRunning || rerunFrozenOut || !lintService}
                    onClick={handleRerun}
                >
                    <RefreshCw className={cn("h-4 w-4", requestedRunning && "animate-spin")} />
                </button>
                <button
                    type="button"
                    className={ICON_BUTTON_CLASS}
                    aria-label={t("lint.report.settings")}
                    data-tip={t("lint.report.settings")}
                    disabled={!context}
                    onClick={openSettings}
                >
                    <Settings2 className="h-4 w-4" />
                </button>
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col">
                {find.open ? (
                    <TableFindOverlay find={find} placeholder={t("lint.report.findPlaceholder")} />
                ) : null}
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
                                        className={cn(
                                            "absolute left-0 top-0 w-full",
                                            // Inset: a ring drawn outside a windowed item overlaps the one above it.
                                            find.activeIndex === item.index && "rounded-md ring-1 ring-inset ring-primary/60",
                                        )}
                                        style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                                    >
                                        {row.kind === "group" ? (
                                            <ProblemGroupRow
                                                title={row.group.title}
                                                count={row.group.entries.length}
                                                severity={row.group.severity}
                                                hint={
                                                    groupMode === "rule"
                                                        ? t(lintRuleDescriptionKey(row.group.key as LintRuleId))
                                                        : ""
                                                }
                                                helpRuleId={
                                                    groupMode === "rule" && ruleHelpTopic(row.group.key as LintRuleId)
                                                        ? (row.group.key as LintRuleId)
                                                        : null
                                                }
                                                onHelp={openRuleHelp}
                                                collapsed={effectiveCollapsed.has(row.group.key)}
                                                onToggle={() => toggleGroup(row.group.key)}
                                            />
                                        ) : row.kind === "more" ? (
                                            <ProblemShowWholeGroupRow
                                                count={row.group.entries.length}
                                                onShow={() => showGroupWhole(row.group.key)}
                                            />
                                        ) : (
                                            <ProblemEntryRow
                                                entry={row.entry}
                                                mode={groupMode}
                                                locationLabel={locationLabel}
                                                // Grouped by location the heading is the place, so the
                                                // trailing column names the rule instead.
                                                secondary={groupMode === "location" ? ruleTitle(row.entry.ruleId) : ""}
                                                showSeverity={groupMode === "rule" && row.group.mixedSeverity}
                                                matcher={find.matcher}
                                                matchActive={find.activeIndex === item.index}
                                                onJump={handleJump}
                                                onHelp={openRuleHelp}
                                            />
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

/**
 * A group heading, and the control that folds it. Grouped by rule it also carries the rule's `?`,
 * since that is where the rule is named.
 */
function ProblemGroupRow({
    title,
    count,
    severity,
    hint,
    helpRuleId,
    onHelp,
    collapsed,
    onToggle,
}: {
    title: string;
    count: number;
    severity: LintSeverity;
    hint: string;
    helpRuleId: LintRuleId | null;
    onHelp: (ruleId: LintRuleId, anchor: HTMLElement | null) => void;
    collapsed: boolean;
    onToggle: () => void;
}) {
    const { t } = useTranslation();
    const Chevron = collapsed ? ChevronRight : ChevronDown;
    return (
        <div
            className="group flex w-full items-center rounded-md hover:bg-fill-subtle"
            data-help-topic={helpRuleId ? lintRuleHelpTopicId(deriveLintRuleSlug(helpRuleId)) : undefined}
        >
            <button
                type="button"
                className="flex min-w-0 flex-1 cursor-default items-center gap-1 px-1 pt-1 text-left"
                aria-expanded={!collapsed}
                data-tip={hint || undefined}
                onClick={onToggle}
            >
                <Chevron className="h-3 w-3 shrink-0 text-fg-subtle" />
                <span className={cn("min-w-0 truncate text-2xs font-semibold", SEVERITY_TEXT_CLASS[severity])}>
                    {title}
                </span>
                <span className="shrink-0 text-2xs text-fg-subtle">{count}</span>
            </button>
            {helpRuleId ? (
                <RuleHelpButton
                    label={t("lint.report.explain")}
                    onClick={event => onHelp(helpRuleId, event.currentTarget)}
                />
            ) : null}
        </div>
    );
}

/** The `?` that opens a rule's topic. Shown on hover or focus of its row, so a long list stays quiet. */
function RuleHelpButton({ label, onClick }: { label: string; onClick: (event: React.MouseEvent<HTMLButtonElement>) => void }) {
    return (
        <button
            type="button"
            className="mr-1 grid h-5 w-5 shrink-0 cursor-default place-items-center rounded-md text-fg-subtle opacity-0 transition-opacity duration-150 hover:bg-fill hover:text-fg focus-visible:opacity-100 group-hover:opacity-100"
            aria-label={label}
            data-tip={label}
            onClick={onClick}
        >
            <CircleHelp className="h-3.5 w-3.5" />
        </button>
    );
}

/**
 * The last row of a group the list opened short. It says the group's whole count - the number on the
 * heading above it - rather than how many are left over.
 */
function ProblemShowWholeGroupRow({ count, onShow }: { count: number; onShow: () => void }) {
    const { t } = useTranslation();
    return (
        <button
            type="button"
            className="flex w-full cursor-default items-baseline gap-2 rounded-md px-2 py-0.5 pl-7 text-left text-2xs text-fg-subtle hover:bg-fill-subtle hover:text-fg-muted"
            onClick={onShow}
        >
            {t("lint.report.showAll", { count })}
        </button>
    );
}

function ProblemEntryRow({
    entry,
    mode,
    locationLabel,
    secondary,
    showSeverity,
    matcher,
    matchActive,
    onJump,
    onHelp,
}: {
    entry: LintReportEntry;
    mode: LintGroupMode;
    locationLabel: (location: LintLocation) => string;
    secondary: string;
    showSeverity: boolean;
    matcher: CompiledMatcher | null;
    matchActive: boolean;
    onJump: (entry: LintReportEntry) => void;
    onHelp: (ruleId: LintRuleId, anchor: HTMLElement | null) => void;
}) {
    const { t, tn } = useTranslation();
    const message = t(entry.messageKey, resolveLintMessageParams(entry, t, tn));
    const excerpt = lintEntryExcerpt(entry.location, t);
    const { label, line } = lintEntryLocator(entry.location, mode, locationLabel, message);
    const helpTopic = ruleHelpTopic(entry.ruleId);
    const SeverityIcon = SEVERITY_ICON[entry.severity];

    const body = (
        <>
            <SeverityIcon
                className={cn("h-3.5 w-3.5 shrink-0 self-center", SEVERITY_TEXT_CLASS[entry.severity])}
                aria-label={t(lintSeverityLabelKey(entry.severity))}
            />
            {mode === "location" ? (
                <span
                    className="w-7 shrink-0 text-right text-2xs tabular-nums text-fg-subtle"
                    aria-label={line === null ? undefined : t("lint.report.lineAria", { line })}
                >
                    {line ?? ""}
                </span>
            ) : (
                <span className="flex min-w-0 max-w-[45%] shrink-0 items-baseline text-2xs text-fg-subtle">
                    <span className="truncate">
                        <MarkedText text={label} matcher={matcher} active={matchActive} />
                    </span>
                    {line === null ? null : (
                        <span className="shrink-0 tabular-nums" aria-label={t("lint.report.lineAria", { line })}>
                            {label ? `:${line}` : line}
                        </span>
                    )}
                </span>
            )}
            {showSeverity ? (
                <span className={cn("shrink-0 text-2xs", SEVERITY_TEXT_CLASS[entry.severity])}>
                    {t(lintSeverityLabelKey(entry.severity))}
                </span>
            ) : null}
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">
                <MarkedText text={message} matcher={matcher} active={matchActive} />
                {excerpt ? (
                    <span className="ml-2 text-fg-subtle">
                        <MarkedText text={excerpt} matcher={matcher} active={matchActive} />
                    </span>
                ) : null}
            </span>
            {secondary ? (
                <span className={cn("max-w-[30%] shrink-0 truncate text-2xs", SEVERITY_TEXT_CLASS[entry.severity])}>
                    <MarkedText text={secondary} matcher={matcher} active={matchActive} />
                </span>
            ) : null}
        </>
    );

    // The full sentence on hover: the message column ellipses, and the part it cuts is the end -
    // which for most rules is the specific half (which label, which locale, which row).
    const hint = excerpt ? `${message} ${excerpt}` : message;
    const rowClass = "flex min-w-0 flex-1 items-baseline gap-2 rounded-md px-2 py-0.5 text-left";

    return (
        <div
            className="group flex w-full items-center rounded-md hover:bg-fill-subtle"
            data-help-topic={helpTopic ?? undefined}
        >
            {entry.target ? (
                <button type="button" className={cn(rowClass, "cursor-default")} data-tip={hint} onClick={() => onJump(entry)}>
                    {body}
                </button>
            ) : (
                <div className={rowClass} data-tip={hint}>
                    {body}
                </div>
            )}
            {helpTopic ? (
                <RuleHelpButton
                    label={t("lint.report.explain")}
                    onClick={event => onHelp(entry.ruleId, event.currentTarget)}
                />
            ) : null}
        </div>
    );
}
