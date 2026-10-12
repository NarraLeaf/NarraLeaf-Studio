import { useEffect, useMemo, useRef } from "react";
import { AlertCircle, ChevronRight, Folder } from "lucide-react";
import { ASSET_CATEGORY_ORDER, type AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetGroup } from "@/lib/workspace/services/assets/types";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { ASSET_CATEGORY_ICONS } from "../constants";
import { useBrowserDropTarget } from "./useBrowserItemGestures";
import type { AssetBrowserLocation } from "./assetBrowserModel";

/** One step of indent. The chevron column is the same width, so a leaf lines up with its siblings. */
const INDENT_PX = 14;

type TreeRow =
    | { kind: "category"; category: AssetCategory; hasChildren: boolean; open: boolean; count: number }
    | { kind: "group"; category: AssetCategory; group: AssetGroup; level: number; hasChildren: boolean; open: boolean; count: number };

export interface BrowserFolderTreeProps {
    /** Where the contents beside the tree are. Null while results are up: they are filed nowhere. */
    location: AssetBrowserLocation | null;
    onNavigate: (location: AssetBrowserLocation) => void;
    openCategories: ReadonlySet<AssetCategory>;
    onToggleCategory: (category: AssetCategory) => void;
    onDropOnPlace: (event: React.DragEvent, kind: "move" | "files", category: AssetCategory, group: AssetGroup | null) => void;
}

/**
 * The places in the library: the six categories and the folders inside them, and no files.
 *
 * A press on a row goes there; the chevron opens a row without going anywhere. The number on each
 * row is every file the place holds however deep, which is what a place stands for - a category
 * whose files are all filed in folders is not empty. The library is drawn whole whatever is being
 * searched for: the tree is where the author is, not what matched.
 */
export function BrowserFolderTree({ location, onNavigate, openCategories, onToggleCategory, onDropOnPlace }: BrowserFolderTreeProps) {
    const { assets, groups, expandedGroups, setExpandedGroups, handleGroupFocus } = useAssetsPanelContext();

    const rows = useMemo(() => {
        const out: TreeRow[] = [];
        for (const category of ASSET_CATEGORY_ORDER) {
            const categoryGroups = groups[category];
            const childrenOf = new Map<string, AssetGroup[]>();
            for (const group of categoryGroups) {
                const parent = group.parentGroupId ?? "";
                childrenOf.set(parent, [...(childrenOf.get(parent) ?? []), group]);
            }
            // Files per folder, then carried up every parent chain: one pass over the files rather
            // than one per folder.
            const counts = new Map<string, number>();
            const byId = new Map(categoryGroups.map(group => [group.id, group]));
            for (const asset of assets[category]) {
                const seen = new Set<string>();
                let current = asset.groupId ? byId.get(asset.groupId) : undefined;
                while (current && !seen.has(current.id)) {
                    seen.add(current.id);
                    counts.set(current.id, (counts.get(current.id) ?? 0) + 1);
                    current = current.parentGroupId ? byId.get(current.parentGroupId) : undefined;
                }
            }
            const roots = childrenOf.get("") ?? [];
            const open = openCategories.has(category);
            out.push({ kind: "category", category, hasChildren: roots.length > 0, open, count: assets[category].length });
            if (!open) {
                continue;
            }
            const visit = (group: AssetGroup, level: number, trail: Set<string>) => {
                if (trail.has(group.id)) {
                    return;
                }
                const children = childrenOf.get(group.id) ?? [];
                const groupOpen = expandedGroups.has(group.id);
                out.push({
                    kind: "group",
                    category,
                    group,
                    level,
                    hasChildren: children.length > 0,
                    open: groupOpen,
                    count: counts.get(group.id) ?? 0,
                });
                if (groupOpen) {
                    const next = new Set(trail).add(group.id);
                    children.forEach(child => visit(child, level + 1, next));
                }
            };
            roots.forEach(group => visit(group, 1, new Set()));
        }
        return out;
    }, [assets, expandedGroups, groups, openCategories]);

    const toggleGroup = (groupId: string) => {
        setExpandedGroups(previous => {
            const next = new Set(previous);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    const toggle = (row: TreeRow) => (row.kind === "category" ? onToggleCategory(row.category) : toggleGroup(row.group.id));
    const isCurrent = (row: TreeRow) => !!location && location.category === row.category
        && (row.kind === "category" ? !location.groupId : location.groupId === row.group.id);

    /** Go to a row's place, as a press on the row does. */
    const goTo = (row: TreeRow) => {
        if (row.kind === "group") {
            handleGroupFocus(row.group.id);
        }
        onNavigate(row.kind === "group" ? { category: row.category, groupId: row.group.id } : { category: row.category });
    };

    // The row a key went to, scrolled into view once the place it names is the current one.
    const treeRef = useRef<HTMLDivElement | null>(null);
    const keyMoved = useRef(false);
    const currentPlace = location ? `${location.category}/${location.groupId ?? ""}` : null;
    useEffect(() => {
        if (!keyMoved.current) {
            return;
        }
        keyMoved.current = false;
        treeRef.current?.querySelector("[aria-selected=true]")?.scrollIntoView({ block: "nearest" });
    }, [currentPlace]);

    /**
     * The tree's keys, the ones every folder tree has: up and down go to the place above and below,
     * right opens a closed row and then goes into its first child, left closes an open row and then
     * goes up to the row it sits in, Home and End go to the first and the last row.
     */
    const onKeyDown = (event: React.KeyboardEvent) => {
        if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey || rows.length === 0) {
            return;
        }
        const index = rows.findIndex(isCurrent);
        const row = index >= 0 ? rows[index] : null;
        let target: TreeRow | null = null;
        switch (event.key) {
            case "ArrowDown":
                target = rows[index + 1] ?? null;
                break;
            case "ArrowUp":
                target = index < 0 ? rows[rows.length - 1] : rows[index - 1] ?? null;
                break;
            case "Home":
                target = rows[0];
                break;
            case "End":
                target = rows[rows.length - 1];
                break;
            case "ArrowRight":
                if (row?.hasChildren) {
                    if (row.open) {
                        target = rows[index + 1] ?? null;
                    } else {
                        toggle(row);
                    }
                }
                break;
            case "ArrowLeft":
                if (row?.hasChildren && row.open) {
                    toggle(row);
                } else if (row?.kind === "group") {
                    // The nearest row above at a shallower level: the folder it is in, or its category.
                    target = rows.slice(0, index).reverse()
                        .find(candidate => (candidate.kind === "category" ? 0 : candidate.level) < row.level) ?? null;
                }
                break;
            default:
                return;
        }
        event.preventDefault();
        event.stopPropagation();
        if (target && target !== row) {
            keyMoved.current = true;
            goTo(target);
        }
    };

    return (
        <div
            ref={treeRef}
            role="tree"
            tabIndex={0}
            className="min-h-0 flex-1 overflow-y-auto py-1 outline-none"
            onKeyDown={onKeyDown}
        >
            {rows.map(row => (
                <FolderTreeRow
                    key={row.kind === "category" ? `category:${row.category}` : `group:${row.group.id}`}
                    row={row}
                    current={isCurrent(row)}
                    onGoTo={() => goTo(row)}
                    onToggle={() => toggle(row)}
                    onDropOnPlace={onDropOnPlace}
                />
            ))}
        </div>
    );
}

function FolderTreeRow({ row, current, onGoTo, onToggle, onDropOnPlace }: {
    row: TreeRow;
    current: boolean;
    onGoTo: () => void;
    onToggle: () => void;
    onDropOnPlace: BrowserFolderTreeProps["onDropOnPlace"];
}) {
    const { t } = useTranslation();
    const { showContextMenu, unreadableCategories } = useAssetsPanelContext();
    const group = row.kind === "group" ? row.group : null;
    const drop = useBrowserDropTarget(row.category, (event, kind) => onDropOnPlace(event, kind, row.category, group));
    const level = row.kind === "group" ? row.level : 0;
    const CategoryIcon = ASSET_CATEGORY_ICONS[row.category];
    const label = group ? group.name : t(`assets.categories.${row.category}`);
    const unreadable = row.kind === "category" && unreadableCategories.has(row.category);

    return (
        <div
            role="treeitem"
            aria-selected={current}
            aria-expanded={row.hasChildren ? row.open : undefined}
            data-asset-browser-place={group ? `group:${group.id}` : `category:${row.category}`}
            className={cn(
                "flex h-7 items-center gap-1 pr-2 text-xs cursor-default",
                current ? "bg-primary/15 text-fg" : "text-fg-muted hover:bg-fill hover:text-fg",
                drop.over && "bg-primary/10 ring-1 ring-inset ring-primary/50",
            )}
            style={{ paddingLeft: 4 + level * INDENT_PX }}
            onClick={onGoTo}
            onContextMenu={event => (group
                ? showContextMenu(event, row.category, group, true)
                : showContextMenu(event, row.category, null, false))}
            {...drop.handlers}
        >
            {row.hasChildren ? (
                <button
                    type="button"
                    tabIndex={-1}
                    aria-hidden
                    className="flex h-5 w-3.5 shrink-0 cursor-default items-center justify-center text-fg-subtle hover:text-fg"
                    onClick={event => {
                        event.stopPropagation();
                        onToggle();
                    }}
                >
                    <ChevronRight className={cn("h-3 w-3 transition-transform duration-150", row.open && "rotate-90")} />
                </button>
            ) : (
                <span className="w-3.5 shrink-0" />
            )}
            {group
                ? <Folder className="h-3.5 w-3.5 shrink-0 text-primary" />
                : <CategoryIcon className="h-3.5 w-3.5 shrink-0" />}
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {unreadable
                ? <AlertCircle className="h-3.5 w-3.5 shrink-0 text-danger" data-tip={t("assets.unreadable.category")} />
                : row.count > 0 && <span className="shrink-0 text-2xs tabular-nums text-fg-subtle">{row.count}</span>}
        </div>
    );
}
