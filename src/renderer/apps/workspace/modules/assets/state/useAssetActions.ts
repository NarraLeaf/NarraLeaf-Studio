import { useCallback, useRef } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetType } from '@/lib/workspace/services/assets/assetTypes';
import { WorkspaceContext } from '@/lib/workspace/services/services';
import { AssetsService } from '@/lib/workspace/services/core/AssetsService';
import { UIService } from '@/lib/workspace/services/core/UIService';
import { Services } from '@/lib/workspace/services/services';
import { InputDialog } from '@/lib/components/dialogs/InputDialog';
import { ClipboardState } from './useClipboard';

export interface ContextMenuTargetState {
    type: AssetType;
    item: Asset | AssetGroup | null;
    isGroup: boolean;
}

export interface UseAssetActionsParams {
    context: WorkspaceContext | null;
    inputDialog: InputDialog | null;
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
    selectedItems: Set<string>;
    clipboard: ClipboardState | null;
    contextMenuTarget: ContextMenuTargetState | null,
    focusedItemId: string | null;
    onActionComplete: () => void; // To reload assets, clear selections, etc.
    setClipboard: (clipboard: ClipboardState | null) => void;
    /** Notify caller when a long-running action starts/ends */
    setActionLoading?: (loading: boolean) => void;
}

export function useAssetActions({
    context,
    inputDialog,
    assets,
    groups,
    selectedItems,
    clipboard,
    contextMenuTarget,
    focusedItemId,
    onActionComplete,
    setClipboard,
    setActionLoading
}: UseAssetActionsParams) {
    // Use ref to always have latest context inside callbacks to avoid stale closure issues.
    const contextRef = useRef(context);
    contextRef.current = context;

    // Helper to inform UI about loading state of long operations
    const notifyLoading = useCallback((loading: boolean) => {
        if (setActionLoading) {
            setActionLoading(loading);
        }
    }, [setActionLoading]);

    const withAssetsService = useCallback(async <T,>(handler: (service: AssetsService) => Promise<T>): Promise<T | undefined> => {
        const ctx = contextRef.current;
        if (!ctx) return undefined;
        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        return handler(assetsService);
    }, []);

    const getSelectedAssets = useCallback((): Asset[] => {
        const ids = Array.from(selectedItems).filter(id => id.startsWith('asset:')).map(id => id.replace('asset:', ''));
        return Object.values(assets).flat().filter(a => ids.includes(a.id));
    }, [selectedItems, assets]);

    const handleImport = useCallback(async (type: AssetType, groupId?: string, files?: FileList) => {
        if (!context) return;
        notifyLoading(true);
        
        await withAssetsService(async (assetsService) => {
            await assetsService.transaction(async (svc) => {
                const result = files
                    ? await svc.importFromPaths(type, Array.from(files).map(f => (f as any).path))
                    : await svc.importLocalAssets(type);

                if (!result.success) {
                    context.services.get<UIService>(Services.UI).showAlert("Failed to import assets", result.error || "Unknown error");
                    return;
                }

                if (groupId && result.data) {
                    for (const assetResult of result.data) {
                        if (assetResult.success && assetResult.data) {
                            await svc.moveAssetToGroup(assetResult.data, groupId);
                        }
                    }
                }
            });
        });

        onActionComplete();
        notifyLoading(false);
    }, [context, withAssetsService, onActionComplete, notifyLoading]);
    
    const handleImportToGroup = useCallback(async (type: AssetType, groupId?: string) => {
        notifyLoading(true);
        await handleImport(type, groupId);
        notifyLoading(false);
    }, [handleImport, notifyLoading]);

    const handleCreateGroup = useCallback(async (type: AssetType, parentGroupId?: string) => {
        notifyLoading(true);
        const groupName = inputDialog ? await inputDialog.showCreateGroupDialog(type, parentGroupId) : null;
        if (!groupName) { notifyLoading(false); return; }

        await withAssetsService(async (assetsService) => {
            const result = await assetsService.createGroup(type, groupName, parentGroupId);
            if (!result.success) {
                // TODO: Show error
            }
        });
        onActionComplete();
        notifyLoading(false);
    }, [inputDialog, withAssetsService, onActionComplete, notifyLoading]);

    // ... other actions like handleImport, handleImportToGroup

    const handleCopy = useCallback(() => {
        let assetsToCopy: Asset[] = [];
        if (selectedItems.size > 1) {
            assetsToCopy = getSelectedAssets();
        } else if (contextMenuTarget?.item && !contextMenuTarget.isGroup) {
            assetsToCopy = [contextMenuTarget.item as Asset];
        } else if (focusedItemId?.startsWith('asset:')) {
            const assetId = focusedItemId.replace('asset:', '');
            const asset = Object.values(assets).flat().find(a => a.id === assetId);
            if (asset) assetsToCopy = [asset];
        } else {
            const selected = getSelectedAssets();
            if (selected.length === 1) assetsToCopy = selected;
        }

        if (assetsToCopy.length > 0) {
            setClipboard({ type: 'copy', assets: assetsToCopy });
        }
    }, [contextMenuTarget, selectedItems, assets, focusedItemId, getSelectedAssets, setClipboard]);

    const handleCut = useCallback(() => {
        let assetsToCut: Asset[] = [];
        if (selectedItems.size > 1) {
            assetsToCut = getSelectedAssets();
        } else if (contextMenuTarget?.item && !contextMenuTarget.isGroup) {
            assetsToCut = [contextMenuTarget.item as Asset];
        } else if (focusedItemId?.startsWith('asset:')) {
            const assetId = focusedItemId.replace('asset:', '');
            const asset = Object.values(assets).flat().find(a => a.id === assetId);
            if (asset) assetsToCut = [asset];
        } else {
            const selected = getSelectedAssets();
            if (selected.length === 1) assetsToCut = selected;
        }

        if (assetsToCut.length > 0) {
            setClipboard({ type: 'cut', assets: assetsToCut });
        }
    }, [contextMenuTarget, selectedItems, assets, focusedItemId, getSelectedAssets, setClipboard]);

    const handlePaste = useCallback(async () => {
        if (!context || !clipboard) return;
        notifyLoading(true);

        let targetGroupId: string | undefined;
        if (contextMenuTarget) {
            targetGroupId = contextMenuTarget.isGroup ? (contextMenuTarget.item as AssetGroup)?.id : (contextMenuTarget.item as Asset)?.groupId;
        } else if (focusedItemId) {
            if (focusedItemId.startsWith('group:')) {
                targetGroupId = focusedItemId.replace('group:', '');
            } else if (focusedItemId.startsWith('asset:')) {
                const assetId = focusedItemId.replace('asset:', '');
                const asset = Object.values(assets).flat().find(a => a.id === assetId);
                targetGroupId = asset?.groupId;
            }
        }

        await withAssetsService(async (assetsService) => {
            await assetsService.transaction(async (svc) => {
                if (clipboard.type === 'cut') {
                    for (const a of clipboard.assets) {
                        await svc.moveAssetToGroup(a, targetGroupId);
                    }
                    setClipboard(null);
                } else if (clipboard.type === 'copy') {
                    for (const a of clipboard.assets) {
                        const dupResult = await svc.duplicateAsset(a);
                        if (dupResult.success && dupResult.data && targetGroupId) {
                            await svc.moveAssetToGroup(dupResult.data, targetGroupId);
                        }
                    }
                }
            });
        });

        onActionComplete();
        notifyLoading(false);
    }, [clipboard, context, contextMenuTarget, focusedItemId, assets, onActionComplete, withAssetsService, setClipboard, notifyLoading]);
    
    const handleRename = useCallback(async () => {
        if (!context || !contextMenuTarget?.item || !inputDialog) return;

        const { item, isGroup, type } = contextMenuTarget;
        const initialName = (item as Asset | AssetGroup).name;
        const newName = await inputDialog.showRenameDialog(initialName, isGroup ? "group" : "asset");

        if (!newName) return;

        await withAssetsService(async (assetsService) => {
            if (isGroup) {
                await assetsService.renameGroup(type, (item as AssetGroup).id, newName);
            } else {
                await assetsService.renameAsset(item as Asset, newName);
            }
        });
        onActionComplete();
    }, [context, contextMenuTarget, inputDialog, onActionComplete, withAssetsService]);

    const handleDelete = useCallback(async () => {
        notifyLoading(true);
        const ctx = contextRef.current;
        if (!ctx) { notifyLoading(false); return; }
        const uiService = ctx.services.get<UIService>(Services.UI);
        
        // Determine targets in priority order: selection > context menu target > focused item
        let targets: { isGroup: boolean; type: AssetType; item: Asset | AssetGroup }[] = [];

        if (selectedItems.size > 0) {
            const assetIds = Array.from(selectedItems).filter(id => id.startsWith('asset:')).map(id => id.replace('asset:', ''));
            const groupIds = Array.from(selectedItems).filter(id => id.startsWith('group:')).map(id => id.replace('group:', ''));

            // Add assets
            Object.values(assets).flat().forEach(a => {
                if (assetIds.includes(a.id)) {
                    targets.push({ isGroup: false, type: a.type, item: a });
                }
            });

            // Add groups
            for (const [type, groupList] of Object.entries(groups)) {
                groupList.forEach(g => {
                    if (groupIds.includes(g.id)) {
                        targets.push({ isGroup: true, type: type as AssetType, item: g });
                    }
                });
            }
        } else if (contextMenuTarget?.item) {
            targets = [{
                isGroup: contextMenuTarget.isGroup,
                type: contextMenuTarget.type,
                item: contextMenuTarget.item,
            }];
        }

        if (targets.length === 0) return;
        // Fallback: if still no targets, try using focused item
        if (targets.length === 0 && focusedItemId) {
            if (focusedItemId.startsWith('asset:')) {
                const id = focusedItemId.replace('asset:', '');
                const asset = Object.values(assets).flat().find(a => a.id === id);
                if (asset) targets.push({ isGroup: false, type: asset.type, item: asset });
            } else if (focusedItemId.startsWith('group:')) {
                const id = focusedItemId.replace('group:', '');
                for (const [type, groupList] of Object.entries(groups)) {
                    const g = groupList.find(gr => gr.id === id);
                    if (g) {
                        targets.push({ isGroup: true, type: type as AssetType, item: g });
                        break;
                    }
                }
            }
        }

        if (targets.length === 0) return;

        const confirmed = await uiService.showConfirm(`Delete ${targets.length} item(s)?`, 'All assets in the group will be deleted. This cannot be undone.');
        if (!confirmed) return;

        // Remove duplicate targets by id to avoid double deletion
        const uniqueTargets = Array.from(new Map(targets.map(t => [t.item.id, t])).values());

        await withAssetsService(async (assetsService) => {
            await assetsService.transaction(async (svc) => {
                await Promise.all(uniqueTargets.map(async (t) => {
                    if (t.isGroup) {
                        await svc.deleteGroup(t.type, (t.item as AssetGroup).id, true);
                    } else {
                        await svc.deleteAsset(t.item as Asset);
                    }
                }));

                // After batch deletions, clean up any empty groups and persist once
                await svc.cleanupEmptyGroupsPersist();
            });
        });
        onActionComplete();
        notifyLoading(false);
    }, [selectedItems, assets, groups, contextMenuTarget, onActionComplete, withAssetsService, focusedItemId, notifyLoading]);


    return {
        handleCreateGroup,
        handleImport,
        handleImportToGroup,
        handleCopy,
        handleCut,
        handlePaste,
        handleRename,
        handleDelete,
    };
}
