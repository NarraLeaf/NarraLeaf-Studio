import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { useTranslation } from "@/lib/i18n";
import { Services } from "@/lib/workspace/services/services";
import { SearchService } from "@/lib/workspace/services/search/SearchService";
import type { SearchGroup, SearchGroupResult } from "@/lib/workspace/services/search/searchIndexModel";
import type { TranslationKey } from "@shared/i18n";
import { SearchBox } from "../assets/components/SearchBox";
import { jumpToSearchTarget } from "./searchJump";

const QUERY_DEBOUNCE_MS = 150;

const GROUP_TITLE_KEYS: Record<SearchGroup, TranslationKey> = {
    story: "workspace.shell.search.groups.story" as TranslationKey,
    asset: "workspace.shell.search.groups.asset" as TranslationKey,
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

/**
 * Global project search panel (left dock): one input over the whole project index — story prose,
 * variable names, UI text keys — with grouped results and click-to-jump. Entity *names* are quick
 * open's job (Ctrl+P); this panel is for finding content.
 *
 * Groups act as filter chips once more than one kind of thing matched, and each group's trailing
 * count expands it in place. The index itself lives in {@link SearchService}; this panel only
 * queries and renders.
 */
export function SearchPanel() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const [query, setQuery] = useState("");
    const [building, setBuilding] = useState(true);
    const [results, setResults] = useState<SearchGroupResult[]>([]);
    const [activeGroups, setActiveGroups] = useState<SearchGroup[]>([]);
    const [expandedGroups, setExpandedGroups] = useState<SearchGroup[]>([]);
    const queryRef = useRef(query);
    queryRef.current = query;
    const expandedRef = useRef(expandedGroups);
    expandedRef.current = expandedGroups;

    const searchService = context ? context.services.get<SearchService>(Services.Search) : null;

    const runQuery = useCallback(() => {
        if (!searchService) {
            return;
        }
        setResults(searchService.search(queryRef.current, { expandedGroups: expandedRef.current }));
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
    }, [query, runQuery]);

    // A new query is a new question: stop carrying the previous one's chips and expansions.
    useEffect(() => {
        setActiveGroups([]);
        setExpandedGroups([]);
    }, [query]);

    const handleJump = useCallback(
        (target: Parameters<typeof jumpToSearchTarget>[0]) => {
            jumpToSearchTarget(target, { openEditorTab, setPanelVisibility, context });
        },
        [openEditorTab, setPanelVisibility, context],
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

    const trimmed = query.trim();

    return (
        <div className="flex h-full flex-col">
            <div className="shrink-0 px-3 pt-3 pb-2">
                <SearchBox
                    value={query}
                    onChange={setQuery}
                    placeholder={t("workspace.shell.search.placeholder")}
                    className="w-full"
                />
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
                                {t(GROUP_TITLE_KEYS[group.group])} {group.total}
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
                ) : (
                    visibleResults.map(group => (
                        <div key={group.group}>
                            <div className="px-3 pt-3 pb-1 text-xs font-medium text-fg-muted">
                                {t(GROUP_TITLE_KEYS[group.group])}
                            </div>
                            {group.hits.map(hit => (
                                <button
                                    key={hit.entry.id}
                                    type="button"
                                    onClick={() => handleJump(hit.entry.target)}
                                    className="block w-full px-3 py-1.5 text-left transition-colors hover:bg-fill-subtle"
                                >
                                    <div className="truncate text-sm text-fg-muted">
                                        {renderHighlightedText(hit.entry.text, hit.titleRanges)}
                                    </div>
                                    {hit.entry.detail && (
                                        <div className="truncate text-xs text-fg-subtle">{hit.entry.detail}</div>
                                    )}
                                </button>
                            ))}
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
