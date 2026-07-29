import { useCallback, useRef } from 'react';
import { Asset, AssetGroup } from '@/lib/workspace/services/assets/types';
import { AssetExtensions, AssetType, isBundleAssetType } from '@/lib/workspace/services/assets/assetTypes';
import { runReplaceAssetContentFlow } from '@/lib/workspace/assets/replaceAssetContentFlow';
import type { ImportQueueController } from './useImportQueue';
import { WorkspaceContext } from '@/lib/workspace/services/services';
import { AssetsService } from '@/lib/workspace/services/core/AssetsService';
import { UIService } from '@/lib/workspace/services/core/UIService';
import type { AssetReference } from '@/lib/workspace/services/references/referenceModel';
import { Services } from '@/lib/workspace/services/services';
import { InputDialog } from '@/lib/components/dialogs/InputDialog';
import { ClipboardState } from './useClipboard';
import { getInterface } from '@/lib/app/bridge';
import { useTranslation } from '@/lib/i18n';
import { useFreezeGuard } from '@/apps/workspace/components/ui/freezeGuard';
import type { Translator } from '@shared/i18n';
import {
    assetSelectionKey,
    resolveAssetActionTargets,
    type AssetActionTarget,
    type ContextMenuTargetState,
} from './assetActionTargets';

export type { ContextMenuTargetState };

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
    /** Receives per-file import progress and the failures the panel offers a retry for. */
    importQueue?: ImportQueueController;
}

/** How many reference lines to spell out per asset in the delete warning before collapsing. */
const REFERENCE_PREVIEW_LIMIT = 5;

/**
 * Expand delete targets into the assets that would actually be removed.
 *
 * Group deletion cascades (`deleteGroup(type, id, true)`), and nested groups cascade with it, so a
 * reference check that looked only at the selected rows would clear a folder containing referenced
 * assets without a word.
 */
function collectAffectedAssets(
    targets: readonly AssetActionTarget[],
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
    expandGroup,
    importQueue,
}: UseAssetActionsParams) {
    const { t, tn } = useTranslation();
    // Import is the one asset write with no control to grey out: files arrive by being dropped on the
    // panel or on a folder tile. Every other action here hangs off a button or a menu row, and those
    // are disabled where they are rendered.
    const freeze = useFreezeGuard();

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

    /**
     * The rows the next action applies to. Every action shares this so the row the user pointed at
     * and the row that changes are the same one.
     */
    const resolveTargets = useCallback((): AssetActionTarget[] => resolveAssetActionTargets({
        selectedItems,
        contextMenuTarget,
        focusedItemId,
        assets,
        groups,
    }), [selectedItems, contextMenuTarget, focusedItemId, assets, groups]);

    const getSelectedAssets = useCallback((): Asset[] => {
        const ids = Array.from(selectedItems).filter(id => id.startsWith('asset:')).map(id => id.replace('asset:', ''));
        return Object.values(assets).flat().filter(a => ids.includes(a.id));
    }, [selectedItems, assets]);

    /**
     * Check if an asset belongs to any of the targeted groups (including nested groups).
     * This is used to avoid duplicating assets that are already inside a targeted group.
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
     * Check if a group is a child of any targeted group (to avoid duplicating nested groups).
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

    /**
     * Import a known list of files, reporting per-file progress and leaving the failures where the
     * panel can offer a retry.
     *
     * Every entry point resolves its paths first and comes through here, so a retry is just this
     * function again with the paths that did not make it — no second trip through the picker.
     */
    const runImport = useCallback(async (type: AssetType, paths: string[], groupId?: string) => {
        const ctx = contextRef.current;
        if (!ctx || paths.length === 0) return;
        const uiService = ctx.services.get<UIService>(Services.UI);

        notifyLoading(true);
        importQueue?.start({ type, groupId, total: paths.length });

        await withAssetsService(async (assetsService) => {
            await assetsService.transaction(async (svc) => {
                const result = await svc.importFromPaths(type, paths, {
                    onProgress: progress => importQueue?.progress(progress),
                });

                if (!result.success) {
                    // The whole run fell over, so every file is still outstanding and retryable.
                    importQueue?.finish(paths.map(path => ({ path, error: result.error })));
                    uiService.showAlert(t("assets.import.failedTitle"), result.error || t("assets.unknownError"));
                    return;
                }

                // `importFromPaths` answers 1:1 with the paths it was handed, which is what lets a
                // failure be named by file rather than by a bare error string.
                const perFile = result.data ?? [];
                const failures = perFile.flatMap((assetResult, index) =>
                    assetResult.success ? [] : [{ path: paths[index], error: assetResult.error }]
                );
                const importedAssets = perFile.flatMap(assetResult =>
                    assetResult.success && assetResult.data ? [assetResult.data] : []
                );

                importQueue?.finish(failures);

                if (groupId) {
                    // Collected rather than returned on: a failed move used to abandon the rest of
                    // the run *and* swallow the import-failure summary that had not been shown yet.
                    const moveErrors: string[] = [];
                    for (const asset of importedAssets) {
                        const moveResult = await svc.moveAssetToGroup(asset, groupId);
                        if (!moveResult.success) {
                            moveErrors.push(`${asset.name}: ${moveResult.error || t("assets.unknownError")}`);
                        }
                    }
                    if (moveErrors.length > 0) {
                        uiService.showAlert(t("assets.import.moveFailedTitle"), moveErrors.join("\n"));
                    }
                }

                // Failures are listed in the panel with a retry; the alert stays only for callers
                // that have no strip to read (there is none today, but the summary is cheap to keep).
                if (failures.length > 0 && !importQueue) {
                    uiService.showAlert(
                        importedAssets.length > 0 ? t("assets.import.someFailedTitle") : t("assets.import.failedTitle"),
                        summarizeImportFailures(failures.map(failure => failure.error), t)
                    );
                }
            });
        });

        onActionComplete();
        notifyLoading(false);
    }, [importQueue, notifyLoading, onActionComplete, t, withAssetsService]);

    const handleImport = useCallback(async (type: AssetType, groupId?: string, files?: FileList, dataTransfer?: DataTransfer) => {
        if (!context || freeze.frozen) return;
        const uiService = context.services.get<UIService>(Services.UI);

        let paths: string[];
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

            paths = grantResult.data.data.length > 0
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

            // Dropped folders are expanded to their matching files and everything else is
            // filtered out; plain files pass through untouched.
            const expansion = await withAssetsService(svc => svc.expandImportPaths(type, paths));
            if (!expansion || expansion.files.length === 0) {
                if (expansion?.expandedDirectory) {
                    uiService.notifications.info(t("assets.import.noMatchingFiles"));
                }
                return;
            }
            paths = expansion.files;
        } else if (isBundleAssetType(type)) {
            // A model bundle is authored as a folder and imported as one asset, so the picker asks
            // for folders. An extension-filtered file dialog cannot express "this whole tree".
            const selection = await getInterface().fs.selectDirectory(true);
            if (!selection.success || !selection.data.ok) {
                return;
            }
            paths = selection.data.data;
        } else {
            // Picked here rather than inside the importer so the queue knows the file list up front:
            // it is what "3 of 20" counts against, and what a retry replays.
            const selection = await getInterface().fs.selectFile(AssetExtensions[type], true);
            if (!selection.success || !selection.data.ok) {
                return;
            }
            paths = selection.data.data;
        }

        await runImport(type, paths, groupId);
    }, [context, runImport, t, withAssetsService]);

    /** Re-run the files the last import could not read, into the same group. */
    const handleRetryImport = useCallback(async (type: AssetType, paths: string[], groupId?: string) => {
        await runImport(type, paths, groupId);
    }, [runImport]);

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

    const writeClipboard = useCallback((type: ClipboardState['type']) => {
        const targets = resolveTargets();
        const targetGroups = targets.filter(target => target.isGroup).map(target => target.item as AssetGroup);
        const targetGroupIds = new Set(targetGroups.map(group => group.id));

        // Filter out groups that are children of other targeted groups
        const groupsToWrite = targetGroups.filter(
            group => !isGroupChildOfSelectedGroups(group, targetGroupIds)
        );

        // Filter out assets that are inside targeted groups to avoid duplication
        const assetsToWrite = targets
            .filter(target => !target.isGroup)
            .map(target => target.item as Asset)
            .filter(asset => !isAssetInSelectedGroups(asset, targetGroupIds));

        if (assetsToWrite.length > 0 || groupsToWrite.length > 0) {
            setClipboard({ type, assets: assetsToWrite, groups: groupsToWrite });
        }
    }, [resolveTargets, isAssetInSelectedGroups, isGroupChildOfSelectedGroups, setClipboard]);

    const handleCopy = useCallback(() => writeClipboard('copy'), [writeClipboard]);

    const handleCut = useCallback(() => writeClipboard('cut'), [writeClipboard]);

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

        // Renaming has one name to change, so it needs exactly one row. When the shared resolution
        // lands on several (F2 with a multi-selection), fall back to the focused one.
        const targets = resolveTargets();
        const target = targets.length === 1
            ? targets[0]
            : targets.find(candidate => assetSelectionKey(candidate.item.id, candidate.isGroup) === focusedItemId);

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
    }, [context, resolveTargets, focusedItemId, inputDialog, onActionComplete, withAssetsService]);

    /**
     * The one asset the single-subject actions act on, in the same priority order rename uses:
     * right-clicked row, then a lone selection, then the focused row. Groups resolve to nothing —
     * replacing contents is per file, and the card rules out a batch version.
     */
    const resolveSingleAsset = useCallback((): Asset | null => {
        if (contextMenuTarget?.item) {
            return contextMenuTarget.isGroup ? null : (contextMenuTarget.item as Asset);
        }

        const candidateId = selectedItems.size === 1 ? Array.from(selectedItems)[0] : focusedItemId;
        if (!candidateId || !candidateId.startsWith('asset:')) {
            return null;
        }
        const assetId = candidateId.replace('asset:', '');
        return Object.values(assets).flat().find(a => a.id === assetId) ?? null;
    }, [assets, contextMenuTarget, focusedItemId, selectedItems]);

    /**
     * Swap the file behind an asset while keeping its id, so every place already pointing at it
     * renders the new file instead of needing to be relinked one by one.
     *
     * `target` lets a caller outside the panel (the inspector) name the asset directly; the panel's
     * own entry points resolve it from the selection.
     */
    const handleReplaceContent = useCallback(async (target?: Asset) => {
        const ctx = contextRef.current;
        if (!ctx) return;

        const asset = target ?? resolveSingleAsset();
        if (!asset) return;

        notifyLoading(true);
        try {
            const outcome = await runReplaceAssetContentFlow(ctx, asset, t);
            if (outcome === "replaced") {
                onActionComplete();
            }
        } finally {
            notifyLoading(false);
        }
    }, [notifyLoading, onActionComplete, resolveSingleAsset, t]);

    const handleDelete = useCallback(async () => {
        notifyLoading(true);
        try {
            const ctx = contextRef.current;
            if (!ctx) return;
            const uiService = ctx.services.get<UIService>(Services.UI);
            const assetsService = ctx.services.get<AssetsService>(Services.Assets);
            
            const targets = resolveTargets();
            if (targets.length === 0) return;

            // Every asset the delete would actually remove — including the contents of any selected
            // group. Deleting a group cascades to its assets, so checking only the bare asset
            // targets let a whole folder of referenced material through without a warning.
            const affectedAssets = collectAffectedAssets(targets, assets, groups);

            // The same reading the service's guard enforces — asked through the service rather than
            // looked up here, so the list the author is shown and the list the delete is checked
            // against cannot drift apart. "No references found" and "could not look for references"
            // stay different answers: an empty index reports every asset as unused.
            const { checked: referencesChecked, references: referencesByAsset } =
                (await withAssetsService(assetsService => assetsService.findAssetReferences(affectedAssets.map(asset => asset.id))))
                ?? { checked: false, references: new Map<string, AssetReference[]>() };

            if (!referencesChecked) {
                const proceedUnverified = await uiService.showDestructiveConfirm(
                    t("assets.delete.unverifiedTitle"),
                    t("assets.delete.unverifiedMessage"),
                    t("assets.delete.action"),
                );
                if (!proceedUnverified) {
                    return;
                }
            }

            if (referencesByAsset.size > 0) {
                const details = affectedAssets
                    .map(asset => ({ asset, references: referencesByAsset.get(asset.id) ?? [] }))
                    .filter(entry => entry.references.length > 0)
                    .map(({ asset, references }) => {
                        const shown = references.slice(0, REFERENCE_PREVIEW_LIMIT).map(reference => {
                            const where = reference.detail ? `${reference.label} - ${reference.detail}` : reference.label;
                            return `  ${where}${reference.dormant ? ` (${t("properties.references.dormant")})` : ""}`;
                        });
                        const remaining = references.length - shown.length;
                        if (remaining > 0) {
                            shown.push(`  ${t("assets.delete.moreReferences", { count: remaining })}`);
                        }
                        return `- ${asset.name}:\n${shown.join("\n")}`;
                    })
                    .join("\n");

                // Warn, do not block: sometimes deleting the referenced file is exactly the intent.
                // The hierarchy is what expresses the risk — Cancel is the default and the keyboard
                // target, the delete is a danger-coloured secondary.
                const forceConfirmed = await uiService.showDestructiveConfirm(
                    t("assets.delete.inUseTitle"),
                    `${t("assets.delete.inUseMessage")}\n\n${details}`,
                    t("assets.delete.action"),
                );
                if (!forceConfirmed) {
                    return;
                }
            }

            const confirmed = await uiService.showDestructiveConfirm(
                tn("assets.delete.confirmTitle", targets.length),
                t("assets.delete.confirmMessage"),
                t("assets.delete.action"),
            );
            if (!confirmed) {
                return;
            }

            // Remove duplicate targets by id to avoid double deletion
            const uniqueTargets = Array.from(new Map(targets.map(t => [t.item.id, t])).values());

            // The author has now seen the reference list and said go ahead, so this is the one place
            // allowed through the service guard. Every other caller — a group cascade, anything
            // programmatic — is refused by default.
            const deleteFailures: string[] = [];
            await withAssetsService(async (assetsService) => {
                await assetsService.transaction(async (svc) => {
                    await Promise.all(uniqueTargets.map(async (t) => {
                        const result = t.isGroup
                            ? await svc.deleteGroup(t.type, (t.item as AssetGroup).id, true, { allowReferenced: true })
                            : await svc.deleteAsset(t.item as Asset, { allowReferenced: true });
                        if (!result.success && result.error) {
                            deleteFailures.push(result.error);
                        }
                    }));
                });
            });
            if (deleteFailures.length > 0) {
                uiService.showAlert(t("assets.delete.failedTitle"), deleteFailures.join("\n"));
            }
            onActionComplete();
        } catch (error) {
            console.error("Failed to delete asset", error);
        } finally {
            notifyLoading(false);
        }
    }, [resolveTargets, assets, groups, onActionComplete, withAssetsService, notifyLoading, context, t, tn]);


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
        handleRetryImport,
        handleImportToGroup,
        handleImportRemote,
        handleCopy,
        handleCut,
        handlePaste,
        handleRename,
        handleReplaceContent,
        handleDelete,
        handleCreateMagicTags,
        handleApplyMagicTags,
    };
}
