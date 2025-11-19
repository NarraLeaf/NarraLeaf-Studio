import { useState, useCallback, DragEvent } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetType } from '@/lib/workspace/services/assets/assetTypes';
import { WorkspaceContext } from '@/lib/workspace/services/services';
import { AssetsService } from '@/lib/workspace/services/core/AssetsService';
import { Services } from '@/lib/workspace/services/services';

export interface DraggedItemState {
    type: AssetType;
    item: Asset | AssetGroup;
    isGroup: boolean;
}

export interface UseDragAndDropParams {
    context: WorkspaceContext | null;
    groups: Record<AssetType, AssetGroup[]>;
    onDropCompleted: () => void; // To trigger a reload of assets
}

export function useDragAndDrop({ context, groups, onDropCompleted }: UseDragAndDropParams) {
    const [draggedItem, setDraggedItem] = useState<DraggedItemState | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);

    const isDescendantGroup = useCallback((ancestorId: string, descendantId: string, groupsList: AssetGroup[]): boolean => {
        const descendant = groupsList.find((groupItem) => groupItem.id === descendantId);
        if (!descendant || !descendant.parentGroupId) return false;
        if (descendant.parentGroupId === ancestorId) return true;
        return isDescendantGroup(ancestorId, descendant.parentGroupId, groupsList);
    }, []);

    const handleDragStart = useCallback((event: DragEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => {
        event.stopPropagation();
        setDraggedItem({ type, item, isGroup });
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", ""); // Necessary for Firefox
    }, []);

    const handleDragEnd = useCallback(() => {
        setDraggedItem(null);
        setDropTargetId(null);
    }, []);

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

        if (draggedItem || isExternalFiles) {
            setDropTargetId(targetId);
            // Show proper cursor depending on source
            event.dataTransfer.dropEffect = draggedItem ? "move" : "copy";
        }
    }, [draggedItem]);

    const handleDropOnItem = useCallback(async (event: DragEvent, targetType: AssetType, targetGroup: AssetGroup | null) => {
        event.preventDefault();
        event.stopPropagation();

        if (!context || !draggedItem) return;

        const assetsService = context.services.get<AssetsService>(Services.Assets);

        if (draggedItem.type === targetType) {
            if (draggedItem.isGroup) {
                const group = draggedItem.item as AssetGroup;
                const targetGroupId = targetGroup?.id;
                if (targetGroupId && (group.id === targetGroupId || isDescendantGroup(group.id, targetGroupId, groups[targetType]))) {
                    // TODO: Show an error to the user
                    console.error("Cannot move a group into itself or its descendants");
                    return;
                }
                await assetsService.moveGroupToParent(targetType, group.id, targetGroupId ?? undefined);
            } else {
                const asset = draggedItem.item as Asset;
                await assetsService.moveAssetToGroup(asset, targetGroup?.id);
            }
        }
        
        onDropCompleted();
        setDragOver(false);
        setDropTargetId(null);
    }, [context, draggedItem, groups, isDescendantGroup, onDropCompleted]);

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
