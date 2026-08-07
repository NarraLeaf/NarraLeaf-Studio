import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CaseSensitive, Regex, Replace, WholeWord } from "lucide-react";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { CONTROL_SIZE_CLASS } from "@/lib/components/elements/controlSize";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { Services } from "@/lib/workspace/services/services";
import { SearchService } from "@/lib/workspace/services/search/SearchService";
import { parseSearchQuery } from "@/lib/workspace/services/search/searchIndexModel";
import type { SearchGroup, SearchGroupResult } from "@/lib/workspace/services/search/searchIndexModel";
import { compileMatcher } from "@/lib/workspace/services/search/textMatcher";
import {
    applyStoryReplace,
    planForEdit,
    planStoryReplace,
    type ReplacePlan,
    type StoryReplaceEdit,
} from "@/lib/workspace/services/search/storyReplace";
import { segmentPlainText } from "@/apps/workspace/modules/story/scene-editor/storyFindReplace";
import type { TranslationKey } from "@shared/i18n";
import { SearchBox } from "../assets/components/SearchBox";
import { jumpToSearchTarget } from "./searchJump";

const QUERY_DEBOUNCE_MS = 150;

/** The undo step a replace leaves behind, whether it swept the project or rewrote one row. */
const REPLACE_HISTORY_LABEL = { key: "workspace.history.entry.replaceText" as TranslationKey };

/**
 * An option that is ON, in the accent rather than `ToolbarButton`'s neutral fill - the same
 * treatment the scene find bar gives the same three switches, so they read as one control set.
 */
const ACTIVE_TOGGLE_CLASS = "bg-primary/15 text-primary";

export const SEARCH_GROUP_TITLE_KEYS: Record<SearchGroup, TranslationKey> = {
    scene: "workspace.shell.search.groups.scene" as TranslationKey,
    story: "workspace.shell.search.groups.story" as TranslationKey,
    character: "workspace.shell.search.groups.character" as TranslationKey,
    uiSurface: "workspace.shell.search.groups.uiSurface" as TranslationKey,
    blueprint: "workspace.shell.search.groups.blueprint" as TranslationKey,
    asset: "workspace.shell.search.groups.asset" as TranslationKey,
    storyText: "workspace.shell.search.groups.storyText" as TranslationKey,
    variable: "workspace.shell.search.groups.variable" as TranslationKey,
    uiTextKey: "workspace.shell.search.groups.uiTextKey" as TranslationKey,
    blueprintNode: "workspace.shell.search.groups.blueprintNode" as TranslationKey,
};

/**
 * Render a hit title with every matched range emphasized. Ranges arrive sorted and non-overlapping
 * (see `normalizeRanges`); an empty list means the entry matched through context text only.
 */
export function renderHighlightedText(text: string, ranges: ReadonlyArray<readonly [number, number]>) {
    if (ranges.length === 0) {
        return text;
    }
    const parts: React.ReactNode[] = [];
    let cursor = 0;
    ranges.forEach(([start, end], index) => {
        if (start > cursor) {
            parts.push(text.slice(cursor, start));
        }
        parts.push(
            <span key={index} className="font-semibold text-fg">
                {text.slice(start, end)}
            </span>,
        );
        cursor = end;
    });
    if (cursor < text.length) {
        parts.push(text.slice(cursor));
    }
    return (
        <>
            {parts.map((part, index) => (
                <Fragment key={index}>{part}</Fragment>
            ))}
        </>
    );
}

/** Index a plan by the block each edit belongs to, so a result row can find its own rewrite. */
function editKey(storyId: string, sceneId: string, blockId: string): string {
    return `${storyId}/${sceneId}/${blockId}`;
}

/**
 * Global project search panel (left dock): one input over the whole project index — story prose,
 * variable names, UI text keys — with grouped results and click-to-jump. Entity *names* are quick
 * open's job (Ctrl+P); this panel is for finding content.
 *
 * Groups act as filter chips once more than one kind of thing matched, and each group's trailing
 * count expands it in place. The index itself lives in {@link SearchService}; this panel only
 * queries and renders.
 *
 * # Replace
 *
 * The replace field turns the same query into a project-wide rewrite of story prose, planned by
 * `services/search/storyReplace` and applied as one undo step. Three things about it are load
 * bearing:
 *
 *  - **the button counts occurrences, not rows and not visible rows.** Groups cap at 20 (500
 *    expanded) because the list renders eagerly, and one line can contain the query twice. A button
 *    reading "Replace all 20" over a query that will change 340 things is a number the author acts
 *    on, and it is a lie. It comes from `plan.occurrences`, computed over the uncapped candidate set.
 *  - **planning is opt-in.** Nothing here runs until the author engages the replace field, so an
 *    author who only ever searches pays for nothing.
 *  - **no confirmation dialog.** Undo is the safety net, and it is one press for the whole sweep.
 */
export function SearchPanel() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const freeze = useFreezeGuard();
    const [query, setQuery] = useState("");
    const [building, setBuilding] = useState(true);
    const [results, setResults] = useState<SearchGroupResult[]>([]);
    const [activeGroups, setActiveGroups] = useState<SearchGroup[]>([]);
    const [expandedGroups, setExpandedGroups] = useState<SearchGroup[]>([]);
    const [replacement, setReplacement] = useState("");
    const [caseSensitive, setCaseSensitive] = useState(false);
    const [wholeWord, setWholeWord] = useState(false);
    const [useRegex, setUseRegex] = useState(false);
    /**
     * Whether the author has reached for replace at all.
     *
     * Sticky, and never cleared: planning walks the index and rewrites segments, and doing that on
     * every keystroke of every search - including the searches that were only ever going to be read -
     * is exactly the cost the index's precomputed haystacks exist to avoid. Focusing the field counts,
     * not just typing in it, so replacing a word with nothing stays reachable.
     */
    const [replaceEngaged, setReplaceEngaged] = useState(false);
    const [plan, setPlan] = useState<ReplacePlan | null>(null);
    /** Bumped after a write, so the plan refreshes without waiting for the index rebuild. */
    const [planNonce, setPlanNonce] = useState(0);
    const queryRef = useRef(query);
    queryRef.current = query;
    const expandedRef = useRef(expandedGroups);
    expandedRef.current = expandedGroups;

    const searchService = context ? context.services.get<SearchService>(Services.Search) : null;

    const parsed = useMemo(() => parseSearchQuery(query), [query]);
    const refined = caseSensitive || wholeWord || useRegex;
    /**
     * One matcher per (query, options) change, and never one per row or per entry.
     *
     * It is compiled from `parsed.text` rather than the raw query so that `scene:` and `speaker:`
     * keep narrowing the scope instead of being looked for in the prose.
     */
    const matcher = useMemo(
        () => compileMatcher(parsed.text, { caseSensitive, wholeWord, regex: useRegex }),
        [parsed.text, caseSensitive, wholeWord, useRegex],
    );
    // Only handed to the query when the author asked for refined matching. With all three off this
    // stays undefined and `querySearchIndex` runs the term path it always has.
    const queryMatcherRef = useRef(refined ? matcher : undefined);
    queryMatcherRef.current = refined ? matcher : undefined;

    const runQuery = useCallback(() => {
        if (!searchService) {
            return;
        }
        setResults(searchService.search(queryRef.current, {
            expandedGroups: expandedRef.current,
            matcher: queryMatcherRef.current,
        }));
    }, [searchService]);

    // Build the index on first mount (idempotent), then keep results live as slices rebuild.
    useEffect(() => {
        if (!searchService) {
            return;
        }
        let mounted = true;
        searchService
            .ensureReady()
            .then(() => {
                if (mounted) {
                    setBuilding(false);
                    runQuery();
                }
            })
            .catch(() => {
                if (mounted) {
                    setBuilding(false);
                }
            });
        const unsubscribe = searchService.onIndexChanged(runQuery);
        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [searchService, runQuery]);

    useEffect(() => {
        const timer = setTimeout(runQuery, QUERY_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query, matcher, refined, runQuery]);

    // A new query is a new question: stop carrying the previous one's chips and expansions.
    useEffect(() => {
        setActiveGroups([]);
        setExpandedGroups([]);
    }, [query]);

    /**
     * Plan the replace, on the same debounce the query runs on.
     *
     * `results` is in the dependency list rather than `query`, which is what keeps the plan honest
     * after a write: the index rebuilds, results are re-published, and the plan is recomputed against
     * the document as it now stands.
     */
    useEffect(() => {
        if (!context || !replaceEngaged || !parsed.text) {
            setPlan(null);
            return;
        }
        const timer = setTimeout(() => {
            setPlan(planStoryReplace(context, { matcher, replacement, filters: parsed.filters }));
        }, QUERY_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [context, replaceEngaged, parsed, matcher, replacement, results, planNonce]);

    const handleJump = useCallback(
        (target: Parameters<typeof jumpToSearchTarget>[0]) => {
            jumpToSearchTarget(target, { openEditorTab, setPanelVisibility, context });
        },
        [openEditorTab, setPanelVisibility, context],
    );

    const applyPlan = useCallback(
        (target: ReplacePlan | null) => {
            if (!context || !target) {
                return;
            }
            if (applyStoryReplace(context, target, REPLACE_HISTORY_LABEL)) {
                setPlanNonce(nonce => nonce + 1);
            }
        },
        [context],
    );

    const toggleGroup = useCallback((group: SearchGroup) => {
        setActiveGroups(current =>
            current.includes(group) ? current.filter(name => name !== group) : [...current, group],
        );
    }, []);

    const expandGroup = useCallback((group: SearchGroup) => {
        setExpandedGroups(current => (current.includes(group) ? current : [...current, group]));
    }, []);

    // Expanding re-queries with a higher cap for that group.
    useEffect(() => {
        if (expandedGroups.length > 0) {
            runQuery();
        }
    }, [expandedGroups, runQuery]);

    // Chips reflect everything that matched; the filter is applied to what gets rendered, so the
    // per-group totals stay honest regardless of which chips are on.
    const visibleResults = useMemo(
        () => (activeGroups.length === 0 ? results : results.filter(group => activeGroups.includes(group.group))),
        [results, activeGroups],
    );

    const editsByBlock = useMemo(() => {
        const map = new Map<string, StoryReplaceEdit>();
        for (const edit of plan?.edits ?? []) {
            map.set(editKey(edit.storyId, edit.sceneId, edit.blockId), edit);
        }
        return map;
    }, [plan]);

    const trimmed = query.trim();
    const invalidPattern = matcher.error !== undefined;
    const replaceReady = !!plan && plan.applicable;
    const replaceTitle = plan && !plan.applicable && plan.failures.length > 0
        ? t("workspace.shell.search.replaceStale")
        : t("workspace.shell.search.replaceAll");

    return (
        <div className="flex h-full flex-col">
            <div className="shrink-0 space-y-1.5 px-3 pt-3 pb-2">
                <div className="flex items-center gap-1.5">
                    <SearchBox
                        value={query}
                        onChange={setQuery}
                        placeholder={t("workspace.shell.search.placeholder")}
                        className="min-w-0 flex-1"
                    />
                    <ToolbarButton
                        size="md"
                        onClick={() => setCaseSensitive(value => !value)}
                        title={t("workspace.shell.search.caseSensitive")}
                        aria-label={t("workspace.shell.search.caseSensitive")}
                        aria-pressed={caseSensitive}
                        active={caseSensitive}
                        className={cn(caseSensitive && ACTIVE_TOGGLE_CLASS)}
                    >
                        <CaseSensitive className="h-3.5 w-3.5" />
                    </ToolbarButton>
                    <ToolbarButton
                        size="md"
                        onClick={() => setWholeWord(value => !value)}
                        title={t("workspace.shell.search.wholeWord")}
                        aria-label={t("workspace.shell.search.wholeWord")}
                        aria-pressed={wholeWord}
                        active={wholeWord}
                        className={cn(wholeWord && ACTIVE_TOGGLE_CLASS)}
                    >
                        <WholeWord className="h-3.5 w-3.5" />
                    </ToolbarButton>
                    <ToolbarButton
                        size="md"
                        onClick={() => setUseRegex(value => !value)}
                        title={t("workspace.shell.search.regex")}
                        aria-label={t("workspace.shell.search.regex")}
                        aria-pressed={useRegex}
                        active={useRegex}
                        className={cn(useRegex && ACTIVE_TOGGLE_CLASS)}
                    >
                        <Regex className="h-3.5 w-3.5" />
                    </ToolbarButton>
                </div>
                <div className="flex items-center gap-1.5">
                    <input
                        value={replacement}
                        onChange={event => {
                            setReplaceEngaged(true);
                            setReplacement(event.target.value);
                        }}
                        onFocus={() => setReplaceEngaged(true)}
                        placeholder={t("workspace.shell.search.replacePlaceholder")}
                        aria-label={t("workspace.shell.search.replacePlaceholder")}
                        {...freeze.writes()}
                        className={cn(
                            "min-w-0 flex-1 rounded-md border border-edge bg-fill-subtle text-fg outline-none placeholder:text-fg-subtle",
                            "focus:border-primary disabled:opacity-50 disabled:cursor-not-allowed",
                            CONTROL_SIZE_CLASS.md,
                        )}
                    />
                    <button
                        type="button"
                        onClick={() => applyPlan(plan)}
                        {...freeze.writes(!replaceReady, replaceTitle)}
                        className={cn(
                            "inline-flex shrink-0 items-center justify-center whitespace-nowrap rounded-md",
                            "border border-edge bg-fill-subtle text-fg-muted transition-colors",
                            "hover:bg-fill hover:text-fg disabled:opacity-50 disabled:cursor-not-allowed",
                            CONTROL_SIZE_CLASS.md,
                        )}
                    >
                        {t("workspace.shell.search.replaceAll")}
                        {plan && plan.occurrences > 0 ? (
                            <span className="ml-1.5 tabular-nums text-fg-subtle">{plan.occurrences}</span>
                        ) : null}
                    </button>
                </div>
                {invalidPattern && (
                    <div className="text-2xs text-danger">{t("workspace.shell.search.invalidPattern")}</div>
                )}
            </div>

            {results.length > 1 && (
                <div className="flex shrink-0 flex-wrap gap-1 px-3 pb-2">
                    {results.map(group => {
                        const active = activeGroups.includes(group.group);
                        return (
                            <button
                                key={group.group}
                                type="button"
                                onClick={() => toggleGroup(group.group)}
                                className={`rounded-full border px-2 py-0.5 text-2xs transition-colors ${
                                    active
                                        ? "border-primary/50 bg-primary/10 text-fg"
                                        : "border-edge-subtle text-fg-subtle hover:border-edge hover:text-fg-muted"
                                }`}
                            >
                                {t(SEARCH_GROUP_TITLE_KEYS[group.group])} {group.total}
                            </button>
                        );
                    })}
                </div>
            )}

            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {building ? (
                    <div className="px-3 py-4 text-sm text-fg-subtle">{t("workspace.shell.search.building")}</div>
                ) : trimmed && results.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-fg-subtle">{t("workspace.shell.search.empty")}</div>
                ) : !trimmed ? (
                    // Nothing typed yet. Without this the panel fell through to an empty result list
                    // and painted nothing at all, so the one state the author sees FIRST was the only
                    // one with no words in it.
                    <div className="px-3 py-4 text-sm text-fg-subtle">{t("workspace.shell.search.idle")}</div>
                ) : (
                    visibleResults.map(group => (
                        <div key={group.group}>
                            <div className="px-3 pt-3 pb-1 text-xs font-medium text-fg-muted">
                                {t(SEARCH_GROUP_TITLE_KEYS[group.group])}
                            </div>
                            {group.hits.map(hit => {
                                const target = hit.entry.target;
                                const edit = target.kind === "storyBlock"
                                    ? editsByBlock.get(editKey(target.storyId, target.sceneId, target.blockId))
                                    : undefined;
                                return (
                                    <div key={hit.entry.id} className="group relative">
                                        <button
                                            type="button"
                                            onClick={() => handleJump(hit.entry.target)}
                                            className={cn(
                                                "block w-full px-3 py-1.5 text-left transition-colors hover:bg-fill-subtle",
                                                edit && "pr-10",
                                            )}
                                        >
                                            <div className="flex min-w-0 items-baseline gap-2 text-sm text-fg-muted">
                                                <span className="truncate">
                                                    {renderHighlightedText(hit.entry.text, hit.titleRanges)}
                                                </span>
                                                {edit && (
                                                    <>
                                                        <span className="shrink-0 text-fg-subtle" aria-hidden>→</span>
                                                        <span className="truncate text-fg">
                                                            {segmentPlainText(edit.after).trim()}
                                                        </span>
                                                    </>
                                                )}
                                                {(hit.entry.count ?? 1) > 1 && (
                                                    <span className="shrink-0 text-2xs text-fg-subtle">
                                                        {t("workspace.shell.search.occurrences", { count: hit.entry.count! })}
                                                    </span>
                                                )}
                                            </div>
                                            {hit.entry.detail && (
                                                <div className="truncate text-xs text-fg-subtle">{hit.entry.detail}</div>
                                            )}
                                        </button>
                                        {edit && (
                                            <ToolbarButton
                                                size="sm"
                                                onClick={() => applyPlan(planForEdit(edit))}
                                                aria-label={t("workspace.shell.search.replaceRow")}
                                                {...freeze.writes(false, t("workspace.shell.search.replaceRow"))}
                                                // Centered with `my-auto` between pinned edges rather
                                                // than a translate: narraleaf-react injects a v4
                                                // utility table that kills v3 `transform` classes.
                                                className="absolute inset-y-0 right-2 my-auto opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                                            >
                                                <Replace className="h-3.5 w-3.5" />
                                            </ToolbarButton>
                                        )}
                                    </div>
                                );
                            })}
                            {group.total > group.hits.length && (
                                <button
                                    type="button"
                                    onClick={() => expandGroup(group.group)}
                                    className="block w-full px-3 py-1 text-left text-xs text-fg-subtle transition-colors hover:bg-fill-subtle hover:text-fg-muted"
                                >
                                    {t("workspace.shell.search.more", { count: group.total - group.hits.length })}
                                </button>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
