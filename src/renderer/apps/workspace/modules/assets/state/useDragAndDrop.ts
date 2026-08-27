import { useState, useCallback, DragEvent } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetCategory, categoryOfAssetType } from '@/lib/workspace/services/assets/assetTypes';
import { WorkspaceContext } from '@/lib/workspace/services/services';
import { AssetsService } from '@/lib/workspace/services/core/AssetsService';
import { Services } from '@/lib/workspace/services/services';
import {
    ASSET_DRAG_MIME,
    collectAssetsForWorkspaceDrag,
    encodeAssetDragPayload,
    isWorkspaceAssetDragEvent,
} from "@/apps/workspace/modules/assets/dnd/assetDragContract";
import { applyMultiAssetDragImage } from "@/apps/workspace/modules/assets/dnd/multiAssetDragImage";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { assetLibraryFreezeScope } from "../assetLiveSession";

/** Report ids moved by an in-panel drop so cut-clipboard styling can be updated. */
export interface InternalAssetDropCompletedInfo {
    movedAssetIds: string[];
    movedGroupIds: string[];
}

export interface DraggedItemState {
    /**
     * The sidebar section the drag started in. A category, not a type: a folder under "Media" takes
     * audio and video alike, and the refusal that still stands is the cross-*category* one.
     */
    category: AssetCategory;
    item: Asset | AssetGroup;
    isGroup: boolean;
}

/**
 * A set being dragged to another folder.
 *
 * Held apart from {@link DraggedItemState} rather than folded into it: that one is what the
 * workspace-wide asset drag is encoded from, and a set is not a file - dropping it on an editor has
 * nothing to hand over. Only the folders and the section roots in this panel answer to it.
 */
export interface DraggedAssetSetState {
    category: AssetCategory;
    setId: string;
}

export interface UseDragAndDropParams {
    context: WorkspaceContext | null;
    groups: Record<AssetCategory, AssetGroup[]>;
    /** Called after a successful in-panel move; pass moved ids so cut clipboard can be pruned. */
    onDropCompleted: (info?: InternalAssetDropCompletedInfo) => void;
    /** Current selection keys (`asset:id` / `group:id`) for multi-asset workspace drag. */
    selectedItems: Set<string>;
    filteredGroups: Record<AssetCategory, AssetGroup[]>;
    filteredAssets: Record<AssetCategory, Asset[]>;
    panelId: string;
    onWorkspaceDragSessionStart?: (assets: Asset[], primaryId: string, sourcePanelId?: string) => void;
    onWorkspaceDragSessionEnd?: () => void;
    /**
     * File a dragged set in another folder. Absent while the panel has no sets to drag.
     *
     * The move itself is the panel's: it takes the sets nested inside the dragged one and the files
     * they answer with, and both of those are readings of the library this hook does not hold.
     */
    onAssetSetDrop?: (setId: string, targetCategory: AssetCategory, targetGroupId?: string) => Promise<void> | void;
}

export function useDragAndDrop({
    context,
    groups,
    onDropCompleted,
    selectedItems,
    filteredGroups,
    filteredAssets,
    panelId,
    onWorkspaceDragSessionStart,
    onWorkspaceDragSessionEnd,
    onAssetSetDrop,
}: UseDragAndDropParams) {
    // Dropping INTO the panel moves or imports, so it is off while frozen. Dragging OUT of it is not:
    // that is how an author hands an asset to another editor, the receiving side refuses its own write,
    // and killing it would break a read-only gesture in the name of a freeze. So `handleDragStart` is
    // deliberately left alone and only the drop targets stop lighting up.
    const freeze = useFreezeGuard();
    /**
     * The asset library's own guard: filing rows, moving folders, and importing from the desktop.
     *
     * All three write the library and a session carries all three, so they share one answer. What
     * still reads {@link freeze} is the asset SET drop beside them, which writes a different document
     * that has no verbs.
     */
    const libraryFreeze = useFreezeGuard(assetLibraryFreezeScope());
    const [draggedItem, setDraggedItem] = useState<DraggedItemState | null>(null);
    const [draggedAssetSet, setDraggedAssetSet] = useState<DraggedAssetSetState | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const isDescendantGroup = useCallback((ancestorId: string, descendantId: string, groupsList: AssetGroup[]): boolean => {
        const descendant = groupsList.find((groupItem) => groupItem.id === descendantId);
        if (!descendant || !descendant.parentGroupId) return false;
        if (descendant.parentGroupId === ancestorId) return true;
        return isDescendantGroup(ancestorId, descendant.parentGroupId, groupsList);
    }, []);

    const handleDragStart = useCallback(
        (event: DragEvent, category: AssetCategory, item: Asset | AssetGroup, isGroup: boolean) => {
            event.stopPropagation();
            setDraggedItem({ category, item, isGroup });

            if (isGroup) {
                onWorkspaceDragSessionEnd?.();
                event.dataTransfer.effectAllowed = "move";
                event.dataTransfer.setData("text/plain", "");
                return;
            }

            const asset = item as Asset;
            const dragAssets = collectAssetsForWorkspaceDrag(asset, selectedItems, filteredGroups, filteredAssets);
            const payload = encodeAssetDragPayload(dragAssets, asset.id, panelId);
            event.dataTransfer.effectAllowed = "copyMove";
            event.dataTransfer.setData(ASSET_DRAG_MIME, payload);
            const plainLabel = dragAssets.map(a => a.name).join(", ") || asset.name || " ";
            event.dataTransfer.setData("text/plain", plainLabel);
            applyMultiAssetDragImage(event, dragAssets.length);
            onWorkspaceDragSessionStart?.(dragAssets, asset.id, panelId);
        },
        [
            filteredAssets,
            filteredGroups,
            onWorkspaceDragSessionEnd,
            onWorkspaceDragSessionStart,
            panelId,
            selectedItems,
        ]
    );

    /**
     * Start dragging a set's row.
     *
     * Nothing is put on the data transfer beyond what a drag needs to exist: a set is a row in this
     * panel and means nothing anywhere else, so an editor it is dropped on must receive nothing
     * rather than something it would have to refuse.
     */
    const handleAssetSetDragStart = useCallback((event: DragEvent, category: AssetCategory, setId: string) => {
        event.stopPropagation();
        onWorkspaceDragSessionEnd?.();
        setDraggedItem(null);
        setDraggedAssetSet({ category, setId });
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "");
    }, [onWorkspaceDragSessionEnd]);

    const handleDragEnd = useCallback(() => {
        setDraggedItem(null);
        setDraggedAssetSet(null);
        setDropTargetId(null);
        onWorkspaceDragSessionEnd?.();
    }, [onWorkspaceDragSessionEnd]);

    const handlePanelDragOver = useCallback((event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        if (freeze.frozen) {
            return;
        }
        setDragOver(true);
    }, [freeze]);

    const handlePanelDragLeave = useCallback((event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        setDropTargetId(null);
    }, []);
    
    // When dragging over an internal item or external files, mark current item as potential drop target
    const handleDragOverItem = useCallback((event: DragEvent, targetId: string) => {
        event.preventDefault();
        event.stopPropagation();

        // The looser of the two, because this only lights a target up: the drop itself asks the
        // guard that matches what is being dropped, and a target that never lit would make filing a
        // row inside a session look broken rather than refused.
        if (freeze.frozen && libraryFreeze.frozen) {
            return;
        }
        const isExternalFiles = event.dataTransfer.types.includes("Files");
        const isExternalAssetDrag = isWorkspaceAssetDragEvent(event.dataTransfer) && !draggedItem;

        if (draggedItem || isExternalFiles || isExternalAssetDrag) {
            setDropTargetId(targetId);
            if (draggedItem) {
                event.dataTransfer.dropEffect = "move";
            } else if (isExternalAssetDrag) {
                event.dataTransfer.dropEffect = "copy";
            } else {
                event.dataTransfer.dropEffect = "copy";
            }
        }
    }, [draggedItem, freeze, libraryFreeze]);

    const handleDropOnItem = useCallback(
        async (event: DragEvent, targetCategory: AssetCategory, targetGroup: AssetGroup | null) => {
            event.preventDefault();
            event.stopPropagation();

            // ⚠ Not `freeze.frozen` alone. The branches below split into three drops with three
            // answers - a set's files and an import write bytes, a folder move writes the folder
            // tree, and filing rows writes the metadata a session carries - so each asks its own
            // guard rather than one answer standing for all of them.
            if (!context || (freeze.frozen && libraryFreeze.frozen)) return;

            // A set first: it is its own drag, and the branches below all read `draggedItem`.
            if (draggedAssetSet) {
                const { setId, category } = draggedAssetSet;
                setDraggedAssetSet(null);
                setDragOver(false);
                setDropTargetId(null);
                if (category === targetCategory && !freeze.frozen) {
                    await onAssetSetDrop?.(setId, targetCategory, targetGroup?.id);
                }
                return;
            }

            if (!draggedItem) return;

            const assetsService = context.services.get<AssetsService>(Services.Assets);

            // Cross-*category* drops are still refused; cross-type ones inside a category are the
            // whole point of the category (an mp3 and an mp4 in the same folder).
            if (draggedItem.category !== targetCategory) {
                setDragOver(false);
                setDropTargetId(null);
                return;
            }

            if (draggedItem.isGroup) {
                const group = draggedItem.item as AssetGroup;
                const targetGroupId = targetGroup?.id;
                if (
                    targetGroupId &&
                    (group.id === targetGroupId || isDescendantGroup(group.id, targetGroupId, groups[targetCategory]))
                ) {
                    console.error("Cannot move a group into itself or its descendants");
                    setDragOver(false);
                    setDropTargetId(null);
                    return;
                }
                const groupStatus = await assetsService.moveGroupToParent(
                    targetCategory,
                    group.id,
                    targetGroupId ?? undefined
                );
                if (!groupStatus.success) {
                    setDragOver(false);
                    setDropTargetId(null);
                    return;
                }
                setDraggedItem(null);
                onWorkspaceDragSessionEnd?.();
                onDropCompleted({ movedAssetIds: [], movedGroupIds: [group.id] });
            } else {
                const primary = draggedItem.item as Asset;
                const candidates = collectAssetsForWorkspaceDrag(
                    primary,
                    selectedItems,
                    filteredGroups,
                    filteredAssets
                ).filter(a => categoryOfAssetType(a.type) === targetCategory);

                if (candidates.length === 0) {
                    setDragOver(false);
                    setDropTargetId(null);
                    return;
                }

                // One call for the whole selection, which is what makes it one operation inside a
                // session: the service groups the rows by type and states one per shard. Sent row by
                // row it would be a press per row to take back, and every other screen in the room
                // would draw the library half-filed.
                const status = await assetsService.moveAssetsToGroup(candidates, targetGroup?.id);
                if (!status.success) {
                    setDragOver(false);
                    setDropTargetId(null);
                    return;
                }
                const movedAssetIds = candidates.map(asset => asset.id);
                setDraggedItem(null);
                onWorkspaceDragSessionEnd?.();
                onDropCompleted({ movedAssetIds, movedGroupIds: [] });
            }

            setDragOver(false);
            setDropTargetId(null);
        },
        [
            context,
            draggedAssetSet,
            draggedItem,
            filteredAssets,
            filteredGroups,
            freeze,
            libraryFreeze,
            groups,
            isDescendantGroup,
            onAssetSetDrop,
            onDropCompleted,
            onWorkspaceDragSessionEnd,
            selectedItems,
        ]
    );

    return {
        draggedItem,
        draggedAssetSet,
        dropTargetId,
        dragOver,
        setDragOver,
        setDropTargetId,
        handleDragStart,
        handleAssetSetDragStart,
        handleDragEnd,
        handlePanelDragOver,
        handlePanelDragLeave,
        handleDragOverItem,
        handleDropOnItem,
    };
}
