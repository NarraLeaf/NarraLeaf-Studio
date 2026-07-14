import { useCallback, useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
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
    handleCreateMagicTags?: () => Promise<void>;
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
    handleCreateMagicTags,
}: UseAssetsContextMenuParams) {
    const { t, tn } = useTranslation();
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
            // Check selected items: assets and groups
            const selectedAssetItems = Array.from(selectedItems).filter(id => id.startsWith('asset:'));
            const selectedGroupItems = Array.from(selectedItems).filter(id => id.startsWith('group:'));
            const hasAssets = selectedAssetItems.length > 0;
            const hasGroups = selectedGroupItems.length > 0;
            const totalItems = selectedAssetItems.length + selectedGroupItems.length;

            if (hasAssets || hasGroups) {
                items.push(
                    {
                        id: "copy-selected",
                        label: tn("assets.menu.copyCount", totalItems),
                        onClick: () => {
                            handleCopy();
                            closeContextMenu();
                        },
                    },
                    {
                        id: "cut-selected",
                        label: tn("assets.menu.cutCount", totalItems),
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
                    label: tn("assets.menu.deleteCount", selectedItems.size),
                    onClick: async () => {
                        await handleDelete();
                        closeContextMenu();
                    },
                },
            );

            // Magic Tags section
            if (hasAssets && selectedAssetItems.length >= 2 && handleCreateMagicTags) {
                items.push({ separator: true as const, id: "sep-magic-tags" });
                items.push({
                    id: "magic-tags",
                    label: t("assets.magicTag.title"),
                    onClick: async () => {
                        await handleCreateMagicTags();
                        closeContextMenu();
                    },
                });
            }
        } else if (contextMenuTarget.item) {
            // Single asset or group selected
            items.push(
                {
                    id: "copy",
                    label: t("common.copy"),
                    onClick: () => {
                        handleCopy();
                        closeContextMenu();
                    },
                },
                {
                    id: "cut",
                    label: t("common.cut"),
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
                label: t("common.paste"),
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
                    label: t("common.rename"),
                    onClick: async () => {
                        await handleRename();
                        closeContextMenu();
                    },
                },
                {
                    id: "delete",
                    label: t("common.delete"),
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
            label: contextMenuTarget.isGroup ? t("assets.menu.newSubGroup") : t("assets.menu.newGroup"),
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
            label: t("assets.menu.importAssets"),
            onClick: async () => {
                const groupId = contextMenuTarget.item
                    ? (contextMenuTarget.item as AssetGroup).id
                    : undefined;
                await handleImportToGroup(contextMenuTarget.type, groupId);
                closeContextMenu();
            },
        });

        return items;
    }, [clipboard, closeContextMenu, contextMenuTarget, handleCopy, handleCut, handleDelete, handleImportToGroup, handlePaste, handleRename, handleCreateGroup, isMultiSelectMode, selectedItems, t, tn]);

    return {
        menuState,
        contextMenu,
        showContextMenu,
        closeContextMenu,
    } as const;
}
