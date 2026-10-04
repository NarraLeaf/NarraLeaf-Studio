import { useCallback, useState } from "react";
import type { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetGroup } from "@/lib/workspace/services/assets/types";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { isWorkspaceAssetDragEvent } from "../dnd/assetDragContract";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { assetLibraryFreezeScope } from "../assetLiveSession";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import type { AssetBrowserItem } from "./assetBrowserModel";

/**
 * What the browser does with a press, a double press, a right press and a drag on one item.
 *
 * Shared by the grid and the table, which draw the same items two ways and must answer to them the
 * same way. The gestures are the ones every file browser has: one click marks an item (and shows a
 * file in the preview tab, as it does everywhere in the library), a double click goes into a folder
 * or a set or keeps a file's tab, and dragging takes a file to an editor or a folder.
 *
 * A folder no longer opens on a single click. The tree beside the contents is how the author moves
 * around, so a click is free to mean what it means on a file - mark it - and a folder can be renamed,
 * cut or dragged without first being walked into.
 */
export function useBrowserItemGestures({
    insideSet,
    onEnterGroup,
    onEnterSet,
}: {
    /** The set being walked through, which a value's menu is about. */
    insideSet: ResolvedAssetSet | null;
    onEnterGroup: (category: AssetCategory, group: AssetGroup) => void;
    onEnterSet: (entry: ResolvedAssetSet) => void;
}) {
    const {
        handleItemSelect,
        handleAssetClick,
        handleAssetOpen,
        handleGroupFocus,
        handleAssetSetSelect,
        showContextMenu,
        showAssetSetContextMenu,
        showAssetSetValueContextMenu,
        handleDragStart,
        handleAssetSetDragStart,
        handleDragEnd,
        isMultiSelectMode,
    } = useAssetsPanelContext();

    // Left to bubble: the panel takes focus from the press (which is what scopes its shortcuts), and
    // the contents tell a press on an item from one on empty space by where it landed.
    const onClick = useCallback((item: AssetBrowserItem, event: React.MouseEvent) => {
        switch (item.kind) {
            case "group":
                handleItemSelect(item.group.id, true, event);
                handleGroupFocus(item.group.id);
                return;
            case "asset": {
                const multi = event.ctrlKey || event.metaKey || event.shiftKey;
                handleItemSelect(item.asset.id, false, event);
                handleAssetClick(item.asset, multi || isMultiSelectMode);
                return;
            }
            case "set":
                handleAssetSetSelect(item.entry);
                return;
            default:
                return;
        }
    }, [handleAssetClick, handleAssetSetSelect, handleGroupFocus, handleItemSelect, isMultiSelectMode]);

    const onOpen = useCallback((item: AssetBrowserItem) => {
        switch (item.kind) {
            case "group":
                onEnterGroup(item.category, item.group);
                return;
            case "set":
                onEnterSet(item.entry);
                return;
            case "asset":
                handleAssetOpen(item.asset);
                return;
            default:
                return;
        }
    }, [handleAssetOpen, onEnterGroup, onEnterSet]);

    const onContextMenu = useCallback((item: AssetBrowserItem, event: React.MouseEvent) => {
        switch (item.kind) {
            case "group":
                showContextMenu(event, item.category, item.group, true);
                return;
            case "asset":
                showContextMenu(event, item.category, item.asset, false, item.assetSetValue);
                return;
            case "set":
                showAssetSetContextMenu(event, item.entry);
                return;
            default:
                if (insideSet) {
                    showAssetSetValueContextMenu(event, insideSet, item.value);
                } else {
                    event.preventDefault();
                    event.stopPropagation();
                }
        }
    }, [insideSet, showAssetSetContextMenu, showAssetSetValueContextMenu, showContextMenu]);

    /**
     * The drag an item starts, or undefined for one that does not move.
     *
     * A file drawn inside a set stays: which set a file answers is written in its tags, so a drop
     * somewhere else would move a tile the set goes on drawing exactly where it was. A set drawn as
     * the answer to another set's value moves with that set.
     */
    const dragStartFor = useCallback((item: AssetBrowserItem): ((event: React.DragEvent) => void) | undefined => {
        switch (item.kind) {
            case "group":
                return event => handleDragStart?.(event, item.category, item.group, true);
            case "asset":
                return item.assetSetValue ? undefined : event => handleDragStart?.(event, item.category, item.asset, false);
            case "set":
                return item.movable ? event => handleAssetSetDragStart?.(event, item.category, item.entry.set.id) : undefined;
            default:
                return undefined;
        }
    }, [handleAssetSetDragStart, handleDragStart]);

    const onDragEnd = useCallback(() => handleDragEnd?.(), [handleDragEnd]);

    return { onClick, onOpen, onContextMenu, dragStartFor, onDragEnd };
}

/**
 * A place things can be dropped on: a folder tile or row, a tree row, a segment of the path, or the
 * empty space around the contents.
 *
 * Lights up only for what it would take - a file or folder from this panel in the same category, a
 * set from it, or files from the desktop - and never while the library is frozen: a target that
 * glows and then keeps its old contents reads as a bug.
 *
 * The drag-over still accepts whatever it is offered (`preventDefault` on every pass), as the
 * library's other drop targets do: what is being dragged is read from React state that a native
 * drag's nested loop may not have delivered yet, and a target that refused on a stale answer would
 * never see the drop at all. The drop itself decides, with the state it has by then: a move from
 * this panel, or files from the desktop, and nothing else. A file dragged in from the other assets
 * panel is neither, and passed to the import it would have opened a file picker out of nowhere.
 */
export function useBrowserDropTarget(
    category: AssetCategory | null,
    onDrop: (event: React.DragEvent, kind: "move" | "files") => void,
) {
    const freeze = useFreezeGuard(assetLibraryFreezeScope());
    const { draggedItem, draggedAssetSet } = useAssetsPanelContext();
    const [over, setOver] = useState(false);

    const accepts = useCallback((event: React.DragEvent): "move" | "copy" | null => {
        if (!category || freeze.frozen) {
            return null;
        }
        if (draggedItem) {
            return draggedItem.category === category ? "move" : null;
        }
        if (draggedAssetSet) {
            return draggedAssetSet.category === category ? "move" : null;
        }
        if (isWorkspaceAssetDragEvent(event.dataTransfer)) {
            return null;
        }
        return event.dataTransfer.types.includes("Files") ? "copy" : null;
    }, [category, draggedAssetSet, draggedItem, freeze.frozen]);

    const handlers = {
        onDragOver: (event: React.DragEvent) => {
            if (!category || freeze.frozen) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            const effect = accepts(event);
            if (effect) {
                event.dataTransfer.dropEffect = effect;
            }
            setOver(effect !== null);
        },
        onDragLeave: (event: React.DragEvent) => {
            // Leaving into a child of this target is still over it.
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                return;
            }
            setOver(false);
        },
        onDrop: (event: React.DragEvent) => {
            setOver(false);
            if (!category || freeze.frozen) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            if (draggedItem || draggedAssetSet) {
                const sameCategory = (draggedItem ?? draggedAssetSet)!.category === category;
                if (sameCategory) {
                    onDrop(event, "move");
                }
                return;
            }
            if (event.dataTransfer.files.length > 0 && !isWorkspaceAssetDragEvent(event.dataTransfer)) {
                onDrop(event, "files");
            }
        },
    };

    return { over, handlers };
}
