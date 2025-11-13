import { useCallback, useEffect, useState } from "react";
import type { DragEvent } from "react";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { InputDialog } from "@/lib/components/dialogs/InputDialog";
import { Image } from "lucide-react";
import { ImagePreviewEditor } from "../editors/ImagePreviewEditor";
import type { WorkspaceContext } from "@/lib/workspace/services/services";

export interface ClipboardState {
    type: "copy" | "cut";
    asset: Asset | null;
}

export interface DraggedItemState {
    type: AssetType;
    item: Asset | AssetGroup;
    isGroup: boolean;
}

export interface ContextMenuTargetState {
    type: AssetType;
    item: Asset | AssetGroup | null;
    isGroup: boolean;
}

export interface UseAssetsPanelStateParams {
    context: WorkspaceContext | null;
    isInitialized: boolean;
    panelId: string;
    inputDialog: InputDialog | null;
}

export interface UseAssetsPanelStateResult {
    assets: Record<AssetType, Asset[]>;
    groups: Record<AssetType, AssetGroup[]>;
    loading: boolean;
    error: string | null;
    dragOver: boolean;
    clipboard: ClipboardState | null;
    draggedItem: DraggedItemState | null;
    dropTargetId: string | null;
    focusedItemId: string | null;
    contextMenuTarget: ContextMenuTargetState | null;
    setContextMenuTarget: (target: ContextMenuTargetState | null) => void;
    setClipboard: (state: ClipboardState | null) => void;
    setDraggedItem: (state: DraggedItemState | null) => void;
    setDropTargetId: (id: string | null) => void;
    setDragOver: (value: boolean) => void;
    setFocusedItemId: (value: string | null) => void;
    setError: (value: string | null) => void;
    loadAssets: () => Promise<void>;
    handleDrop: (event: DragEvent, type: AssetType) => Promise<void>;
    handleAssetClick: (asset: Asset) => void;
    handleGroupFocus: (groupId: string) => void;
    handleCreateGroup: (type: AssetType, parentGroupId?: string) => Promise<void>;
    handleImport: (type: AssetType) => Promise<void>;
    handleImportToGroup: (type: AssetType, groupId?: string) => Promise<void>;
    handleCopy: () => void;
    handleCut: () => void;
    handlePaste: () => Promise<void>;
    handleRename: () => Promise<void>;
    handleDelete: () => Promise<void>;
    handleDragStart: (event: DragEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => void;
    handleDragEnd: () => void;
    handleDragOverItem: (event: DragEvent, targetId: string) => void;
    handleDropOnItem: (event: DragEvent, targetType: AssetType, targetGroup: AssetGroup | null) => Promise<void>;
    isDescendantGroup: (ancestorId: string, descendantId: string, groupsList: AssetGroup[]) => boolean;
}

const createEmptyAssets = (): Record<AssetType, Asset[]> => ({
    [AssetType.Image]: [],
    [AssetType.Audio]: [],
    [AssetType.Video]: [],
    [AssetType.JSON]: [],
    [AssetType.Font]: [],
    [AssetType.Other]: [],
});

const createEmptyGroups = (): Record<AssetType, AssetGroup[]> => ({
    [AssetType.Image]: [],
    [AssetType.Audio]: [],
    [AssetType.Video]: [],
    [AssetType.JSON]: [],
    [AssetType.Font]: [],
    [AssetType.Other]: [],
});

export function useAssetsPanelState({
    context,
    isInitialized,
    panelId,
    inputDialog,
}: UseAssetsPanelStateParams): UseAssetsPanelStateResult {
    const [assets, setAssets] = useState<Record<AssetType, Asset[]>>(createEmptyAssets);
    const [groups, setGroups] = useState<Record<AssetType, AssetGroup[]>>(createEmptyGroups);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
    const [contextMenuTarget, setContextMenuTarget] = useState<ContextMenuTargetState | null>(null);
    const [clipboard, setClipboard] = useState<ClipboardState | null>(null);
    const [draggedItem, setDraggedItem] = useState<DraggedItemState | null>(null);
    const [dropTargetId, setDropTargetId] = useState<string | null>(null);

    const loadAssets = useCallback(async () => {
        if (!context) {
            return;
        }

        setLoading(true);
        setError(null);

        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const assetsMap = assetsService.getAssets();

            const newAssets: Record<AssetType, Asset[]> = createEmptyAssets();
            const newGroups: Record<AssetType, AssetGroup[]> = createEmptyGroups();

            for (const type of Object.values(AssetType)) {
                newAssets[type] = Object.values(assetsMap[type]);
                newGroups[type] = assetsService.getGroups(type);
            }

            setAssets(newAssets);
            setGroups(newGroups);
        } catch (err) {
            console.error("Failed to load assets:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    }, [context]);

    useEffect(() => {
        if (isInitialized) {
            loadAssets();
        }
    }, [isInitialized, loadAssets]);

    useEffect(() => {
        if (!context || !isInitialized) {
            return;
        }

        const uiService = context.services.get<UIService>(Services.UI);
        const unsubscribe = uiService.focus.onFocusChange((focusContext) => {
            if (focusContext.area === FocusArea.LeftPanel && focusContext.targetId === panelId) {
                return;
            }
        });

        return unsubscribe;
    }, [context, isInitialized, panelId]);

    const withAssetsService = useCallback(async <T,>(handler: (service: AssetsService) => Promise<T>): Promise<T | undefined> => {
        if (!context) {
            return undefined;
        }
        const assetsService = context.services.get<AssetsService>(Services.Assets);
        return handler(assetsService);
    }, [context]);

    const handleDrop = useCallback(async (event: DragEvent, type: AssetType) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);

        if (!context) {
            return;
        }

        const files = Array.from(event.dataTransfer.files);
        if (files.length === 0) {
            return;
        }

        const paths = files.map((file) => (file as any).path).filter(Boolean);
        if (paths.length === 0) {
            return;
        }

        setLoading(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const result = await assetsService.importFromPaths(type, paths);
            
            if (!result.success) {
                const uiService = context.services.get<UIService>(Services.UI);
                await uiService.showAlert(
                    "Failed to import assets",
                    result.error || "Unknown error occurred"
                );
                setError(result.error || "Failed to import assets");
                return;
            }

            // Check for individual file import errors
            if (result.data) {
                const failedImports = result.data.filter(r => !r.success);
                if (failedImports.length > 0) {
                    const successCount = result.data.length - failedImports.length;
                    const errorMessages = failedImports
                        .map(r => r.error || "Unknown error")
                        .filter(Boolean)
                        .join("\n");
                    
                    const uiService = context.services.get<UIService>(Services.UI);
                    await uiService.showAlert(
                        "Partial import failure",
                        `${successCount} asset(s) imported successfully, ${failedImports.length} failed:\n\n${errorMessages}`
                    );
                }
            }

            await loadAssets();
        } catch (err) {
            console.error("Failed to import assets:", err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage);
            
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                await uiService.showAlert("Failed to import assets", errorMessage);
            }
        } finally {
            setLoading(false);
        }
    }, [context, loadAssets]);

    const handleAssetClick = useCallback((asset: Asset) => {
        if (!context) {
            return;
        }

        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: "asset", data: asset });
        uiService.focus.setFocus(FocusArea.LeftPanel, `asset:${asset.id}`);
        setFocusedItemId(`asset:${asset.id}`);

        if (asset.type === AssetType.Image) {
            uiService.editor.open({
                id: `image-preview:${asset.id}`,
                title: asset.name,
                icon: <Image className="w-4 h-4" />,
                component: ImagePreviewEditor,
                closable: true,
                payload: { asset: asset as Asset<AssetType.Image> },
            });
        }

        uiService.panels.show("narraleaf-studio:properties");
    }, [context]);

    const handleGroupFocus = useCallback((groupId: string) => {
        if (!context) {
            return;
        }

        const uiService = context.services.get<UIService>(Services.UI);
        uiService.focus.setFocus(FocusArea.LeftPanel, `group:${groupId}`);
        setFocusedItemId(`group:${groupId}`);
    }, [context]);

    const handleCreateGroup = useCallback(async (type: AssetType, parentGroupId?: string) => {
        if (!context) {
            return;
        }

        const groupName = inputDialog ? await inputDialog.showCreateGroupDialog(type, parentGroupId) : null;
        if (!groupName) {
            return;
        }

        await withAssetsService(async (assetsService) => {
            const result = await assetsService.createGroup(type, groupName, parentGroupId);
            if (!result.success) {
                setError(result.error || "Failed to create group");
                return;
            }
            await loadAssets();
        });
    }, [context, inputDialog, loadAssets, withAssetsService]);

    const handleImport = useCallback(async (type: AssetType) => {
        if (!context) {
            return;
        }

        setLoading(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const result = await assetsService.importLocalAssets(type);
            
            if (!result.success) {
                const uiService = context.services.get<UIService>(Services.UI);
                await uiService.showAlert(
                    "Failed to import assets",
                    result.error || "Unknown error occurred"
                );
                setError(result.error || "Failed to import assets");
                return;
            }

            // Check for individual file import errors
            if (result.data) {
                const failedImports = result.data.filter(r => !r.success);
                if (failedImports.length > 0) {
                    const successCount = result.data.length - failedImports.length;
                    const errorMessages = failedImports
                        .map(r => r.error || "Unknown error")
                        .filter(Boolean)
                        .join("\n");
                    
                    const uiService = context.services.get<UIService>(Services.UI);
                    await uiService.showAlert(
                        "Partial import failure",
                        `${successCount} asset(s) imported successfully, ${failedImports.length} failed:\n\n${errorMessages}`
                    );
                }
            }

            await loadAssets();
        } catch (err) {
            console.error("Failed to import assets:", err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage);
            
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                await uiService.showAlert("Failed to import assets", errorMessage);
            }
        } finally {
            setLoading(false);
        }
    }, [context, loadAssets]);

    const handleImportToGroup = useCallback(async (type: AssetType, groupId?: string) => {
        if (!context) {
            return;
        }

        setLoading(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const result = await assetsService.importLocalAssets(type);
            
            if (!result.success) {
                const uiService = context.services.get<UIService>(Services.UI);
                await uiService.showAlert(
                    "Failed to import assets",
                    result.error || "Unknown error occurred"
                );
                setError(result.error || "Failed to import assets");
                return;
            }

            // Check for individual file import errors
            let hasErrors = false;
            const failedImports: string[] = [];
            
            if (result.data) {
                const failed = result.data.filter(r => !r.success);
                if (failed.length > 0) {
                    hasErrors = true;
                    failed.forEach(r => {
                        if (r.error) failedImports.push(r.error);
                    });
                }

                if (groupId && result.data) {
                    for (const assetResult of result.data) {
                        if (assetResult.success && assetResult.data) {
                            await assetsService.moveAssetToGroup(assetResult.data, groupId);
                        }
                    }
                }
            }

            if (hasErrors) {
                const successCount = result.data ? result.data.length - failedImports.length : 0;
                const uiService = context.services.get<UIService>(Services.UI);
                await uiService.showAlert(
                    "Partial import failure",
                    `${successCount} asset(s) imported successfully, ${failedImports.length} failed:\n\n${failedImports.join("\n")}`
                );
            }

            await loadAssets();
        } catch (err) {
            console.error("Failed to import assets:", err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(errorMessage);
            
            if (context) {
                const uiService = context.services.get<UIService>(Services.UI);
                await uiService.showAlert("Failed to import assets", errorMessage);
            }
        } finally {
            setLoading(false);
        }
    }, [context, loadAssets]);

    const handleCopy = useCallback(() => {
        if (contextMenuTarget && contextMenuTarget.item && !contextMenuTarget.isGroup) {
            setClipboard({
                type: "copy",
                asset: contextMenuTarget.item as Asset,
            });
        }
    }, [contextMenuTarget]);

    const handleCut = useCallback(() => {
        if (contextMenuTarget && contextMenuTarget.item && !contextMenuTarget.isGroup) {
            setClipboard({
                type: "cut",
                asset: contextMenuTarget.item as Asset,
            });
        }
    }, [contextMenuTarget]);

    const handlePaste = useCallback(async () => {
        if (!context || !clipboard || !contextMenuTarget) {
            return;
        }

        const target = contextMenuTarget;

        await withAssetsService(async (assetsService) => {
            const targetGroupId = target.isGroup && target.item
                ? (target.item as AssetGroup).id
                : undefined;

            if (clipboard.type === "cut" && clipboard.asset) {
                await assetsService.moveAssetToGroup(clipboard.asset, targetGroupId);
                setClipboard(null);
            } else if (clipboard.type === "copy" && clipboard.asset) {
                const dupResult = await assetsService.duplicateAsset(clipboard.asset);
                if (!dupResult.success || !dupResult.data) {
                    setError(dupResult.error || "Failed to copy asset");
                    return;
                }
                if (targetGroupId) {
                    await assetsService.moveAssetToGroup(dupResult.data, targetGroupId);
                }
            }
        });

        await loadAssets();
    }, [clipboard, context, contextMenuTarget, loadAssets, withAssetsService]);

    const handleRename = useCallback(async () => {
        if (!context || !contextMenuTarget || !contextMenuTarget.item) {
            return;
        }

        const target = contextMenuTarget;
        const targetLabel = target.isGroup ? "group" : "asset";
        const initialName = target.isGroup
            ? (target.item as AssetGroup).name
            : (target.item as Asset).name;

        const newName = inputDialog
            ? await inputDialog.showRenameDialog(initialName, targetLabel)
            : null;

        if (!newName) {
            return;
        }

        await withAssetsService(async (assetsService) => {
            if (target.isGroup) {
                await assetsService.renameGroup(
                    target.type,
                    (target.item as AssetGroup).id,
                    newName,
                );
            } else {
                await assetsService.renameAsset(target.item as Asset, newName);
            }
        });

        await loadAssets();
    }, [context, contextMenuTarget, inputDialog, loadAssets, withAssetsService]);

    const handleDelete = useCallback(async () => {
        if (!context || !contextMenuTarget || !contextMenuTarget.item) {
            return;
        }

        const target = contextMenuTarget;
        const uiService = context.services.get<UIService>(Services.UI);
        const confirmed = await uiService.showConfirm(
            target.isGroup ? "Delete group?" : "Delete asset?",
            target.isGroup ? "Assets will be moved to root." : "This cannot be undone.",
        );
        if (!confirmed) return;

        await withAssetsService(async (assetsService) => {
            if (target.isGroup) {
                await assetsService.deleteGroup(
                    target.type,
                    (target.item as AssetGroup).id,
                    false,
                );
            } else {
                await assetsService.deleteAsset(target.item as Asset);
            }
        });

        await loadAssets();
    }, [context, contextMenuTarget, loadAssets, withAssetsService]);

    const handleDragStart = useCallback((event: DragEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => {
        event.stopPropagation();
        setDraggedItem({ type, item, isGroup });
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", "");
    }, []);

    const handleDragEnd = useCallback(() => {
        setDraggedItem(null);
        setDropTargetId(null);
    }, []);

    const handleDragOverItem = useCallback((event: DragEvent, targetId: string) => {
        event.preventDefault();
        event.stopPropagation();
        if (draggedItem) {
            setDropTargetId(targetId);
            event.dataTransfer.dropEffect = "move";
        }
    }, [draggedItem]);

    const isDescendantGroup = useCallback((ancestorId: string, descendantId: string, groupsList: AssetGroup[]): boolean => {
        const descendant = groupsList.find((groupItem) => groupItem.id === descendantId);
        if (!descendant) {
            return false;
        }
        if (!descendant.parentGroupId) {
            return false;
        }
        if (descendant.parentGroupId === ancestorId) {
            return true;
        }
        return isDescendantGroup(ancestorId, descendant.parentGroupId, groupsList);
    }, []);

    const handleDropOnItem = useCallback(async (event: DragEvent, targetType: AssetType, targetGroup: AssetGroup | null) => {
        event.preventDefault();
        event.stopPropagation();

        if (!context || !draggedItem) {
            return;
        }

        await withAssetsService(async (assetsService) => {
            if (!draggedItem.isGroup && draggedItem.type === targetType) {
                const asset = draggedItem.item as Asset;
                const targetGroupId = targetGroup?.id;
                await assetsService.moveAssetToGroup(asset, targetGroupId);
            } else if (draggedItem.isGroup && draggedItem.type === targetType) {
                const group = draggedItem.item as AssetGroup;
                const targetGroupId = targetGroup?.id;
                if (targetGroupId && (group.id === targetGroupId || isDescendantGroup(group.id, targetGroupId, groups[targetType]))) {
                    setError("Cannot move a group into itself or its descendants");
                    return;
                }
                const result = await assetsService.moveGroupToParent(targetType, group.id, targetGroupId ?? undefined);
                if (!result.success) {
                    setError(result.error || "Failed to move group");
                    return;
                }
            }
        });

        setDraggedItem(null);
        setDropTargetId(null);
        await loadAssets();
    }, [context, draggedItem, groups, isDescendantGroup, loadAssets, withAssetsService]);

    return {
        assets,
        groups,
        loading,
        error,
        dragOver,
        clipboard,
        draggedItem,
        dropTargetId,
        focusedItemId,
        contextMenuTarget,
        setContextMenuTarget,
        setClipboard,
        setDraggedItem,
        setDropTargetId,
        setDragOver,
        setFocusedItemId,
        setError,
        loadAssets,
        handleDrop,
        handleAssetClick,
        handleGroupFocus,
        handleCreateGroup,
        handleImport,
        handleImportToGroup,
        handleCopy,
        handleCut,
        handlePaste,
        handleRename,
        handleDelete,
        handleDragStart,
        handleDragEnd,
        handleDragOverItem,
        handleDropOnItem,
        isDescendantGroup,
    };
}

