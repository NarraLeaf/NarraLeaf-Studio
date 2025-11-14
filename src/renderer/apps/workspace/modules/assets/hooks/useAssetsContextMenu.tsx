import { useCallback, useMemo } from "react";
import { useContextMenu } from "@/lib/components/elements/ContextMenu";
import { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { ContextMenuTargetState } from "../state/useAssetActions";
import { ClipboardState } from "../state/useClipboard";

export interface UseAssetsContextMenuParams {
    clipboard: ClipboardState | null;
    contextMenuTarget: ContextMenuTargetState | null;
    setContextMenuTarget: (target: ContextMenuTargetState | null) => void;
    // Multi-selection related
    selectedItems: Set<string>;
    isMultiSelectMode: boolean;
    handleClearSelection: () => void;
    // handlers passed from state hook
    handleCopy: () => void;
    handleCut: () => void;
    handlePaste: () => Promise<void>;
    handleRename: () => Promise<void>;
    handleDelete: () => Promise<void>;
    handleCreateGroup: (type: AssetType, parentGroupId?: string) => Promise<void>;
    handleImportToGroup: (type: AssetType, groupId?: string) => Promise<void>;
}

export function useAssetsContextMenu({
    clipboard,
    contextMenuTarget,
    setContextMenuTarget,
    // Multi-selection related
    selectedItems,
    isMultiSelectMode,
    handleClearSelection,
    handleCopy,
    handleCut,
    handlePaste,
    handleRename,
    handleDelete,
    handleCreateGroup,
    handleImportToGroup,
}: UseAssetsContextMenuParams) {
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const showContextMenu = useCallback((event: React.MouseEvent, type: AssetType, item: Asset | AssetGroup | null, isGroup: boolean) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenuTarget({ type, item, isGroup });
        showMenu(event);
    }, [setContextMenuTarget, showMenu]);

    const closeContextMenu = useCallback(() => {
        setContextMenuTarget(null);
        hideMenu();
    }, [hideMenu, setContextMenuTarget]);

    const contextMenu: ContextMenuDef = useMemo(() => {
        if (!contextMenuTarget) {
            return [];
        }

        const items: ContextMenuDef = [];

        // Always add copy/cut operations first if applicable
        if (isMultiSelectMode) {
            // Check if all selected items are assets (not groups)
            const selectedAssetItems = Array.from(selectedItems).filter(id => id.startsWith('asset:'));
            const hasAssets = selectedAssetItems.length > 0;

            if (hasAssets) {
                items.push(
                    {
                        id: "copy-selected",
                        label: `Copy ${selectedAssetItems.length} item(s)`,
                        onClick: () => {
                            handleCopy();
                            closeContextMenu();
                        },
                    },
                    {
                        id: "cut-selected",
                        label: `Cut ${selectedAssetItems.length} item(s)`,
                        onClick: () => {
                            handleCut();
                            closeContextMenu();
                        },
                    },
                );
            }

            // Delete selected items
            items.push(
                {
                    id: "delete-selected",
                    label: `Delete ${selectedItems.size} item(s)`,
                    onClick: async () => {
                        await handleDelete();
                        closeContextMenu();
                    },
                },
            );
        } else if (contextMenuTarget.item && !contextMenuTarget.isGroup) {
            // Single asset selected
            items.push(
                {
                    id: "copy",
                    label: "Copy",
                    onClick: () => {
                        handleCopy();
                        closeContextMenu();
                    },
                },
                {
                    id: "cut",
                    label: "Cut",
                    onClick: () => {
                        handleCut();
                        closeContextMenu();
                    },
                },
            );
        }

        // Add paste option in consistent position (after copy/cut/delete operations)
        if (clipboard) {
            if (items.length > 0) {
                items.push({ separator: true as const, id: 'sep-paste' });
            }
            items.push({
                id: 'paste',
                label: 'Paste',
                onClick: async () => {
                    await handlePaste();
                    closeContextMenu();
                }
            });
        }

        // Add rename/delete for single items
        if (!isMultiSelectMode && contextMenuTarget.item) {
            if (items.length > 0) {
                items.push({ separator: true as const, id: "sep1" });
            }
            items.push(
                {
                    id: "rename",
                    label: "Rename",
                    onClick: async () => {
                        await handleRename();
                        closeContextMenu();
                    },
                },
                {
                    id: "delete",
                    label: "Delete",
                    onClick: async () => {
                        await handleDelete();
                        closeContextMenu();
                    },
                },
            );
        }

        // Always show create group and import options at the end
        if (items.length > 0) {
            items.push({ separator: true as const, id: "sep-actions" });
        }

        items.push({
            id: "new-group",
            label: contextMenuTarget.isGroup ? "New Sub-Group" : "New Group",
            onClick: async () => {
                const parentGroupId = contextMenuTarget.item
                    ? (contextMenuTarget.item as AssetGroup).id
                    : undefined;
                await handleCreateGroup(contextMenuTarget.type, parentGroupId);
                closeContextMenu();
            },
        });

        items.push({
            id: "import-assets",
            label: "Import Assets...",
            onClick: async () => {
                const groupId = contextMenuTarget.item
                    ? (contextMenuTarget.item as AssetGroup).id
                    : undefined;
                await handleImportToGroup(contextMenuTarget.type, groupId);
                closeContextMenu();
            },
        });

        return items;
    }, [clipboard, closeContextMenu, contextMenuTarget, handleCopy, handleCut, handleDelete, handleImportToGroup, handlePaste, handleRename, handleCreateGroup, isMultiSelectMode, selectedItems]);

    return {
        menuState,
        contextMenu,
        showContextMenu,
        closeContextMenu,
    } as const;
}
