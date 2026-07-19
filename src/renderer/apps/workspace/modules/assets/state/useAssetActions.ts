import { useCallback, useRef } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetType } from '@/lib/workspace/services/assets/assetTypes';
import { WorkspaceContext } from '@/lib/workspace/services/services';
import { AssetsService } from '@/lib/workspace/services/core/AssetsService';
import { UIService } from '@/lib/workspace/services/core/UIService';
import { ReferenceService } from '@/lib/workspace/services/references/ReferenceService';
import { Services } from '@/lib/workspace/services/services';
import { InputDialog } from '@/lib/components/dialogs/InputDialog';
import { ClipboardState } from './useClipboard';
import { getInterface } from '@/lib/app/bridge';
import { useTranslation } from '@/lib/i18n';
import type { Translator } from '@shared/i18n';

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
    /** Function to expand a group by its ID */
    expandGroup?: (groupId: string) => void;
}

/** How many reference lines to spell out per asset in the delete warning before collapsing. */
const REFERENCE_PREVIEW_LIMIT = 5;

type DeleteTarget = { isGroup: boolean; type: AssetType; item: Asset | AssetGroup };

/**
 * Expand delete targets into the assets that would actually be removed.
 *
 * Group deletion cascades (`deleteGroup(type, id, true)`), and nested groups cascade with it, so a
 * reference check that looked only at the selected rows would clear a folder containing referenced
 * assets without a word.
 */
function collectAffectedAssets(
    targets: readonly DeleteTarget[],
    assets: Record<AssetType, Asset[]>,
    groups: Record<AssetType, AssetGroup[]>,
): Asset[] {
    const collected = new Map<string, Asset>();

    for (const target of targets) {
        if (!target.isGroup) {
            const asset = target.item as Asset;
            collected.set(asset.id, asset);
            continue;
        }

        const groupIds = new Set<string>([target.item.id]);
        const candidates = groups[target.type] ?? [];
        // Descend until no new child group appears; group nesting has no depth bound.
        let grew = true;
        while (grew) {
            grew = false;
            for (const group of candidates) {
                if (group.parentGroupId && groupIds.has(group.parentGroupId) && !groupIds.has(group.id)) {
                    groupIds.add(group.id);
                    grew = true;
                }
            }
        }
        for (const asset of assets[target.type] ?? []) {
            if (asset.groupId && groupIds.has(asset.groupId)) {
                collected.set(asset.id, asset);
            }
        }
    }

    return [...collected.values()];
}

function parseFileUriList(dataTransfer?: DataTransfer): string[] {
    if (!dataTransfer) {
        return [];
    }

    return dataTransfer.getData("text/uri-list")
        .split(/\r?\n/)
        .map(line => line.trim())
        .filter(line => line.length > 0 && !line.startsWith("#"))
        .flatMap(line => {
            try {
                const url = new URL(line);
                if (url.protocol !== "file:") {
                    return [];
                }

                const pathname = decodeURIComponent(url.pathname);
                return [/^\/[A-Za-z]:\//.test(pathname) ? pathname.slice(1) : pathname];
            } catch {
                return [];
            }
        });
}

function summarizeImportFailures(errors: Array<string | undefined>, t: Translator["t"]): string {
    const messages = errors.filter((message): message is string => typeof message === "string" && message.length > 0);
    if (messages.length === 0) {
        return t("assets.unknownError");
    }

    const visibleMessages = messages.slice(0, 3);
    const remaining = messages.length - visibleMessages.length;
    return remaining > 0
        ? `${visibleMessages.join("\n")}\n${t("assets.import.moreFailures", { count: remaining })}`
        : visibleMessages.join("\n");
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
    setActionLoading,
    expandGroup
}: UseAssetActionsParams) {
    const { t, tn } = useTranslation();

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

    const getSelectedGroups = useCallback((): AssetGroup[] => {
        const ids = Array.from(selectedItems).filter(id => id.startsWith('group:')).map(id => id.replace('group:', ''));
        return Object.values(groups).flat().filter(g => ids.includes(g.id));
    }, [selectedItems, groups]);

    /**
     * Check if an asset belongs to any of the selected groups (including nested groups).
     * This is used to avoid duplicating assets that are already inside a selected group.
     */
    const isAssetInSelectedGroups = useCallback((asset: Asset, selectedGroupIds: Set<string>): boolean => {
        if (!asset.groupId) return false;
        
        const allGroups = Object.values(groups).flat();
        let currentGroupId: string | undefined = asset.groupId;
        
        // Walk up the group hierarchy and check if any ancestor is in the selected groups
        while (currentGroupId) {
            if (selectedGroupIds.has(currentGroupId)) {
                return true;
            }
            
            const currentGroup = allGroups.find(g => g.id === currentGroupId);
            if (!currentGroup) break;
            
            currentGroupId = currentGroup.parentGroupId;
        }
        
        return false;
    }, [groups]);

    /**
     * Check if a group is a child of any selected group (to avoid duplicating nested groups).
     */
    const isGroupChildOfSelectedGroups = useCallback((group: AssetGroup, selectedGroupIds: Set<string>): boolean => {
        if (!group.parentGroupId) return false;
        
        const allGroups = Object.values(groups).flat();
        let currentGroupId: string | undefined = group.parentGroupId;
        
        // Walk up the parent hierarchy and check if any ancestor is in the selected groups
        while (currentGroupId) {
            if (selectedGroupIds.has(currentGroupId)) {
                return true;
            }
            
            const currentGroup = allGroups.find(g => g.id === currentGroupId);
            if (!currentGroup) break;
            
            currentGroupId = currentGroup.parentGroupId;
        }
        
        return false;
    }, [groups]);

    const handleImport = useCallback(async (type: AssetType, groupId?: string, files?: FileList, dataTransfer?: DataTransfer) => {
        if (!context) return;
        notifyLoading(true);
        
        await withAssetsService(async (assetsService) => {
            await assetsService.transaction(async (svc) => {
                const uiService = context.services.get<UIService>(Services.UI);
                let result;
                if (files && files.length > 0) {
                    const fileArray = Array.from(files);
                    const grantResult = await getInterface().fs.grantFileAccessForFiles(fileArray);
                    if (!grantResult.success) {
                        uiService.showAlert(t("assets.import.unableTitle"), grantResult.error || t("assets.import.fileAccessFailed"));
                        return;
                    }
                    if (!grantResult.data.ok) {
                        uiService.showAlert(t("assets.import.unableTitle"), grantResult.data.error.message);
                        return;
                    }

                    const paths = grantResult.data.data.length > 0
                        ? grantResult.data.data
                        : fileArray
                        .map(f => {
                            const pathFromProp = (f as any).path;
                            if (pathFromProp && pathFromProp.length > 0) return pathFromProp;

                            return getInterface().fs.getPathForFile(f);
                        })
                        .filter((p): p is string => typeof p === 'string' && p.length > 0);

                    if (paths.length === 0) {
                        const uriPaths = parseFileUriList(dataTransfer);
                        if (uriPaths.length > 0) {
                            paths.push(...uriPaths);
                        }

                        if (paths.length === 0) {
                            uiService.showAlert(
                                t("assets.import.unableTitle"),
                                t("assets.import.filePathParsingFailed")
                            );
                            return;
                        }
                    }
                    result = await svc.importFromPaths(type, paths);
                } else {
                    result = await svc.importLocalAssets(type);
                }

                if (!result.success) {
                    uiService.showAlert(t("assets.import.failedTitle"), result.error || t("assets.unknownError"));
                    return;
                }

                const importFailures = result.data?.filter(assetResult => !assetResult.success) ?? [];
                const importedAssets = result.data?.flatMap(assetResult =>
                    assetResult.success && assetResult.data ? [assetResult.data] : []
                ) ?? [];

                if (groupId) {
                    for (const asset of importedAssets) {
                        const moveResult = await svc.moveAssetToGroup(asset, groupId);
                        if (!moveResult.success) {
                            uiService.showAlert(t("assets.import.moveFailedTitle"), moveResult.error || t("assets.unknownError"));
                            return;
                        }
                    }
                }

                if (importFailures.length > 0) {
                    uiService.showAlert(
                        importedAssets.length > 0 ? t("assets.import.someFailedTitle") : t("assets.import.failedTitle"),
                        summarizeImportFailures(importFailures.map(assetResult => assetResult.error), t)
                    );
                }
            });
        });

        onActionComplete();
        notifyLoading(false);
    }, [context, withAssetsService, onActionComplete, notifyLoading]);

    const handleImportRemote = useCallback(async (type: AssetType) => {
        if (!context || !inputDialog) return;
        notifyLoading(true);

        const url = await inputDialog.show({
            title: t("assets.import.remoteTitle"),
            placeholder: "https://example.com/asset.png",
            description: t("assets.import.remoteDescription"),
            required: true,
            validation: (value) => {
                try {
                    new URL(value.trim());
                    return null;
                } catch {
                    return t("assets.import.remoteInvalidUrl");
                }
            },
            assetType: type,
        });

        if (!url) {
            notifyLoading(false);
            return;
        }

        await withAssetsService(async (assetsService) => {
            const result = await assetsService.importRemoteAsset(type, url.trim());
            if (!result.success) {
                context.services.get<UIService>(Services.UI).showAlert(
                    t("assets.import.remoteFailedTitle"),
                    result.error || t("assets.unknownError")
                );
            }
        });

        onActionComplete();
        notifyLoading(false);
    }, [context, inputDialog, withAssetsService, onActionComplete, notifyLoading]);
    
    // Support drag-in files directly to a group
    const handleImportToGroup = useCallback(async (type: AssetType, groupId?: string, files?: FileList, dataTransfer?: DataTransfer) => {
        notifyLoading(true);
        await handleImport(type, groupId, files, dataTransfer);
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
        let groupsToCopy: AssetGroup[] = [];

        if (selectedItems.size > 0) {
            const allSelectedGroups = getSelectedGroups();
            const selectedGroupIds = new Set(allSelectedGroups.map(g => g.id));
            
            // Filter out groups that are children of other selected groups
            groupsToCopy = allSelectedGroups.filter(
                group => !isGroupChildOfSelectedGroups(group, selectedGroupIds)
            );
            
            // Filter out assets that are inside selected groups to avoid duplication
            assetsToCopy = getSelectedAssets().filter(
                asset => !isAssetInSelectedGroups(asset, selectedGroupIds)
            );
        } else if (contextMenuTarget?.item) {
            if (contextMenuTarget.isGroup) {
                groupsToCopy = [contextMenuTarget.item as AssetGroup];
            } else {
                assetsToCopy = [contextMenuTarget.item as Asset];
            }
        } else if (focusedItemId) {
            if (focusedItemId.startsWith('asset:')) {
                const assetId = focusedItemId.replace('asset:', '');
                const asset = Object.values(assets).flat().find(a => a.id === assetId);
                if (asset) assetsToCopy = [asset];
            } else if (focusedItemId.startsWith('group:')) {
                const groupId = focusedItemId.replace('group:', '');
                const group = Object.values(groups).flat().find(g => g.id === groupId);
                if (group) groupsToCopy = [group];
            }
        }

        if (assetsToCopy.length > 0 || groupsToCopy.length > 0) {
            setClipboard({ type: 'copy', assets: assetsToCopy, groups: groupsToCopy });
        }
    }, [contextMenuTarget, selectedItems, assets, groups, focusedItemId, getSelectedAssets, getSelectedGroups, isAssetInSelectedGroups, isGroupChildOfSelectedGroups, setClipboard]);

    const handleCut = useCallback(() => {
        let assetsToCut: Asset[] = [];
        let groupsToCut: AssetGroup[] = [];

        if (selectedItems.size > 0) {
            const allSelectedGroups = getSelectedGroups();
            const selectedGroupIds = new Set(allSelectedGroups.map(g => g.id));
            
            // Filter out groups that are children of other selected groups
            groupsToCut = allSelectedGroups.filter(
                group => !isGroupChildOfSelectedGroups(group, selectedGroupIds)
            );
            
            // Filter out assets that are inside selected groups to avoid duplication
            assetsToCut = getSelectedAssets().filter(
                asset => !isAssetInSelectedGroups(asset, selectedGroupIds)
            );
        } else if (contextMenuTarget?.item) {
            if (contextMenuTarget.isGroup) {
                groupsToCut = [contextMenuTarget.item as AssetGroup];
            } else {
                assetsToCut = [contextMenuTarget.item as Asset];
            }
        } else if (focusedItemId) {
            if (focusedItemId.startsWith('asset:')) {
                const assetId = focusedItemId.replace('asset:', '');
                const asset = Object.values(assets).flat().find(a => a.id === assetId);
                if (asset) assetsToCut = [asset];
            } else if (focusedItemId.startsWith('group:')) {
                const groupId = focusedItemId.replace('group:', '');
                const group = Object.values(groups).flat().find(g => g.id === groupId);
                if (group) groupsToCut = [group];
            }
        }

        if (assetsToCut.length > 0 || groupsToCut.length > 0) {
            setClipboard({ type: 'cut', assets: assetsToCut, groups: groupsToCut });
        }
    }, [contextMenuTarget, selectedItems, assets, groups, focusedItemId, getSelectedAssets, getSelectedGroups, isAssetInSelectedGroups, isGroupChildOfSelectedGroups, setClipboard]);

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
                    // Move assets
                    for (const a of clipboard.assets) {
                        await svc.moveAssetToGroup(a, targetGroupId);
                    }
                    // Move groups
                    for (const g of clipboard.groups) {
                        await svc.moveGroupToParent(g.type, g.id, targetGroupId);
                    }
                    setClipboard(null);
                } else if (clipboard.type === 'copy') {
                    // Duplicate assets
                    for (const a of clipboard.assets) {
                        const dupResult = await svc.duplicateAsset(a);
                        if (dupResult.success && dupResult.data) {
                            await svc.moveAssetToGroup(dupResult.data, targetGroupId);
                        }
                    }
                    // Duplicate groups (recursively copies all assets and child groups)
                    for (const g of clipboard.groups) {
                        await svc.duplicateGroup(g.type, g.id, targetGroupId);
                    }
                }
            });
        });

        // Expand the target group if pasting into a group
        if (targetGroupId && expandGroup) {
            expandGroup(targetGroupId);
        }

        onActionComplete();
        notifyLoading(false);
    }, [clipboard, context, contextMenuTarget, focusedItemId, assets, onActionComplete, withAssetsService, setClipboard, notifyLoading, expandGroup]);
    
    const handleRename = useCallback(async () => {
        if (!context || !inputDialog) return;

        // Determine target item in priority order: context menu / single selection / focused item
        let target: { item: Asset | AssetGroup; isGroup: boolean; type: AssetType } | null = null;

        if (contextMenuTarget?.item) {
            target = { item: contextMenuTarget.item, isGroup: contextMenuTarget.isGroup, type: contextMenuTarget.type };
        } else if (selectedItems.size === 1) {
            const id = Array.from(selectedItems)[0];
            if (id.startsWith('asset:')) {
                const assetId = id.replace('asset:', '');
                const asset = Object.values(assets).flat().find(a => a.id === assetId);
                if (asset) target = { item: asset, isGroup: false, type: asset.type };
            } else if (id.startsWith('group:')) {
                const groupId = id.replace('group:', '');
                for (const [t, groupList] of Object.entries(groups)) {
                    const g = groupList.find(gr => gr.id === groupId);
                    if (g) { target = { item: g, isGroup: true, type: t as AssetType }; break; }
                }
            }
        } else if (focusedItemId) {
            if (focusedItemId.startsWith('asset:')) {
                const assetId = focusedItemId.replace('asset:', '');
                const asset = Object.values(assets).flat().find(a => a.id === assetId);
                if (asset) target = { item: asset, isGroup: false, type: asset.type };
            } else if (focusedItemId.startsWith('group:')) {
                const groupId = focusedItemId.replace('group:', '');
                for (const [t, groupList] of Object.entries(groups)) {
                    const g = groupList.find(gr => gr.id === groupId);
                    if (g) { target = { item: g, isGroup: true, type: t as AssetType }; break; }
                }
            }
        }

        if (!target) return;

        const initialName = (target.item as Asset | AssetGroup).name;
        const newName = await inputDialog.showRenameDialog(initialName, target.isGroup ? 'group' : 'asset');
        if (!newName) return;

        await withAssetsService(async (assetsService) => {
            if (target.isGroup) {
                await assetsService.renameGroup(target.type, (target.item as AssetGroup).id, newName);
            } else {
                await assetsService.renameAsset(target.item as Asset, newName);
            }
        });

        onActionComplete();
    }, [context, contextMenuTarget, selectedItems, focusedItemId, assets, groups, inputDialog, onActionComplete, withAssetsService]);

    const handleDelete = useCallback(async () => {
        notifyLoading(true);
        try {
            const ctx = contextRef.current;
            if (!ctx) return;
            const uiService = ctx.services.get<UIService>(Services.UI);
            const assetsService = ctx.services.get<AssetsService>(Services.Assets);
            
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

            // Every asset the delete would actually remove — including the contents of any selected
            // group. Deleting a group cascades to its assets, so checking only the bare asset
            // targets let a whole folder of referenced material through without a warning.
            const affectedAssets = collectAffectedAssets(targets, assets, groups);

            const referenceService = context?.services.get<ReferenceService>(Services.Reference) ?? null;
            if (referenceService) {
                // The index is lazy; without this an unopened project reports everything as unused.
                await referenceService.ensureReady().catch(() => undefined);
                const referencesByAsset = referenceService.getReferencesForAll(affectedAssets.map(asset => asset.id));

                if (referencesByAsset.size > 0) {
                    const details = affectedAssets
                        .map(asset => ({ asset, references: referencesByAsset.get(asset.id) ?? [] }))
                        .filter(entry => entry.references.length > 0)
                        .map(({ asset, references }) => {
                            const shown = references.slice(0, REFERENCE_PREVIEW_LIMIT).map(reference => {
                                const where = reference.detail ? `${reference.label} — ${reference.detail}` : reference.label;
                                return `  ${where}${reference.dormant ? ` (${t("properties.references.dormant")})` : ""}`;
                            });
                            const remaining = references.length - shown.length;
                            if (remaining > 0) {
                                shown.push(`  ${t("assets.delete.moreReferences", { count: remaining })}`);
                            }
                            return `- ${asset.name}:\n${shown.join("\n")}`;
                        })
                        .join("\n");

                    const forceConfirmed = await uiService.showConfirm(
                        t("assets.delete.inUseTitle"),
                        `${t("assets.delete.inUseMessage")}\n\n${details}`,
                    );
                    if (!forceConfirmed) {
                        return;
                    }
                }
            }

            const confirmed = await uiService.showConfirm(
                tn("assets.delete.confirmTitle", targets.length),
                t("assets.delete.confirmMessage"),
            );
            if (!confirmed) {
                return;
            }

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
                });
            });
            onActionComplete();
        } catch (error) {
            console.error("Failed to delete asset", error);
        } finally {
            notifyLoading(false);
        }
    }, [selectedItems, assets, groups, contextMenuTarget, onActionComplete, withAssetsService, focusedItemId, notifyLoading, context, t, tn]);


    const handleCreateMagicTags = useCallback(async () => {
        const selectedAssets = getSelectedAssets();
        if (selectedAssets.length === 0) return null;

        const ctx = contextRef.current;
        if (!ctx) return null;

        const assetsService = ctx.services.get<AssetsService>(Services.Assets);
        
        // Extract filenames from selected assets
        const filenames = selectedAssets.map(asset => asset.name);
        
        try {
            // Analyze filenames and generate template
            const template = assetsService.analyzeMagicTags(filenames);
            return { template, assets: selectedAssets };
        } catch (error) {
            const uiService = ctx.services.get<UIService>(Services.UI);
            uiService.showAlert(
                t("assets.magicTag.parseFailedTitle"),
                error instanceof Error ? error.message : t("assets.unknownError")
            );
            return null;
        }
    }, [getSelectedAssets]);

    const handleApplyMagicTags = useCallback(async (
        selectedAssets: Asset[],
        template: any,
        categoryMapping: Record<number, string>
    ) => {
        const ctx = contextRef.current;
        if (!ctx) return;

        notifyLoading(true);
        
        try {
            const assetsService = ctx.services.get<AssetsService>(Services.Assets);
            
            // Generate preview to get the tags for each file
            const previews = assetsService.generateMagicTagPreview(template, categoryMapping);
            
            // Apply tags to each asset
            await assetsService.transaction(async (svc) => {
                for (let i = 0; i < selectedAssets.length; i++) {
                    const asset = selectedAssets[i];
                    const preview = previews[i];
                    
                    if (preview && preview.tags.length > 0) {
                        // Merge with existing tags
                        const existingTags = asset.tags || [];
                        const newTags = Array.from(new Set([...existingTags, ...preview.tags]));
                        await svc.updateAssetTags(asset, newTags);
                    }
                }
            });

            onActionComplete();
        } catch (error) {
            const uiService = ctx.services.get<UIService>(Services.UI);
            uiService.showAlert(
                t("assets.magicTag.applyFailedTitle"),
                error instanceof Error ? error.message : t("assets.unknownError")
            );
        } finally {
            notifyLoading(false);
        }
    }, [onActionComplete, notifyLoading]);

    return {
        handleCreateGroup,
        handleImport,
        handleImportToGroup,
        handleImportRemote,
        handleCopy,
        handleCut,
        handlePaste,
        handleRename,
        handleDelete,
        handleCreateMagicTags,
        handleApplyMagicTags,
    };
}
