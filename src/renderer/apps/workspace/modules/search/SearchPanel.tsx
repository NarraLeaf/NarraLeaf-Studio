import { useCallback, useEffect, useRef, useState } from "react";
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

/** Render a hit title with the matched range emphasized (range is null for detail-only hits). */
export function renderHighlightedText(text: string, range: [number, number] | null) {
    if (!range) {
        return text;
    }
    const [start, end] = range;
    return (
        <>
            {text.slice(0, start)}
            <span className="font-semibold text-fg">{text.slice(start, end)}</span>
            {text.slice(end)}
        </>
    );
}

/**
 * Global project search panel (left dock): one input over the whole project index — story prose,
 * variable names, UI text keys, blueprint node titles — with grouped results and click-to-jump.
 * The index itself lives in {@link SearchService}; this panel only queries and renders.
 */
export function SearchPanel() {
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();
    const [query, setQuery] = useState("");
    const [building, setBuilding] = useState(true);
    const [results, setResults] = useState<SearchGroupResult[]>([]);
    const queryRef = useRef(query);
    queryRef.current = query;

    const searchService = context ? context.services.get<SearchService>(Services.Search) : null;

    const runQuery = useCallback(() => {
        if (!searchService) {
            return;
        }
        setResults(searchService.search(queryRef.current));
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

    const handleJump = useCallback(
        (target: Parameters<typeof jumpToSearchTarget>[0]) => {
            jumpToSearchTarget(target, { openEditorTab, setPanelVisibility, context });
        },
        [openEditorTab, setPanelVisibility, context],
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

            <div className="min-h-0 flex-1 overflow-y-auto pb-2">
                {building ? (
                    <div className="px-3 py-4 text-sm text-fg-subtle">{t("workspace.shell.search.building")}</div>
                ) : trimmed && results.length === 0 ? (
                    <div className="px-3 py-4 text-sm text-fg-subtle">{t("workspace.shell.search.empty")}</div>
                ) : (
                    results.map(group => (
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
                                        {renderHighlightedText(hit.entry.text, hit.titleRange)}
                                    </div>
                                    {hit.entry.detail && (
                                        <div className="truncate text-xs text-fg-subtle">{hit.entry.detail}</div>
                                    )}
                                </button>
                            ))}
                            {group.total > group.hits.length && (
                                <div className="px-3 py-1 text-xs text-fg-subtle">
                                    {t("workspace.shell.search.more", { count: group.total - group.hits.length })}
                                </div>
                            )}
                        </div>
                    ))
                )}
            </div>
        </div>
    );
}
