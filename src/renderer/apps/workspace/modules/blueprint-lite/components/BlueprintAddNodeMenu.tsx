import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useDismissWhenHidden } from "@/lib/components/layout";
import { useHostWindow } from "@/lib/components/layout";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintPaletteContext } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    AppWindow,
    Box,
    Bug,
    CornerUpRight,
    Database,
    History as HistoryIcon,
    MousePointer2,
    Map as MapIcon,
    Route,
    Settings2,
    Sigma,
    Type as TypeIcon,
    Variable,
    Zap,
    type LucideIcon,
} from "lucide-react";
import {
    BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID,
    blueprintAddNodeEntryKey,
    buildBlueprintAddNodeCategories,
    filterPreparedBlueprintAddNodeEntries,
    prepareBlueprintAddNodeEntries,
} from "./BlueprintAddNodeMenuModel";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { useTranslation } from "@/lib/i18n";
import {
    resolveBlueprintCategoryLabel,
    resolveBlueprintNodeTitle,
} from "../blueprintNodeI18n";

const MENU_W = 440;
const MENU_MAX_H = 520;
/**
 * Every row is exactly this tall, so the list can be virtualized off an index rather than measured.
 * Kept in step with `BlueprintAddNodeRow`'s own `h-[52px]`: a row that outgrows this number scrolls
 * under its neighbour instead of pushing it down.
 */
const MENU_ROW_H = 52;
/**
 * The list's own top and bottom breathing room, in the virtualizer rather than in the scroller's
 * padding: an item offset the virtualizer does not know about is one `scrollToIndex` lands short
 * of, which shows up as the keyboard walking a row half under the edge.
 */
const MENU_LIST_PAD = 8;
const MENU_CHROME_H = 132;
const WINDOW_TITLEBAR_HEIGHT = 40;

type PaletteEntry = ReturnType<IBlueprintNodeCatalogService["listPaletteEntries"]>[number];

type Props = {
    nodeCatalog: IBlueprintNodeCatalogService;
    open: boolean;
    paletteContext: BlueprintPaletteContext;
    anchor: { x: number; y: number };
    flowPosition: { x: number; y: number };
    onClose: () => void;
    onPickEntry: (entry: PaletteEntry, flowPosition: { x: number; y: number }) => void;
    /**
     * Restricts the listed entries (applied before category/search). Used by the
     * drag-off-a-pin flow to show only nodes compatible with the dragged pin.
     */
    entryFilter?: (entry: PaletteEntry) => boolean;
    /** Renders the "created from a pin" affordance (accent strip + chip) and the connect-empty copy. */
    connectMode?: boolean;
    /** Short tag for the dragged pin shown in the connect-mode chip (e.g. "exec", "string"). */
    connectSourceLabel?: string;
};

type CategoryVisual = {
    icon: LucideIcon;
    color: string;
};

function getCategoryVisual(categoryId: string): CategoryVisual {
    switch (categoryId) {
        case "Events":
            return { icon: Zap, color: "#d9b36a" };
        case "Flow":
            return { icon: Route, color: "#8fa9c7" };
        case "Data":
            return { icon: Database, color: "#96b8a0" };
        case "Math":
            return { icon: Sigma, color: "#b2a6c9" };
        case "String":
            return { icon: TypeIcon, color: "#d2a679" };
        case "Text":
            return { icon: TypeIcon, color: "#8fc7b5" };
        case "Element":
            return { icon: MousePointer2, color: "#d9b36a" };
        case "Displayable":
            return { icon: Box, color: "#b9c47a" };
        case "Navigation":
            return { icon: MapIcon, color: "#7ec7c1" };
        case "App":
            return { icon: AppWindow, color: "#8fb8c7" };
        case "Backlog":
            return { icon: HistoryIcon, color: "#c7a98f" };
        case "Variables":
            return { icon: Variable, color: "#8fb3d9" };
        case "Widget":
            return { icon: Box, color: "var(--narraleaf-accent, #40a8c4)" };
        case "Debug":
            return { icon: Bug, color: "#bd97a3" };
        case BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID:
            return { icon: Settings2, color: "#a8adb5" };
        default:
            return { icon: Settings2, color: "#9aa3ad" };
    }
}

export function BlueprintAddNodeMenu({
    nodeCatalog,
    open,
    paletteContext,
    anchor,
    flowPosition,
    onClose,
    onPickEntry,
    entryFilter,
    connectMode = false,
    connectSourceLabel,
}: Props) {
    // Portalled to the body, so a tab or panel switch leaves it hanging over what the author
    // moved to unless it is told (`useDismissWhenHidden`).
    useDismissWhenHidden(onClose, open);
    const { t } = useTranslation();
    // The menu is portalled into, positioned against and keyed off the window it is drawn in.
    const hostWindow = useHostWindow();
    const [query, setQuery] = useState("");
    const [activeCategoryId, setActiveCategoryId] = useState(BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID);
    const [activeFlatIndex, setActiveFlatIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const categoryListRef = useRef<HTMLDivElement>(null);
    const navStateRef = useRef({ activeFlatIndex: -1, itemCount: 0 });

    useEffect(() => {
        if (open) {
            setQuery("");
            setActiveCategoryId(BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID);
            setActiveFlatIndex(-1);
            requestAnimationFrame(() => inputRef.current?.focus());
        }
    }, [open]);

    useEffect(() => {
        setActiveFlatIndex(-1);
        if (listRef.current) {
            listRef.current.scrollTop = 0;
        }
    }, [activeCategoryId, query]);

    const entries = useMemo(() => {
        const all = nodeCatalog.listPaletteEntries(paletteContext);
        return entryFilter ? all.filter(entryFilter) : all;
    }, [nodeCatalog, paletteContext, entryFilter]);

    const categories = useMemo(() => buildBlueprintAddNodeCategories(entries), [entries]);
    const categoriesRef = useRef(categories);
    categoriesRef.current = categories;
    const activeCategoryIdRef = useRef(activeCategoryId);
    activeCategoryIdRef.current = activeCategoryId;

    useEffect(() => {
        if (!categories.some(category => category.id === activeCategoryId)) {
            setActiveCategoryId(BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID);
        }
    }, [activeCategoryId, categories]);

    const layout = useMemo(() => {
        if (typeof window === "undefined") {
            return { left: anchor.x, top: anchor.y, maxHeight: MENU_MAX_H };
        }
        const pad = 8;
        const viewportTop = WINDOW_TITLEBAR_HEIGHT + pad;
        const maxHeight = Math.min(MENU_MAX_H, Math.max(280, hostWindow.innerHeight - viewportTop - pad));
        const left = Math.max(pad, Math.min(anchor.x, hostWindow.innerWidth - MENU_W - pad));
        const top = Math.max(viewportTop, Math.min(anchor.y, Math.max(viewportTop, hostWindow.innerHeight - maxHeight - pad)));
        return { left, top, maxHeight };
    }, [anchor.x, anchor.y]);

    /**
     * The folded catalogue, built on the first search and kept for the rest of the session.
     *
     * Folding is per catalogue rather than per keystroke (see `prepareBlueprintAddNodeEntries`), and
     * lazy on top of that: the menu opens on a right-click showing everything, and a fold nobody has
     * searched yet would put its whole cost inside that gesture.
     */
    const foldCatalogue = useMemo(() => {
        let folded: ReturnType<typeof prepareBlueprintAddNodeEntries> | null = null;
        return () => (folded ??= prepareBlueprintAddNodeEntries(entries, {
            title: displayName => resolveBlueprintNodeTitle(displayName, t),
            category: category => resolveBlueprintCategoryLabel(category, t),
        }));
    }, [entries, t]);

    const filteredEntries = useMemo(() => {
        if (!query.trim()) {
            return activeCategoryId === BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID
                ? [...entries]
                : entries.filter(entry => entry.category === activeCategoryId);
        }
        return filterPreparedBlueprintAddNodeEntries(foldCatalogue(), activeCategoryId, query);
    }, [activeCategoryId, entries, foldCatalogue, query]);
    const itemCount = filteredEntries.length;
    const listMaxHeight = Math.max(120, Math.min(MENU_MAX_H - MENU_CHROME_H, layout.maxHeight - MENU_CHROME_H));

    /**
     * Only the rows on screen are built.
     *
     * The catalogue is ~300 entries wide before a project adds any of its own, and the menu is
     * mounted by the right-click that opens it — so the whole list used to be reconciled, committed
     * and laid out inside the gesture, which is what made the pane menu take over a second to
     * appear. Windowing makes that cost the size of the viewport instead of the size of the
     * catalogue, and it makes hovering cheap for the same reason: moving the highlight re-renders
     * the rows in view rather than every entry behind them.
     */
    const virtualizer = useVirtualizer({
        count: itemCount,
        getScrollElement: () => listRef.current,
        estimateSize: () => MENU_ROW_H,
        paddingStart: MENU_LIST_PAD,
        paddingEnd: MENU_LIST_PAD,
        overscan: 8,
        getItemKey: index => {
            const entry = filteredEntries[index];
            return entry ? blueprintAddNodeEntryKey(entry) : index;
        },
    });

    useEffect(() => {
        navStateRef.current = { activeFlatIndex, itemCount };
    }, [activeFlatIndex, itemCount]);

    useEffect(() => {
        setActiveFlatIndex(prev => {
            if (itemCount <= 0) {
                return -1;
            }
            if (prev >= itemCount) {
                return itemCount - 1;
            }
            return prev;
        });
    }, [itemCount]);

    const filteredEntriesRef = useRef(filteredEntries);
    filteredEntriesRef.current = filteredEntries;
    const actionsRef = useRef({ onPickEntry, flowPosition, onClose });
    actionsRef.current = { onPickEntry, flowPosition, onClose };

    const pickEntry = useCallback((entry: PaletteEntry) => {
        const { onPickEntry: pick, flowPosition: pos, onClose: close } = actionsRef.current;
        pick(entry, pos);
        close();
    }, []);

    const selectRelativeCategory = useCallback((offset: number) => {
        const currentCategories = categoriesRef.current;
        if (currentCategories.length === 0) {
            return;
        }
        const currentIndex = Math.max(
            0,
            currentCategories.findIndex(category => category.id === activeCategoryIdRef.current),
        );
        const nextIndex = (currentIndex + offset + currentCategories.length) % currentCategories.length;
        setActiveCategoryId(currentCategories[nextIndex]!.id);
        requestAnimationFrame(() => {
            const el = categoryListRef.current?.querySelector(`[data-bp-add-node-category-idx="${nextIndex}"]`);
            el?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
    }, []);

    useEffect(() => {
        if (!open || activeFlatIndex < 0) {
            return;
        }
        // Through the virtualizer, not `scrollIntoView`: the row the keyboard just walked onto may
        // not be built yet, and asking the DOM for it would silently do nothing.
        virtualizer.scrollToIndex(activeFlatIndex, { align: "auto" });
    }, [activeFlatIndex, open, virtualizer]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                e.preventDefault();
                actionsRef.current.onClose();
                return;
            }

            if (e.key === "ArrowLeft") {
                e.preventDefault();
                selectRelativeCategory(-1);
                return;
            }

            if (e.key === "ArrowRight") {
                e.preventDefault();
                selectRelativeCategory(1);
                return;
            }

            const { activeFlatIndex: cur, itemCount: n } = navStateRef.current;
            if (n === 0) {
                return;
            }

            if (e.key === "ArrowDown") {
                e.preventDefault();
                setActiveFlatIndex(prev => prev < 0 ? 0 : Math.min(prev + 1, n - 1));
                return;
            }

            if (e.key === "ArrowUp") {
                e.preventDefault();
                setActiveFlatIndex(prev => {
                    if (prev <= 0) {
                        requestAnimationFrame(() => inputRef.current?.focus());
                        return -1;
                    }
                    return prev - 1;
                });
                return;
            }

            if (e.key === "Home") {
                e.preventDefault();
                setActiveFlatIndex(0);
                return;
            }

            if (e.key === "End") {
                e.preventDefault();
                setActiveFlatIndex(n - 1);
                return;
            }

            if (e.key === "Enter" && cur >= 0 && cur < n) {
                const entry = filteredEntriesRef.current[cur];
                if (entry) {
                    e.preventDefault();
                    pickEntry(entry);
                }
            }
        };
        hostWindow.addEventListener("keydown", onKey);
        return () => hostWindow.removeEventListener("keydown", onKey);
    }, [open, pickEntry, selectRelativeCategory]);

    if (!open) {
        return null;
    }

    return createPortal(
        <>
            <button
                type="button"
                className="nl-window-content-layer z-[100] cursor-default bg-transparent"
                aria-label={t("blueprint.addNode.close")}
                onClick={onClose}
            />
            <div
                role="presentation"
                className={[
                    "fixed z-[101] flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border bg-surface-raised shadow-xl",
                    connectMode ? "border-primary/50 ring-1 ring-primary/20" : "border-edge",
                ].join(" ")}
                style={{ left: layout.left, top: layout.top, width: MENU_W, maxHeight: layout.maxHeight }}
                onContextMenu={e => e.preventDefault()}
            >
                {connectMode ? (
                    <div className="flex items-center gap-1.5 border-b border-primary/30 bg-primary/10 px-3 py-1.5 text-2xs text-fg-muted">
                        <CornerUpRight className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
                        <span className="font-medium text-fg">{t("blueprint.addNode.fromPin")}</span>
                        {connectSourceLabel ? (
                            <span className="rounded-sm bg-primary/15 px-1.5 py-0.5 font-mono text-2xs text-fg-muted">
                                {connectSourceLabel}
                            </span>
                        ) : null}
                    </div>
                ) : null}
                <div className="border-b border-edge bg-surface px-3 py-3">
                    <SearchBox
                        value={query}
                        onChange={setQuery}
                        placeholder={t("blueprint.addNode.searchPlaceholder")}
                        className="w-full"
                        inputRef={inputRef}
                        inputProps={{
                            autoComplete: "off",
                            "aria-controls": "bp-add-node-list",
                            "aria-activedescendant": activeFlatIndex >= 0
                                ? `bp-add-node-option-${activeFlatIndex}`
                                : undefined,
                        }}
                    />
                    <div
                        ref={categoryListRef}
                        className="nl-no-scrollbar mt-3 flex gap-1 overflow-x-auto pb-0.5"
                        onWheel={event => {
                            if (Math.abs(event.deltaY) <= Math.abs(event.deltaX)) {
                                return;
                            }
                            event.preventDefault();
                            event.currentTarget.scrollLeft += event.deltaY;
                        }}
                    >
                        {categories.map((category, index) => {
                            const active = activeCategoryId === category.id;
                            const visual = getCategoryVisual(category.id);
                            const Icon = visual.icon;
                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    data-bp-add-node-category-idx={index}
                                    className={[
                                        "flex h-9 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-xs transition-colors",
                                        active
                                            ? "border-primary/45 bg-primary/15 text-fg"
                                            : "border-edge bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
                                    ].join(" ")}
                                    onClick={() => setActiveCategoryId(category.id)}
                                >
                                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: visual.color }} aria-hidden />
                                    <span>{resolveBlueprintCategoryLabel(category.label, t)}</span>
                                    <span className="text-2xs text-fg-subtle">{category.count}</span>
                                </button>
                            );
                        })}
                    </div>
                </div>

                <div
                    id="bp-add-node-list"
                    ref={listRef}
                    role="listbox"
                    aria-label={t("blueprint.addNode.listLabel")}
                    className="nl-no-scrollbar min-h-0 flex-1 overflow-y-auto px-2"
                    style={{ maxHeight: listMaxHeight }}
                >
                    {itemCount === 0 ? (
                        <div className="my-2 rounded-md border border-edge bg-fill-subtle px-3 py-3 text-sm text-fg-subtle">
                            {connectMode ? t("blueprint.addNode.connectEmpty") : t("blueprint.addNode.empty")}
                        </div>
                    ) : (
                        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                            {virtualizer.getVirtualItems().map(item => {
                                const entry = filteredEntries[item.index];
                                if (!entry) {
                                    return null;
                                }
                                return (
                                    <div
                                        key={item.key}
                                        className="absolute left-0 top-0 w-full"
                                        style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                                    >
                                        <BlueprintAddNodeRow
                                            entry={entry}
                                            active={activeFlatIndex === item.index}
                                            flatIndex={item.index}
                                            itemCount={itemCount}
                                            onPick={pickEntry}
                                            onHover={setActiveFlatIndex}
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </>,
        hostWindow.document.body,
    );
}

/**
 * Memoized because the highlight moves on every pointer cross: without this, one `active` change
 * re-renders every row the window is currently holding rather than the two that changed.
 */
const BlueprintAddNodeRow = memo(function BlueprintAddNodeRow(props: {
    entry: PaletteEntry;
    active: boolean;
    flatIndex: number;
    itemCount: number;
    onPick: (entry: PaletteEntry) => void;
    onHover: (flatIndex: number) => void;
}) {
    const { t } = useTranslation();
    const visual = getCategoryVisual(props.entry.category);
    const Icon = visual.icon;
    const magicRef = props.entry.magicElementRef;
    const categoryLabel = resolveBlueprintCategoryLabel(props.entry.category, t);
    const nodeTitle = resolveBlueprintNodeTitle(props.entry.displayName, t);
    const subtitle = magicRef
        ? `${categoryLabel} -> ${magicRef.label}`
        : categoryLabel;
    const title = [
        nodeTitle,
        props.entry.type,
        magicRef ? t("blueprint.addNode.targetTooltip", { label: magicRef.label, type: magicRef.elementType }) : "",
        props.entry.keywords?.length ? props.entry.keywords.join(", ") : "",
    ].filter(Boolean).join("\n");

    return (
        <div
            className={[
                "group flex h-[52px] items-center rounded-md transition-colors",
                props.active ? "bg-fill" : "hover:bg-fill",
            ].join(" ")}
        >
            <button
                id={`bp-add-node-option-${props.flatIndex}`}
                type="button"
                role="option"
                aria-selected={props.active}
                aria-posinset={props.flatIndex + 1}
                aria-setsize={props.itemCount}
                data-bp-add-node-idx={props.flatIndex}
                className="flex h-full min-w-0 flex-1 items-center gap-2 rounded-md px-2.5 py-2 text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                data-tip={title}
                onClick={() => props.onPick(props.entry)}
                onMouseEnter={() => props.onHover(props.flatIndex)}
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle">
                    <Icon className="h-4 w-4" style={{ color: visual.color }} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{nodeTitle}</span>
                    <span className="block truncate text-2xs text-fg-subtle">{subtitle}</span>
                </span>
                <span className="min-w-0 max-w-[180px] shrink-0 truncate font-mono text-2xs text-fg-subtle">
                    {props.entry.type}
                </span>
            </button>
        </div>
    );
});
