import { useCallback, useMemo } from "react";
import { useTranslation } from "@/lib/i18n";
import { freezeContextMenuRows, useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { appendDeveloperIdSection, DEVELOPER_MENU_ROW_IDS } from "@/lib/developer";

/**
 * The asset-menu rows a frozen library keeps: the ones that only read.
 *
 * Copy and Cut record what is marked; the move happens on Paste, which is off. Export copies bytes
 * out of the project and writes nothing back into it. Everything else creates, imports, renames,
 * retags, replaces bytes or deletes.
 */
const FREEZE_READ_ONLY_ASSET_MENU_IDS: ReadonlySet<string> = new Set([
    "copy",
    "cut",
    "copy-selected",
    "cut-selected",
    "export",
    "export-selected",
    // Developer options' identifier rows: they read an id off the row that was clicked.
    ...DEVELOPER_MENU_ROW_IDS,
]);
import { useContextMenu } from "@/lib/components/elements/ContextMenu";
import { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { contextMenuActsOnSelection, type ContextMenuTargetState } from "../state/assetActionTargets";
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
    handleReplaceContent: () => Promise<void>;
    /** Opens the conversion for the right-clicked asset. */
    handleConvertMedia: () => Promise<void>;
    /**
     * Whether the right-clicked asset has a conversion waiting for it.
     *
     * Passed in rather than looked up here so the row and the mark on the row can never disagree:
     * they read the same scan. `false` for an asset that plays, for one there is no conversion for,
     * and for a remote asset, whose bytes are a snapshot of what a server served and must not be
     * swapped underneath their provenance.
     */
    canConvertMedia: boolean;
    handleDelete: () => Promise<void>;
    /** Copies the targeted rows out to a folder the author picks. */
    handleExport: () => Promise<void>;
    handleCreateGroup: (category: AssetCategory, parentGroupId?: string) => Promise<void>;
    /** Other only. `groupId` is the group the menu was opened on, absent from the category header. */
    handleCreateTextFile: (groupId?: string) => Promise<void>;
    handleImportToGroup: (category: AssetCategory, groupId?: string) => Promise<void>;
    handleCreateMagicTags?: () => Promise<void>;
    /** How the developer section reports a copied identifier. `UIService.showNotification`. */
    notify?: (message: string, type: "success" | "error") => void;
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
    handleReplaceContent,
    handleConvertMedia,
    canConvertMedia,
    handleDelete,
    handleExport,
    handleCreateGroup,
    handleCreateTextFile,
    handleImportToGroup,
    handleCreateMagicTags,
    notify,
}: UseAssetsContextMenuParams) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard();
    const { menuState, showMenu, hideMenu } = useContextMenu();

    const showContextMenu = useCallback((event: React.MouseEvent, category: AssetCategory, item: Asset | AssetGroup | null, isGroup: boolean) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenuTarget({ category, item, isGroup });
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

        // The actions resolve their targets the same way (see `resolveAssetActionTargets`): a
        // right-click on a row outside the selection acts on that row alone, so the menu has to
        // offer the single-item commands rather than counts the action will not honour.
        const actsOnSelection = isMultiSelectMode && contextMenuActsOnSelection(contextMenuTarget, selectedItems);

        // Always add copy/cut operations first if applicable
        if (actsOnSelection) {
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
                    {
                        id: "export-selected",
                        label: tn("assets.menu.exportCount", totalItems),
                        onClick: async () => {
                            // Run first, close after, like every other async row here: closing clears
                            // `contextMenuTarget`, which is half of what decides the rows to act on.
                            await handleExport();
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
                {
                    id: "export",
                    label: t("assets.menu.export"),
                    onClick: async () => {
                        await handleExport();
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
        if (!actsOnSelection && contextMenuTarget.item) {
            if (items.length > 0) {
                items.push({ separator: true as const, id: "sep1" });
            }
            items.push({
                id: "rename",
                label: t("common.rename"),
                onClick: async () => {
                    await handleRename();
                    closeContextMenu();
                },
            });
            // Files only: a group has no bytes to swap.
            if (!contextMenuTarget.isGroup) {
                items.push({
                    id: "replace-content",
                    label: t("assets.menu.replaceContent"),
                    onClick: async () => {
                        await handleReplaceContent();
                        closeContextMenu();
                    },
                });
                // Only where there is a conversion to run. Offered here as well as on the mark in
                // the row because the mark is a mouse target and this is the one a keyboard and a
                // right-click reach.
                if (canConvertMedia) {
                    items.push({
                        id: "convert-media",
                        label: t("assets.support.menuConvert"),
                        onClick: async () => {
                            await handleConvertMedia();
                            closeContextMenu();
                        },
                    });
                }
            }
            items.push({
                id: "delete",
                label: t("common.delete"),
                onClick: async () => {
                    await handleDelete();
                    closeContextMenu();
                },
            });
        }

        // Always show create group and import options at the end
        if (items.length > 0) {
            items.push({ separator: true as const, id: "sep-actions" });
        }

        // The one asset Studio can make rather than import, so it is offered only where it means
        // something: the Other section itself, or a folder inside it. An asset row is not an
        // enclosure, and "new file here" on top of a file would have to guess what "here" meant.
        //
        // Deliberately absent from FREEZE_READ_ONLY_ASSET_MENU_IDS: this creates, so a frozen
        // library greys it out like every other write.
        if (contextMenuTarget.category === AssetCategory.Other && (!contextMenuTarget.item || contextMenuTarget.isGroup)) {
            items.push({
                id: "new-text-file",
                label: t("assets.menu.newTextFile"),
                onClick: async () => {
                    const groupId = contextMenuTarget.isGroup
                        ? (contextMenuTarget.item as AssetGroup).id
                        : undefined;
                    await handleCreateTextFile(groupId);
                    closeContextMenu();
                },
            });
        }

        items.push({
            id: "new-group",
            label: contextMenuTarget.isGroup ? t("assets.menu.newSubGroup") : t("assets.menu.newGroup"),
            onClick: async () => {
                const parentGroupId = contextMenuTarget.item
                    ? (contextMenuTarget.item as AssetGroup).id
                    : undefined;
                await handleCreateGroup(contextMenuTarget.category, parentGroupId);
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
                await handleImportToGroup(contextMenuTarget.category, groupId);
                closeContextMenu();
            },
        });

        // The identifier of the row the menu was opened on. A category header has no item, so the
        // section drops out entirely there rather than naming the category.
        const withDeveloperRows = appendDeveloperIdSection(
            items,
            [{
                kind: contextMenuTarget.isGroup ? "assetGroup" : "asset",
                value: contextMenuTarget.item?.id,
            }],
            { hideMenu: closeContextMenu, notify },
        );

        return freezeContextMenuRows(withDeveloperRows, freeze.frozen, FREEZE_READ_ONLY_ASSET_MENU_IDS, freeze.reason);
    }, [canConvertMedia, clipboard, closeContextMenu, contextMenuTarget, freeze, handleCopy, handleConvertMedia, handleCut, handleDelete, handleExport, handleImportToGroup, handlePaste, handleRename, handleReplaceContent, handleCreateGroup, handleCreateTextFile, isMultiSelectMode, notify, selectedItems, t, tn]);

    return {
        menuState,
        contextMenu,
        showContextMenu,
        closeContextMenu,
    } as const;
}
