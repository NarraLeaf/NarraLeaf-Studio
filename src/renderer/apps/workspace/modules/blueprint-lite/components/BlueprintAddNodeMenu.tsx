import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { IBlueprintNodeCatalogService } from "@/lib/workspace/services/services";
import type { BlueprintPaletteContext } from "@/lib/ui-editor/blueprint-nodes/types";
import {
    Box,
    Bug,
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
    filterBlueprintAddNodeEntries,
} from "./BlueprintAddNodeMenuModel";
import { SearchBox } from "@/apps/workspace/modules/assets/components/SearchBox";
import { useTranslation } from "@/lib/i18n";

const MENU_W = 440;
const MENU_MAX_H = 520;
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
}: Props) {
    const { t } = useTranslation();
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

    const entries = useMemo(
        () => nodeCatalog.listPaletteEntries(paletteContext),
        [nodeCatalog, paletteContext],
    );

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
        const maxHeight = Math.min(MENU_MAX_H, Math.max(280, window.innerHeight - viewportTop - pad));
        const left = Math.max(pad, Math.min(anchor.x, window.innerWidth - MENU_W - pad));
        const top = Math.max(viewportTop, Math.min(anchor.y, Math.max(viewportTop, window.innerHeight - maxHeight - pad)));
        return { left, top, maxHeight };
    }, [anchor.x, anchor.y]);

    const filteredEntries = useMemo(
        () => filterBlueprintAddNodeEntries(entries, activeCategoryId, query),
        [activeCategoryId, entries, query],
    );
    const itemCount = filteredEntries.length;
    const listMaxHeight = Math.max(120, Math.min(MENU_MAX_H - MENU_CHROME_H, layout.maxHeight - MENU_CHROME_H));

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
        const root = listRef.current;
        if (!root) {
            return;
        }
        const el = root.querySelector(`[data-bp-add-node-idx="${activeFlatIndex}"]`);
        el?.scrollIntoView({ block: "nearest" });
    }, [activeFlatIndex, open]);

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
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
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
                className="fixed z-[101] flex max-w-[calc(100vw-16px)] flex-col overflow-hidden rounded-md border border-edge bg-[#101318] shadow-xl"
                style={{ left: layout.left, top: layout.top, width: MENU_W, maxHeight: layout.maxHeight }}
                onContextMenu={e => e.preventDefault()}
            >
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
                        className="mt-3 flex gap-1 overflow-x-auto pb-0.5"
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
                                            ? "border-primary/45 bg-primary/15 text-white"
                                            : "border-edge bg-fill-subtle text-fg-muted hover:bg-fill hover:text-fg",
                                    ].join(" ")}
                                    onClick={() => setActiveCategoryId(category.id)}
                                >
                                    <Icon className="h-3.5 w-3.5 shrink-0" style={{ color: visual.color }} aria-hidden />
                                    <span>{category.label}</span>
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
                    className="min-h-0 flex-1 overflow-y-auto p-2"
                    style={{ maxHeight: listMaxHeight }}
                >
                    {filteredEntries.length === 0 ? (
                        <div className="rounded-md border border-edge bg-fill-subtle px-3 py-3 text-sm text-fg-subtle">
                            {t("blueprint.addNode.empty")}
                        </div>
                    ) : (
                        filteredEntries.map((entry, index) => (
                            <BlueprintAddNodeRow
                                key={blueprintAddNodeEntryKey(entry)}
                                entry={entry}
                                active={activeFlatIndex === index}
                                flatIndex={index}
                                itemCount={itemCount}
                                onPick={pickEntry}
                                onHover={setActiveFlatIndex}
                            />
                        ))
                    )}
                </div>
            </div>
        </>,
        document.body,
    );
}

function BlueprintAddNodeRow(props: {
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
    const subtitle = magicRef
        ? `${props.entry.category} -> ${magicRef.label}`
        : props.entry.category;
    const title = [
        props.entry.displayName,
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
                title={title}
                onClick={() => props.onPick(props.entry)}
                onMouseEnter={() => props.onHover(props.flatIndex)}
            >
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-edge bg-fill-subtle">
                    <Icon className="h-4 w-4" style={{ color: visual.color }} aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm text-fg">{props.entry.displayName}</span>
                    <span className="block truncate text-2xs text-fg-subtle">{subtitle}</span>
                </span>
                <span className="min-w-0 max-w-[180px] shrink-0 truncate font-mono text-2xs text-fg-subtle">
                    {props.entry.type}
                </span>
            </button>
        </div>
    );
}
