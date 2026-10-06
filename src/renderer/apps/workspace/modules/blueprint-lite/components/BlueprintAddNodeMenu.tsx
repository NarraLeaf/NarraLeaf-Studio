import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useFloatingLayer, useHostWindow } from "@/lib/components/layout";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintPaletteContext } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    AppWindow,
    Box,
    Braces,
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
    BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID,
    blueprintAddNodeEntryKey,
    buildBlueprintAddNodeCategories,
    filterPreparedBlueprintAddNodeEntries,
    prepareBlueprintAddNodeEntries,
} from "./BlueprintAddNodeMenuModel";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import {
    resolveBlueprintCategoryLabel,
    blueprintCategoryFormerLabels,
    resolveBlueprintNodeTitle,
} from "../blueprintNodeI18n";
import { useCategoryRowScroll } from "./useCategoryRowScroll";

const MENU_W = 440;
const MENU_MAX_H = 520;
const MENU_CHROME_H = 132;
const WINDOW_TITLEBAR_HEIGHT = 40;
/**
 * Height of one entry row, which the list is windowed by.
 *
 * The palette runs to a few hundred entries in a real project, and every one of them carries an
 * icon; mounting the lot took ~300ms on right-click and the same again on every keystroke in the
 * search field. Rows are a fixed height by design, so the window needs no measuring pass — keep
 * this in step with the row's own `h-[52px]`.
 */
const ROW_H = 52;
/** The list's vertical inset, kept out of the scroll container so the window owns every offset. */
const LIST_PAD = 8;

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
    /**
     * Entries listed ahead of the catalogue, in a group of their own that the menu opens on: the
     * fields of a dragged struct (see `structFieldPaletteEntries.ts`).
     */
    leadingEntries?: readonly PaletteEntry[];
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
        case BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID:
            return { icon: Braces, color: "#96b8a0" };
        default:
            return { icon: Settings2, color: "#9aa3ad" };
    }
}

/** A category chip's words: the menu's own group by its own name, a node category by the catalogue's. */
function addNodeCategoryLabel(category: string, t: ReturnType<typeof useTranslation>["t"]): string {
    return category === BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID
        ? t("blueprint.addNode.fieldsCategory")
        : resolveBlueprintCategoryLabel(category, t);
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
    leadingEntries,
}: Props) {
    const { t } = useTranslation();
    // The menu is portalled into, positioned against and keyed off the window it is drawn in.
    const hostWindow = useHostWindow();
    const [query, setQuery] = useState("");
    const [activeCategoryId, setActiveCategoryId] = useState(BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID);
    const [activeFlatIndex, setActiveFlatIndex] = useState(-1);
    const inputRef = useRef<HTMLInputElement>(null);
    const listRef = useRef<HTMLDivElement>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const navStateRef = useRef({ activeFlatIndex: -1, itemCount: 0 });

    // A floating layer for what the menu's own keys below do not cover: focus goes into the search
    // field when it opens, Escape closes the menu and nothing it was portalled out of, Tab out of it
    // closes it, closing gives focus back to the editor it was opened over, and a tab or panel switch
    // puts it away rather than leaving it hanging over what the author moved to. The list keeps its
    // own walk - the highlight is an index, the categories are stepped sideways - so the layer is
    // given no item selector.
    useFloatingLayer({
        open,
        onClose,
        panelRef: menuRef,
        initialFocus: inputRef,
    });

    const openOnFields = Boolean(leadingEntries?.length);
    useEffect(() => {
        if (open) {
            setQuery("");
            setActiveCategoryId(openOnFields ? BLUEPRINT_ADD_NODE_FIELDS_CATEGORY_ID : BLUEPRINT_ADD_NODE_ALL_CATEGORY_ID);
            setActiveFlatIndex(-1);
        }
    }, [open, openOnFields]);

    useEffect(() => {
        setActiveFlatIndex(-1);
        if (listRef.current) {
            listRef.current.scrollTop = 0;
        }
    }, [activeCategoryId, query]);

    const entries = useMemo(() => {
        const all = nodeCatalog.listPaletteEntries(paletteContext);
        const listed = entryFilter ? all.filter(entryFilter) : all;
        return leadingEntries?.length ? [...leadingEntries, ...listed] : listed;
    }, [nodeCatalog, paletteContext, entryFilter, leadingEntries]);

    const categories = useMemo(() => buildBlueprintAddNodeCategories(entries), [entries]);
    const categoryRow = useCategoryRowScroll([open, categories]);
    const categoryListRef = categoryRow.rowRef;
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
            category: category => addNodeCategoryLabel(category, t),
            categoryAliases: blueprintCategoryFormerLabels,
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

    const virtualizer = useVirtualizer({
        count: itemCount,
        getScrollElement: () => listRef.current,
        estimateSize: () => ROW_H,
        overscan: 6,
        // The list's own inset, moved off the scroll container and into the window's arithmetic:
        // left on the container it would shift every row 8px past where a scroll-to lands it.
        paddingStart: LIST_PAD,
        paddingEnd: LIST_PAD,
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

    // Asked of the window rather than the row: arrowing past the edge of the mounted range has no
    // element to scroll to, and `aria-activedescendant` points at an id that only exists once the
    // row is on screen.
    useEffect(() => {
        if (!open || activeFlatIndex < 0) {
            return;
        }
        virtualizer.scrollToIndex(activeFlatIndex, { align: "auto" });
        // `virtualizer` is a fresh object every render; depending on it would re-scroll continuously.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [activeFlatIndex, open, itemCount]);

    useEffect(() => {
        if (!open) {
            return;
        }
        // Keys a text field answers for itself once there is text in it: the caret's. With the
        // search box empty there is no caret to move, and ←/→ step through the categories and
        // Home/End jump the list; with something typed, they edit what was typed.
        const searchOwnsKey = (e: KeyboardEvent) => {
            const input = inputRef.current;
            return Boolean(input && e.target === input && input.value.length > 0);
        };
        const onKey = (e: KeyboardEvent) => {
            // Every key of a composition is the input method's: Enter commits the reading, the
            // arrows walk the candidates.
            if (isImeKeyEvent(e)) {
                return;
            }

            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                if (searchOwnsKey(e)) {
                    return;
                }
                e.preventDefault();
                selectRelativeCategory(e.key === "ArrowLeft" ? -1 : 1);
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

            if ((e.key === "Home" || e.key === "End") && searchOwnsKey(e)) {
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
                ref={menuRef}
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
                    {/* The fades are drawn on this wrapper rather than inside the row: a positioned
                        child of a scroller is positioned against its content and would slide away
                        with the chips. */}
                    <div className="relative mt-3">
                        <div
                            ref={categoryListRef}
                            className={cn(
                                "nl-no-scrollbar flex gap-1 overflow-x-auto pb-0.5",
                                categoryRow.dragging && "cursor-grabbing select-none",
                            )}
                            {...categoryRow.rowProps}
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
                                        <span>{addNodeCategoryLabel(category.label, t)}</span>
                                        <span className="text-2xs text-fg-subtle">{category.count}</span>
                                    </button>
                                );
                            })}
                        </div>
                        {categoryRow.overflow.left ? (
                            <span
                                data-bp-chip-fade="left"
                                className="pointer-events-none absolute inset-y-0 left-0 w-6 bg-gradient-to-r from-surface to-transparent"
                                aria-hidden
                            />
                        ) : null}
                        {categoryRow.overflow.right ? (
                            <span
                                data-bp-chip-fade="right"
                                className="pointer-events-none absolute inset-y-0 right-0 w-6 bg-gradient-to-l from-surface to-transparent"
                                aria-hidden
                            />
                        ) : null}
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
                        // The sizer is scaffolding, not structure: it holds the scrollbar at the
                        // full length of the list while only the rows on screen are mounted.
                        <div role="presentation" className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                            {virtualizer.getVirtualItems().map(item => {
                                const entry = filteredEntries[item.index];
                                if (!entry) {
                                    return null;
                                }
                                return (
                                    <BlueprintAddNodeRow
                                        key={item.key}
                                        entry={entry}
                                        active={activeFlatIndex === item.index}
                                        flatIndex={item.index}
                                        itemCount={itemCount}
                                        offsetY={item.start}
                                        onPick={pickEntry}
                                        onHover={setActiveFlatIndex}
                                    />
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
 * Memoised because the whole list re-renders whenever the highlight moves, and the highlight moves
 * on every row the pointer crosses: without this, running the mouse down the palette re-rendered
 * every mounted row (icon included) per row boundary.
 */
const BlueprintAddNodeRow = memo(function BlueprintAddNodeRow(props: {
    entry: PaletteEntry;
    active: boolean;
    flatIndex: number;
    itemCount: number;
    /** Where the windowed list puts this row inside its sizer. */
    offsetY: number;
    onPick: (entry: PaletteEntry) => void;
    onHover: (flatIndex: number) => void;
}) {
    const { t } = useTranslation();
    const visual = getCategoryVisual(props.entry.category);
    const Icon = visual.icon;
    const magicRef = props.entry.magicElementRef;
    const categoryLabel = addNodeCategoryLabel(props.entry.category, t);
    // A preset's title is already in the author's language: it is built from a field name.
    const nodeTitle = props.entry.preset ? props.entry.preset.title : resolveBlueprintNodeTitle(props.entry.displayName, t);
    const subtitle = props.entry.preset
        ? props.entry.preset.subtitle
        : magicRef
        ? `${categoryLabel} -> ${magicRef.label}`
        : categoryLabel;
    // What the node does is the one thing the row cannot show; its type id is already on the right
    // of the row, and the search keywords say nothing about the node.
    const title = [
        nodeTitle,
        props.entry.description ? t(props.entry.description) : "",
        magicRef ? t("blueprint.addNode.targetTooltip", { label: magicRef.label, type: magicRef.elementType }) : "",
    ].filter(Boolean).join("\n");

    return (
        <div
            className={[
                "group absolute left-0 top-0 flex h-[52px] w-full items-center rounded-md transition-colors",
                props.active ? "bg-fill" : "hover:bg-fill",
            ].join(" ")}
            style={{ transform: `translateY(${props.offsetY}px)` }}
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
