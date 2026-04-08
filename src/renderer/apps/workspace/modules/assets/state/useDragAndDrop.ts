import { useState, useCallback, DragEvent } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetType } from '@/lib/workspace/services/assets/assetTypes';
import { WorkspaceContext } from '@/lib/workspace/services/services';
import { AssetsService } from '@/lib/workspace/services/core/AssetsService';
import { Services } from '@/lib/workspace/services/services';
import {
    ASSET_DRAG_MIME,
    collectAssetsForWorkspaceDrag,
    encodeAssetDragPayload,
    isWorkspaceAssetDragEvent,
} from "@/apps/workspace/modules/assets/dnd/assetDragContract";

export interface DraggedItemState {
    type: AssetType;
    item: Asset | AssetGroup;
    isGroup: boolean;
}

export interface UseDragAndDropParams {
    context: WorkspaceContext | null;
    groups: Record<AssetType, AssetGroup[]>;
    onDropCompleted: () => void; // To trigger a reload of assets
    /** Current selection keys (`asset:id` / `group:id`) for multi-asset workspace drag. */
    selectedItems: Set<string>;
    filteredGroups: Record<AssetType, AssetGroup[]>;
    filteredAssets: Record<AssetType, Asset[]>;
    panelId: string;
    onWorkspaceDragSessionStart?: (assets: Asset[], primaryId: string, sourcePanelId?: string) => void;
    onWorkspaceDragSessionEnd?: () => void;
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
}: UseDragAndDropParams) {
    const [draggedItem, setDraggedItem] = useState<DraggedItemState | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const isDescendantGroup = useCallback((ancestorId: string, descendantId: string, groupsList: AssetGroup[]): boolean => {
        const descendant = groupsList.find((groupItem) => groupItem.id === descendantId);
        if (!descendant || !descendant.parentGroupId) return false;
        if (descendant.parentGroupId === ancestorId) return true;
        return isDescendantGroup(ancestorId, descendant.parentGroupId, groupsList);
    }, []);

    const handleDragStart = useCallback(
        (event: DragEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => {
            event.stopPropagation();
            setDraggedItem({ type, item, isGroup });

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

    const handleDragEnd = useCallback(() => {
        setDraggedItem(null);
        setDropTargetId(null);
        onWorkspaceDragSessionEnd?.();
    }, [onWorkspaceDragSessionEnd]);

    const handlePanelDragOver = useCallback((event: DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(true);
    }, []);

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
    }, [draggedItem]);

    const handleDropOnItem = useCallback(
        async (event: DragEvent, targetType: AssetType, targetGroup: AssetGroup | null) => {
            event.preventDefault();
            event.stopPropagation();

            if (!context || !draggedItem) return;

            const assetsService = context.services.get<AssetsService>(Services.Assets);

            if (draggedItem.type !== targetType) {
                setDragOver(false);
                setDropTargetId(null);
                return;
            }

            if (draggedItem.isGroup) {
                const group = draggedItem.item as AssetGroup;
                const targetGroupId = targetGroup?.id;
                if (
                    targetGroupId &&
                    (group.id === targetGroupId || isDescendantGroup(group.id, targetGroupId, groups[targetType]))
                ) {
                    console.error("Cannot move a group into itself or its descendants");
                    setDragOver(false);
                    setDropTargetId(null);
                    return;
                }
                await assetsService.moveGroupToParent(targetType, group.id, targetGroupId ?? undefined);
            } else {
                const primary = draggedItem.item as Asset;
                const candidates = collectAssetsForWorkspaceDrag(
                    primary,
                    selectedItems,
                    filteredGroups,
                    filteredAssets
                ).filter(a => a.type === targetType);

                if (candidates.length === 0) {
                    setDragOver(false);
                    setDropTargetId(null);
                    return;
                }

                for (const asset of candidates) {
                    await assetsService.moveAssetToGroup(asset, targetGroup?.id);
                }
            }

            onDropCompleted();
            setDragOver(false);
            setDropTargetId(null);
        },
        [
            context,
            draggedItem,
            filteredAssets,
            filteredGroups,
            groups,
            isDescendantGroup,
            onDropCompleted,
            selectedItems,
        ]
    );

    return {
        draggedItem,
        dropTargetId,
        dragOver,
        setDragOver,
        setDropTargetId,
        handleDragStart,
        handleDragEnd,
        handlePanelDragOver,
        handlePanelDragLeave,
        handleDragOverItem,
        handleDropOnItem,
    };
}
