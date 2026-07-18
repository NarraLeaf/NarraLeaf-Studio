import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../../context";
import { useKeybinding } from "../../hooks";
import { useRegistry } from "../../registry";
import { Services } from "@/lib/workspace/services/services";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { SearchService } from "@/lib/workspace/services/search/SearchService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { formatKeybinding } from "@/lib/workspace/services/ui/KeybindingService";
import { isMacPlatform } from "@/lib/app/platform";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import { QuickSwitchOverlay, type QuickListRow } from "./QuickSwitchOverlay";
import { clampIndex, rankFuzzyList, wrapIndex } from "./fuzzyListModel";
import { buildEditorQuickSwitchOrder } from "./editorQuickSwitchModel";
import { publishCommandPaletteSession, registerCommandPaletteBridge } from "./commandPaletteController";
import type { PaletteCommand } from "./commandPaletteModel";
import type { SearchGroup, SearchHit } from "@/lib/workspace/services/search/searchIndexModel";
import { jumpToSearchTarget } from "../../modules/search/searchJump";
import { renderHighlightedText } from "../../modules/search/SearchPanel";

/** VSCode-style mode prefix: a leading `>` means "commands"; anything else is a project search. */
const COMMAND_PREFIX = ">";

const SEARCH_GROUP_TITLE_KEYS: Record<SearchGroup, TranslationKey> = {
    story: "workspace.shell.search.groups.story" as TranslationKey,
    asset: "workspace.shell.search.groups.asset" as TranslationKey,
    variable: "workspace.shell.search.groups.variable" as TranslationKey,
    uiTextKey: "workspace.shell.search.groups.uiTextKey" as TranslationKey,
    blueprintNode: "workspace.shell.search.groups.blueprintNode" as TranslationKey,
};

/**
 * Render a command title with the fuzzy-matched characters emphasized. `positions` are indices
 * into `title` (from `rankFuzzyList`); an empty array (e.g. a category-only match) renders plainly.
 */
function highlightTitle(title: string, positions: number[]) {
    if (positions.length === 0) {
        return title;
    }
    const marked = new Set(positions);
    return (
        <>
            {Array.from(title).map((char, index) =>
                marked.has(index) ? (
                    <span key={index} className="font-semibold text-fg">
                        {char}
                    </span>
                ) : (
                    char
                ),
            )}
        </>
    );
}

/**
 * The command palette — VSCode-style dual mode over one shared overlay:
 *
 *  - Query starting with `>` lists every runnable command (aggregated by {@link CommandService})
 *    with fuzzy filtering. `mod+shift+p` opens here (the `>` is prefilled).
 *  - Any other query is a global project search over {@link SearchService} (story prose, variable
 *    names, UI text keys, blueprint node titles); Enter/click jumps to the hit. `mod+p` opens here.
 *
 * Deleting the `>` switches a command session into search and typing one switches back — the modes
 * are just readings of the query string, exactly like VSCode's Quick Open.
 */
export function CommandPalette() {
    const { t } = useTranslation();
    const { workspace, context } = useWorkspace();
    // Subscribed so the command snapshot refreshes if actions change while the palette is open.
    const { actions, actionGroups, openEditorTab, setPanelVisibility, editorLayout, setActiveEditorTab } =
        useRegistry();
    const [open, setOpen] = useState(false);
    const [query, setQuery] = useState("");
    const [selectedIndex, setSelectedIndex] = useState(0);
    const [commands, setCommands] = useState<PaletteCommand[]>([]);
    const [indexBuilding, setIndexBuilding] = useState(false);
    const [searchRevision, setSearchRevision] = useState(0);
    const isMac = isMacPlatform();

    const commandService = context ? context.services.get<CommandService>(Services.Command) : null;
    const searchService = context ? context.services.get<SearchService>(Services.Search) : null;

    const isCommandMode = query.startsWith(COMMAND_PREFIX);

    const openWith = useCallback((initialQuery: string) => {
        setOpen(true);
        setQuery(initialQuery);
        setSelectedIndex(0);
    }, []);

    // The title-bar box renders the session as a controlled input; keep it in sync.
    useEffect(() => {
        publishCommandPaletteSession({ open, query });
    }, [open, query]);

    // If the layout unmounts mid-session, tell the box the session is over.
    useEffect(() => {
        return () => publishCommandPaletteSession({ open: false, query: "" });
    }, []);

    // Latest open/query for the keybinding handlers (registered once; useKeybinding refs the
    // handler, so these stay fresh without re-registering per keystroke).
    const openRef = useRef(open);
    openRef.current = open;
    const queryRef = useRef(query);
    queryRef.current = query;

    // Neither toggle lists itself as a command: the palette is its own entry point.
    useKeybinding({
        id: "workspace-command-palette",
        key: "mod+shift+p",
        handler: () => {
            // Re-pressing the shortcut for the mode you are already in closes the palette;
            // pressing the *other* shortcut switches modes in place.
            if (openRef.current && queryRef.current.startsWith(COMMAND_PREFIX)) {
                setOpen(false);
                return;
            }
            openWith(COMMAND_PREFIX);
        },
        allowInEditable: true,
    });

    // mod+p belongs to the Quick Open picker (QuickOpenPicker) — the palette's search mode stays
    // reachable through the title-bar box and by deleting the `>` prefix.

    // Snapshot the available commands when the palette opens (and if the registry changes while open).
    useEffect(() => {
        if (!open || !workspace || !commandService) {
            return;
        }
        setCommands(commandService.collect(workspace));
    }, [open, workspace, commandService, actions, actionGroups]);

    // Build the search index lazily the first time the palette enters search mode.
    useEffect(() => {
        if (!open || isCommandMode || !searchService) {
            return;
        }
        let mounted = true;
        if (!searchService.isReady()) {
            setIndexBuilding(true);
        }
        searchService
            .ensureReady()
            .then(() => {
                if (mounted) {
                    setIndexBuilding(false);
                    setSearchRevision(revision => revision + 1);
                }
            })
            .catch(() => {
                if (mounted) {
                    setIndexBuilding(false);
                }
            });
        const unsubscribe = searchService.onIndexChanged(() => setSearchRevision(revision => revision + 1));
        return () => {
            mounted = false;
            unsubscribe();
        };
    }, [open, isCommandMode, searchService]);

    // Dismiss when the window loses focus, mirroring the editor quick switch.
    useEffect(() => {
        if (!open) {
            return;
        }
        const handleBlur = () => setOpen(false);
        window.addEventListener("blur", handleBlur);
        return () => window.removeEventListener("blur", handleBlur);
    }, [open]);

    // Pin the dropdown horizontally under the title-bar search box (typing happens *in* the box;
    // this card is only the candidate list). The box is centered in the title bar's *leftover*
    // flex space, not the window, so a window-centered card would sit visibly off its anchor.
    // Null (no box found) falls back to window-centered.
    const [anchorLeft, setAnchorLeft] = useState<number | null>(null);
    useEffect(() => {
        if (!open) {
            return;
        }
        const measure = () => {
            const box = document.querySelector("[data-titlebar-search-box]");
            if (!box) {
                setAnchorLeft(null);
                return;
            }
            const rect = box.getBoundingClientRect();
            const cardWidth = Math.min(720, window.innerWidth - 32);
            const ideal = rect.left + rect.width / 2 - cardWidth / 2;
            setAnchorLeft(Math.round(Math.min(Math.max(ideal, 16), window.innerWidth - cardWidth - 16)));
        };
        measure();
        window.addEventListener("resize", measure);
        return () => window.removeEventListener("resize", measure);
    }, [open]);

    const rankedCommands = useMemo(() => {
        if (!isCommandMode) {
            return [];
        }
        const commandFilter = query.slice(COMMAND_PREFIX.length);
        return rankFuzzyList(commands, commandFilter, command => [command.title, command.category ?? ""]);
    }, [isCommandMode, commands, query]);

    const searchHits = useMemo(() => {
        if (isCommandMode || !open || !searchService || !query.trim()) {
            return [] as Array<{ group: SearchGroup; hit: SearchHit }>;
        }
        // searchRevision retriggers this after index (re)builds.
        void searchRevision;
        return searchService
            .search(query, { maxPerGroup: 10 })
            .flatMap(group => group.hits.map(hit => ({ group: group.group, hit })));
    }, [isCommandMode, open, searchService, query, searchRevision]);

    /**
     * Unified row model across the palette's three states: command list (`>` query), search
     * results (non-empty query), and the VSCode-style empty state — a "Show and Run Commands"
     * mode hint plus the recently used editor tabs.
     */
    interface PaletteRowModel {
        row: QuickListRow;
        run: () => void;
        /** True for rows that transform the query (mode hint) instead of finishing the session. */
        keepOpen?: boolean;
    }

    const rowModels = useMemo<PaletteRowModel[]>(() => {
        if (isCommandMode) {
            return rankedCommands.map(({ item, positions }) => ({
                row: {
                    key: item.id,
                    icon: item.icon,
                    title: (
                        <span className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate">{highlightTitle(item.title, positions)}</span>
                            {item.category && (
                                <span className="shrink-0 text-xs text-fg-subtle">{item.category}</span>
                            )}
                        </span>
                    ),
                    trailing: item.keybinding ? (
                        <span className="tabular-nums">{formatKeybinding(item.keybinding, isMac)}</span>
                    ) : undefined,
                },
                run: () => {
                    try {
                        const result = item.run();
                        if (result instanceof Promise) {
                            result.catch(error => reportCommandError(context, error));
                        }
                    } catch (error) {
                        reportCommandError(context, error);
                    }
                },
            }));
        }

        if (query.trim()) {
            return searchHits.map(({ group, hit }) => ({
                row: {
                    key: hit.entry.id,
                    title: (
                        <span className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate">{renderHighlightedText(hit.entry.text, hit.titleRange)}</span>
                            {hit.entry.detail && (
                                <span className="min-w-0 shrink truncate text-xs text-fg-subtle">
                                    {hit.entry.detail}
                                </span>
                            )}
                        </span>
                    ),
                    trailing: t(SEARCH_GROUP_TITLE_KEYS[group]),
                },
                run: () => {
                    jumpToSearchTarget(hit.entry.target, { openEditorTab, setPanelVisibility, context });
                },
            }));
        }

        // Empty state: the command-mode hint, then the recently used editor tabs (MRU first).
        const models: PaletteRowModel[] = [
            {
                row: {
                    key: "hint:commands",
                    title: (
                        <span className="flex min-w-0 items-baseline gap-2">
                            <span className="truncate">{t("workspace.shell.commandPalette.goToCommands")}</span>
                            <span className="shrink-0 text-xs text-fg-subtle">{COMMAND_PREFIX}</span>
                        </span>
                    ),
                    trailing: (
                        <span className="tabular-nums">{formatKeybinding("mod+shift+p", isMac)}</span>
                    ),
                },
                run: () => setQuery(COMMAND_PREFIX),
                keepOpen: true,
            },
        ];

        const mruKeys = context
            ? context.services.get<UIService>(Services.UI).getStore().getEditorTabFocusHistoryKeys()
            : [];
        const order = buildEditorQuickSwitchOrder(editorLayout, mruKeys, null);
        const showGroupId = order.groupCount > 1;
        for (const candidate of order.candidates.slice(0, 8)) {
            models.push({
                row: {
                    key: `tab:${candidate.key}`,
                    icon: candidate.tab.icon,
                    title: String(candidate.tab.title),
                    modified: candidate.tab.modified,
                    trailing: showGroupId ? candidate.groupId : undefined,
                },
                run: () => setActiveEditorTab(candidate.tabId, candidate.groupId),
            });
        }
        return models;
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        isCommandMode,
        rankedCommands,
        query,
        searchHits,
        context,
        editorLayout,
        openEditorTab,
        setPanelVisibility,
        setActiveEditorTab,
        isMac,
        t,
    ]);

    const rowCount = rowModels.length;

    // Keep the selection inside the (re-filtered) list.
    useEffect(() => {
        setSelectedIndex(index => clampIndex(index, rowCount));
    }, [rowCount]);

    const close = useCallback(() => setOpen(false), []);

    const commit = useCallback(
        (index: number) => {
            const model = rowModels[index];
            if (!model) {
                setOpen(false);
                return;
            }
            if (model.keepOpen) {
                model.run();
                return;
            }
            setOpen(false);
            model.run();
        },
        [rowModels],
    );

    // Keyboard forwarded from the title-bar input. Home/End are deliberately NOT intercepted —
    // in a real text box they move the caret.
    const handleInputKeyDown = useCallback(
        (event: React.KeyboardEvent<HTMLInputElement>) => {
            const handled = () => {
                event.preventDefault();
                // Keep navigation keys from also reaching the global keybinding service.
                event.stopPropagation();
            };
            switch (event.key) {
                case "ArrowDown":
                    handled();
                    setSelectedIndex(index => wrapIndex(index + 1, rowCount));
                    break;
                case "ArrowUp":
                    handled();
                    setSelectedIndex(index => wrapIndex(index - 1, rowCount));
                    break;
                case "Enter":
                    handled();
                    commit(selectedIndex);
                    break;
                case "Escape":
                    handled();
                    close();
                    break;
                default:
                    break;
            }
        },
        [rowCount, selectedIndex, commit, close],
    );

    // Wire the title-bar box to this session: it renders {open, query} and feeds back typing,
    // keys, and dismissal. Re-registered when the callbacks' dependencies change (cheap).
    useEffect(
        () =>
            registerCommandPaletteBridge({
                open: openWith,
                setQuery,
                handleKeyDown: handleInputKeyDown,
                close,
            }),
        [openWith, handleInputKeyDown, close],
    );

    if (!open) {
        return null;
    }

    const rows: QuickListRow[] = rowModels.map(model => model.row);

    const emptyText = isCommandMode
        ? t("workspace.shell.commandPalette.empty")
        : indexBuilding
            ? t("workspace.shell.search.building")
            : query.trim()
                ? t("workspace.shell.search.empty")
                : t("workspace.shell.search.placeholder");

    return (
        <>
            {/* Click-away layer: sits below the overlay; the overlay's empty region is click-through.
                Dimmed slightly — enough to pull focus onto the palette without reading as a modal
                (dialogs use bg-black/60; this is deliberately much lighter). */}
            <div className="nl-window-content-layer z-[45] bg-black/15 animate-fade-in" onMouseDown={close} />
            <QuickSwitchOverlay
                zClassName="z-[46]"
                // Candidates only — typing happens in the title-bar box itself. Drop the list
                // flush under the title bar at the box's horizontal position.
                placementClassName={anchorLeft === null ? "items-start justify-center pt-1" : "items-start pt-1"}
                widthClassName="w-[min(720px,calc(100vw-32px))]"
                cardStyle={anchorLeft === null ? undefined : { marginLeft: anchorLeft }}
                rows={rows}
                selectedIndex={selectedIndex}
                onCommit={commit}
                onHoverIndex={setSelectedIndex}
                ariaLabel={t("workspace.shell.commandPalette.title")}
                emptyText={emptyText}
            />
        </>
    );
}

function reportCommandError(
    context: ReturnType<typeof useWorkspace>["context"],
    error: unknown,
): void {
    if (context) {
        context.services.get<UIService>(Services.UI).showError(error instanceof Error ? error : String(error));
        return;
    }
    console.error("[CommandPalette] command failed:", error);
}
