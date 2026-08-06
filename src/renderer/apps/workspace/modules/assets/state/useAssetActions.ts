import { useCallback, useRef, useState } from 'react';
import { Asset, AssetGroup, AssetSource } from '@/lib/workspace/services/assets/types';
import { REMOTE_ASSET_ALLOWED_PROTOCOLS } from '@shared/constants/remoteAsset';
import type { RequestStatus } from '@shared/types/ipcEvents';
import {
    ASSET_CATEGORY_EXTENSIONS,
    ASSET_CATEGORY_TYPES,
    AssetCategory,
    AssetType,
    isBundleAssetCategory,
} from '@/lib/workspace/services/assets/assetTypes';
import { assetTypeMatchesExtension } from '@/lib/workspace/services/assets/importPathExpansion';
import { runReplaceAssetContentFlow } from '@/lib/workspace/assets/replaceAssetContentFlow';
import type { ImportQueueController, ImportQueueFailure } from './useImportQueue';
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
import {
    NEW_TEXT_FILE_DEFAULT_EXTENSION,
    resolveNewTextFileName,
    validateNewTextFileName,
} from './newTextFileName';
import { openAssetPreviewTabsInEditor } from '../dnd/openDraggedAssetsInEditor';
import type { ModelImportSelection } from '../components/ModelImportWizard';
import type { MediaImportResolution } from '../components/MediaImportDialog';
import {
    categoryNeedsMediaTriage,
    planMediaImport,
    type MediaImportPlan,
} from './mediaImportTriage';
import { platformDefaultLineEnding } from '../editors/text/textEditableFiles';
import { toPersistedEol } from '../editors/text/textDocumentPreferences';

export type { ContextMenuTargetState };

export interface UseAssetActionsParams {
    context: WorkspaceContext | null;
    inputDialog: InputDialog | null;
    assets: Record<AssetCategory, Asset[]>;
    groups: Record<AssetCategory, AssetGroup[]>;
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
 * Group deletion cascades (`deleteGroup(category, id, true)`), and nested groups cascade with it, so
 * a reference check that looked only at the selected rows would clear a folder containing referenced
 * assets without a word.
 */
function collectAffectedAssets(
    targets: readonly AssetActionTarget[],
    assets: Record<AssetCategory, Asset[]>,
    groups: Record<AssetCategory, AssetGroup[]>,
): Asset[] {
    const collected = new Map<string, Asset>();

    for (const target of targets) {
        if (!target.isGroup) {
            const asset = target.item as Asset;
            collected.set(asset.id, asset);
            continue;
        }

        const groupIds = new Set<string>([target.item.id]);
        const candidates = groups[target.category] ?? [];
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
        for (const asset of assets[target.category] ?? []) {
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

/**
 * Delete the directories a conversion wrote into, once the importer has copied out of them.
 *
 * Best effort by design: the files have already been copied into the library by the time this runs,
 * so a leftover directory under `.nlstudio/` is untidy rather than harmful, and raising about it
 * would report a failure for an import that succeeded.
 */
async function removeConvertScratch(directories: readonly string[]): Promise<void> {
    for (const directory of directories) {
        await getInterface().fs.deleteDir(directory).catch(() => undefined);
    }
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
     * The pending model-import wizard, and the group its result lands in.
     *
     * Held here rather than in the panel because the group is decided at the moment the author
     * clicks Import - on a section header, on a folder row, from the context menu - and by the time
     * the wizard closes there is nothing left pointing at it.
     */
    const [modelImportRequest, setModelImportRequest] = useState<{ groupId?: string } | null>(null);

    /**
     * The import waiting on an answer about files that will not play, and where it was going.
     *
     * Held here for the same reason the model wizard's is: the section and the group are decided at
     * the moment the author drops or picks, and nothing points at them once the dialog is up.
     */
    const [mediaImportRequest, setMediaImportRequest] = useState<{
        category: AssetCategory;
        groupId?: string;
        plan: MediaImportPlan;
    } | null>(null);

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
     *
     * `entryByPath` is the model wizard's arm: it has already read the manifests and knows which
     * file in each folder is the entry, so it says so rather than leaving the importer's own
     * detection to reach the same conclusion a second time — which it cannot, for the one case that
     * matters, a folder holding two models where detection deliberately refuses to guess.
     *
     * `preFailures` and `scratchDirs` are the media conversion's arm. A file that failed to convert
     * never reaches an importer, so it has no per-file result to be turned away by, and it would
     * otherwise vanish between the dialog closing and the panel redrawing.
     */
    const runImport = useCallback(async (
        category: AssetCategory,
        paths: string[],
        groupId?: string,
        options?: {
            entryByPath?: Record<string, string>;
            /** Named in the panel's failure list without ever having been handed to an importer. */
            preFailures?: readonly ImportQueueFailure[];
            /** Removed once the importer has copied out of them. */
            scratchDirs?: readonly string[];
        },
    ) => {
        const ctx = contextRef.current;
        if (!ctx) return;
        const entryByPath = options?.entryByPath;
        const preFailures = options?.preFailures ?? [];
        const scratchDirs = options?.scratchDirs ?? [];

        // Nothing to hand an importer. Reachable now that a conversion can fail for every file in a
        // run: the failures still have to be named, and the scratch directory still has to go.
        if (paths.length === 0) {
            if (preFailures.length > 0) {
                importQueue?.start({ category, groupId, total: 0 });
                importQueue?.finish([...preFailures]);
            }
            await removeConvertScratch(scratchDirs);
            return;
        }
        const uiService = ctx.services.get<UIService>(Services.UI);

        notifyLoading(true);
        importQueue?.start({ category, groupId, total: paths.length });

        await withAssetsService(async (assetsService) => {
            // One category, one or more concrete types. The bucketing reads the ambiguous files
            // (`.json`, claimed by both JSON and Blueprint) to decide; see
            // `LocalAssetsManager.bucketPathsByAssetType`.
            const buckets = await assetsService.bucketPathsByAssetType(category, paths);
            await assetsService.transaction(async (svc) => {
                const failures: { path: string; error?: string }[] = [...preFailures];
                const importedAssets: Asset[] = [];
                let completed = 0;

                for (const bucket of buckets) {
                    const result = await svc.importFromPaths(bucket.type, bucket.paths, {
                        // Progress counts across the whole run, not per bucket: the author dropped
                        // one pile of files and "3 of 20" has to mean that pile.
                        onProgress: progress => importQueue?.progress({
                            completed: completed + progress.completed,
                            total: paths.length,
                            current: progress.current,
                        }),
                    });

                    if (!result.success) {
                        // This bucket fell over, so every file in it is still outstanding.
                        failures.push(...bucket.paths.map(path => ({ path, error: result.error })));
                        uiService.showAlert(t("assets.import.failedTitle"), result.error || t("assets.unknownError"));
                        completed += bucket.paths.length;
                        continue;
                    }

                    // `importFromPaths` answers 1:1 with the paths it was handed, which is what lets
                    // a failure be named by file rather than by a bare error string.
                    const perFile = result.data ?? [];
                    failures.push(...perFile.flatMap((assetResult, index) =>
                        assetResult.success ? [] : [{ path: bucket.paths[index], error: assetResult.error }]
                    ));
                    for (const [index, assetResult] of perFile.entries()) {
                        if (!assetResult.success || !assetResult.data) {
                            continue;
                        }
                        const asset = assetResult.data as Asset;
                        importedAssets.push(asset);

                        // Written straight after the copy, while the 1:1 correspondence with the
                        // source path is still in hand — the asset record itself no longer says
                        // which folder it came from.
                        const entry = entryByPath?.[bucket.paths[index]];
                        if (entry) {
                            await svc.patchAssetExtras(asset, { modelEntry: entry });
                        }
                    }
                    completed += bucket.paths.length;
                }

                // Anything the bucketing could not place (dropped onto a section that does not take
                // it) never reached an importer, and is reported rather than silently swallowed.
                const attempted = new Set(buckets.flatMap(bucket => bucket.paths));
                failures.push(...paths
                    .filter(path => !attempted.has(path))
                    .map(path => ({ path, error: t("assets.import.noMatchingFiles") })));

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

        await removeConvertScratch(scratchDirs);
        onActionComplete();
        notifyLoading(false);
    }, [importQueue, notifyLoading, onActionComplete, t, withAssetsService]);

    const handleImport = useCallback(async (category: AssetCategory, groupId?: string, files?: FileList, dataTransfer?: DataTransfer) => {
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
            // filtered out; plain files pass through untouched. Expanded against every member type
            // of the section, so a folder of mp3s and mp4s dropped on Media brings both.
            const expansion = await withAssetsService(svc => svc.expandCategoryImportPaths(category, paths));
            if (!expansion || expansion.files.length === 0) {
                if (expansion?.expandedDirectory) {
                    uiService.notifications.info(t("assets.import.noMatchingFiles"));
                }
                return;
            }
            paths = expansion.files;
        } else if (isBundleAssetCategory(category)) {
            // A model bundle is authored as a folder and imported as one asset, and which folder
            // that is is exactly what a bare picker cannot settle: the author has one character's
            // folder, or its parent, or a library of twelve, and no way to tell which the dialog
            // wants. So the wizard asks for the kind, searches the tree itself, and comes back
            // through `completeModelImport` with the folders it found. The drop path above keeps
            // going straight in - a dropped folder already names itself.
            setModelImportRequest({ groupId });
            return;
        } else {
            // Picked here rather than inside the importer so the queue knows the file list up front:
            // it is what "3 of 20" counts against, and what a retry replays. The filter is the
            // union of the section's member types, so one dialog covers the whole section.
            const selection = await getInterface().fs.selectFile(ASSET_CATEGORY_EXTENSIONS[category], true);
            if (!selection.success || !selection.data.ok) {
                return;
            }
            paths = selection.data.data;
        }

        // Asked before a single byte is copied, so a file that will not play is a question rather
        // than a refusal reported afterwards about work already done. Files with nothing wrong with
        // them never appear in the dialog, and a run with no problems never opens one.
        if (categoryNeedsMediaTriage(category)) {
            notifyLoading(true);
            const plan = await planMediaImport(paths, async (path) => {
                const result = await getInterface().probeMedia(path);
                return result.success ? result.data.outcome : null;
            });
            notifyLoading(false);

            if (plan.problems.length > 0) {
                setMediaImportRequest({ category, groupId, plan });
                return;
            }
        }

        await runImport(category, paths, groupId);
    }, [context, freeze.frozen, notifyLoading, runImport, t, withAssetsService]);

    /** Re-run the files the last import could not read, into the same group. */
    const handleRetryImport = useCallback(async (category: AssetCategory, paths: string[], groupId?: string) => {
        await runImport(category, paths, groupId);
    }, [runImport]);

    /**
     * Import the folders the model wizard settled on, into the group the author started from.
     *
     * The freeze is re-checked here and not only at the point the wizard opened: the dialog is a
     * conversation, and a working-tree re-read can begin while it is on screen. A write let through
     * on the strength of a check made several clicks ago is the shape of the silent no-op the freeze
     * latch exists to prevent.
     */
    const completeModelImport = useCallback(async (selection: ModelImportSelection[]) => {
        const request = modelImportRequest;
        setModelImportRequest(null);
        if (!request || selection.length === 0 || freeze.frozen) {
            return;
        }
        await runImport(
            AssetCategory.Model,
            selection.map(entry => entry.rootPath),
            request.groupId,
            { entryByPath: Object.fromEntries(selection.map(entry => [entry.rootPath, entry.entry])) },
        );
    }, [freeze.frozen, modelImportRequest, runImport]);

    const cancelModelImport = useCallback(() => setModelImportRequest(null), []);

    /**
     * Carry out whatever the media dialog's author decided.
     *
     * The freeze is re-checked here as well as on the dialog's own buttons, for the reason the model
     * wizard states: the dialog is a conversation, and a working-tree re-read can begin while it is
     * on screen. Anything already converted is still cleaned up, so a refusal does not leave the
     * scratch directory behind.
     */
    const completeMediaImport = useCallback(async (resolution: MediaImportResolution) => {
        const request = mediaImportRequest;
        setMediaImportRequest(null);
        if (!request) {
            return;
        }
        if (freeze.frozen) {
            await removeConvertScratch(resolution.scratchDirs);
            return;
        }
        await runImport(request.category, resolution.paths, request.groupId, {
            preFailures: resolution.failures,
            scratchDirs: resolution.scratchDirs,
        });
    }, [freeze.frozen, mediaImportRequest, runImport]);

    const cancelMediaImport = useCallback(() => setMediaImportRequest(null), []);

    /**
     * Import a URL as a pinned asset: Studio fetches it now and keeps the bytes with the project.
     *
     * Reported through the import strip rather than a bare spinner, because this really is a
     * download - it can take a while, and it can fail for reasons the author has to see (the host is
     * unreachable, the URL serves a login page, the file is too big). A one-item run reuses the
     * strip's retry, so a failure keeps the URL instead of asking for it again.
     */
    const handleImportRemote = useCallback(async (category: AssetCategory, groupId?: string) => {
        if (!context || !inputDialog || freeze.frozen) return;

        const url = await inputDialog.show({
            title: t("assets.import.remoteTitle"),
            placeholder: "https://example.com/asset.png",
            description: t("assets.import.remoteDescription"),
            required: true,
            validation: (value) => {
                let parsed: URL;
                try {
                    parsed = new URL(value.trim());
                } catch {
                    return t("assets.import.remoteInvalidUrl");
                }
                // Checked here as well as in main, so a `file:` or `data:` address is refused while
                // the author is still looking at the field they typed it into.
                return REMOTE_ASSET_ALLOWED_PROTOCOLS.includes(parsed.protocol)
                    ? null
                    : t("assets.import.remoteUnsupportedScheme");
            },
            // The section's first member type: enough for the dialog's own accent. Which member the
            // asset really is gets decided from the bytes, once they are here.
            assetType: ASSET_CATEGORY_TYPES[category][0],
        });

        if (!url) {
            return;
        }

        const trimmed = url.trim();
        notifyLoading(true);
        importQueue?.start({ category, groupId, total: 1 });
        importQueue?.progress({ completed: 0, total: 1, current: trimmed });

        await withAssetsService(async (assetsService) => {
            let result: RequestStatus<Asset<AssetType, AssetSource.Remote>> = {
                success: false,
                error: t("assets.unknownError"),
            };
            await assetsService.transaction(async (svc) => {
                result = await svc.importRemoteAsset(category, trimmed, groupId);
            });
            importQueue?.progress({ completed: 1, total: 1 });
            importQueue?.finish(result.success ? [] : [{ path: trimmed, error: result.error }]);

            if (!result.success && !importQueue) {
                context.services.get<UIService>(Services.UI).showAlert(
                    t("assets.import.remoteFailedTitle"),
                    result.error || t("assets.unknownError")
                );
            }
        });

        onActionComplete();
        notifyLoading(false);
    }, [context, freeze.frozen, importQueue, inputDialog, withAssetsService, onActionComplete, notifyLoading, t]);

    // Support drag-in files directly to a group
    const handleImportToGroup = useCallback(async (category: AssetCategory, groupId?: string, files?: FileList, dataTransfer?: DataTransfer) => {
        notifyLoading(true);
        await handleImport(category, groupId, files, dataTransfer);
        notifyLoading(false);
    }, [handleImport, notifyLoading]);

    const handleCreateGroup = useCallback(async (category: AssetCategory, parentGroupId?: string) => {
        notifyLoading(true);
        const groupName = inputDialog ? await inputDialog.showCreateGroupDialog(category, parentGroupId) : null;
        if (!groupName) { notifyLoading(false); return; }

        await withAssetsService(async (assetsService) => {
            const result = await assetsService.createGroup(category, groupName, parentGroupId);
            if (!result.success) {
                // TODO: Show error
            }
        });
        onActionComplete();
        notifyLoading(false);
    }, [inputDialog, withAssetsService, onActionComplete, notifyLoading]);

    /**
     * Create an empty text file under Other and open it.
     *
     * The only asset an author *makes* rather than imports, so it is also the only creation path
     * with no file on disk to start from — see `AssetsService.createLocalAssetFromBytes`. The tab
     * is opened through the same helper a click on the row uses, so a file created here and a file
     * opened later land in the same editor with the same id.
     *
     * `groupId` is the group the menu was opened on; from the category header there is none and the
     * file lands loose in the section.
     */
    const handleCreateTextFile = useCallback(async (groupId?: string) => {
        const ctx = contextRef.current;
        // Frozen is refused here as well as greyed out in the menu: the row is one of several ways
        // in, and a create that reached the service would write into a project the author froze.
        if (!ctx || !inputDialog || freeze.frozen) return;

        const typed = await inputDialog.show({
            title: t("assets.newTextFile.title"),
            description: t("assets.newTextFile.prompt"),
            placeholder: t("assets.newTextFile.placeholder"),
            // Already carrying the extension, so accepting the default is one keystroke and the
            // author can see what they are getting.
            initialValue: `${t("assets.newTextFile.defaultName")}.${NEW_TEXT_FILE_DEFAULT_EXTENSION}`,
            required: true,
            maxLength: 100,
            validation: (value) => {
                const problem = validateNewTextFileName(value);
                if (problem === "empty") return t("assets.newTextFile.empty");
                if (problem === "illegalChars") return t("assets.newTextFile.illegalChars");
                return null;
            },
        });
        if (!typed) return;

        notifyLoading(true);
        // A name collision inside the group is not this function's problem: the manager runs
        // `resolveUniqueAssetName` over whatever it is handed.
        const name = resolveNewTextFileName(typed);
        const created = await withAssetsService(async (assetsService) => {
            const result = await assetsService.createLocalAssetFromBytes(
                AssetType.Other,
                name,
                new Uint8Array(0),
                groupId,
            );
            if (!result.success || !result.data) {
                ctx.services.get<UIService>(Services.UI).showAlert(
                    t("assets.newTextFile.failedTitle"),
                    result.error || t("assets.unknownError"),
                );
                return null;
            }
            // The line ending is recorded here and only here, because a new file is zero bytes:
            // there is nothing in the content to detect it from, and the OS that made the file is
            // the only thing that can answer. Once the file has lines in it, the lines win - see
            // `resolveLineEnding`. Failure is not surfaced: the file exists and opens, and the
            // fallback (the same platform default, recomputed) is the value this would have written.
            await assetsService.patchAssetExtras(result.data, {
                textEol: toPersistedEol(platformDefaultLineEnding()),
            });
            return result.data as Asset;
        });

        onActionComplete();
        notifyLoading(false);

        if (created) {
            if (groupId && expandGroup) {
                // Otherwise the row the author just made is behind a collapsed folder.
                expandGroup(groupId);
            }
            openAssetPreviewTabsInEditor(ctx, [created]);
        }
    }, [expandGroup, freeze.frozen, inputDialog, notifyLoading, onActionComplete, t, withAssetsService]);

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
                        await svc.moveGroupToParent(g.category, g.id, targetGroupId);
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
                        await svc.duplicateGroup(g.category, g.id, targetGroupId);
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
                await assetsService.renameGroup(target.category, (target.item as AssetGroup).id, newName);
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
                            ? await svc.deleteGroup(t.category, (t.item as AssetGroup).id, true, { allowReferenced: true })
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
        handleCreateTextFile,
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
        /** Non-null while the model import wizard is on screen. */
        modelImportRequest,
        completeModelImport,
        cancelModelImport,
        /** Non-null while the import is waiting on an answer about files that will not play. */
        mediaImportRequest,
        completeMediaImport,
        cancelMediaImport,
    };
}
