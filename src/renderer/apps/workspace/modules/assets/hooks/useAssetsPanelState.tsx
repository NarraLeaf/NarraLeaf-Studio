import { useCallback, useEffect, useMemo, useState } from "react";
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
import { createDefaultFilters, getUniqueTags } from "../components/FilterSystem";

export interface ClipboardState {
    type: "copy" | "cut";
    assets: Asset[];
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
    // Multi-selection related
    selectedItems: Set<string>;
    isMultiSelectMode: boolean;
    setContextMenuTarget: (target: ContextMenuTargetState | null) => void;
    setClipboard: (state: ClipboardState | null) => void;
    setDraggedItem: (state: DraggedItemState | null) => void;
    setDropTargetId: (id: string | null) => void;
    setDragOver: (value: boolean) => void;
    setFocusedItemId: (value: string | null) => void;
    setError: (value: string | null) => void;
    // Multi-selection methods
    handleItemSelect: (itemId: string, isGroup: boolean, event: React.MouseEvent) => void;
    handleClearSelection: () => void;
    handleSelectAll: (items: Array<{id: string, isGroup: boolean}>) => void;
    // Search related
    searchQuery: string;
    searchResults: Array<any>;
    isSearchResultsVisible: boolean;
    setSearchQuery: (query: string) => void;
    setSearchResultsVisible: (visible: boolean) => void;
    handleSearchResultClick: (result: any) => void;
    // Filter related
    filterConfigs: Array<any>;
    activeFilters: Array<any>;
    filteredAssets: Record<AssetType, Asset[]>;
    filteredGroups: Record<AssetType, AssetGroup[]>;
    setActiveFilters: (filters: any[]) => void;
    handleFilterOpen: () => void;
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
    // Multi-selection state
    const [selectedItems, setSelectedItems] = useState<Set<string>>(new Set());
    const [lastSelectedItem, setLastSelectedItem] = useState<string | null>(null);
    // Search state
    const [searchQuery, setSearchQuery] = useState("");
    const [searchResults, setSearchResults] = useState<Array<any>>([]);
    const [isSearchResultsVisible, setSearchResultsVisible] = useState(false);
    // Filter state
    const [activeFilters, setActiveFilters] = useState<Array<any>>([]);

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
        const assetsService = context.services.get<AssetsService>(Services.Assets);

        const unsubscribeFocus = uiService.focus.onFocusChange((focusContext) => {
            if (focusContext.area === FocusArea.LeftPanel && focusContext.targetId === panelId) {
                return;
            }
        });

        const unsubscribeAssetUpdate = assetsService.getEvents().on("updated", () => {
            // Reload assets when any asset is updated
            loadAssets();
        });

        return () => {
            unsubscribeFocus();
            unsubscribeAssetUpdate();
        };
    }, [context, isInitialized, panelId, loadAssets]);

    // Multi-selection logic
    // Treat as multi-select mode only when more than one item is selected
    const isMultiSelectMode = selectedItems.size > 1;

    const handleItemSelect = useCallback((itemId: string, isGroup: boolean, event: React.MouseEvent) => {
        const itemKey = isGroup ? `group:${itemId}` : `asset:${itemId}`;

        if (event.ctrlKey || event.metaKey) {
            // Ctrl/Cmd click: toggle selection
            setSelectedItems(prev => {
                const newSet = new Set(prev);
                if (newSet.has(itemKey)) {
                    newSet.delete(itemKey);
                } else {
                    newSet.add(itemKey);
                }
                return newSet;
            });
            setLastSelectedItem(itemKey);
        } else if (event.shiftKey && lastSelectedItem) {
            // Shift click: select range between lastSelectedItem and current item

            // Build a flat ordered list of visible item keys (preorder by type, group, asset)
            const orderedKeys: string[] = [];

            const traverseGroups = (grpList: AssetGroup[], assetList: Asset[], levelGroups: AssetGroup[], parentId?: string) => {
                // groups first
                grpList.filter(g => g.parentGroupId === parentId).forEach(g => {
                    orderedKeys.push(`group:${g.id}`);
                    traverseGroups(grpList, assetList, levelGroups, g.id);
                });
                // assets under this parent
                assetList.filter(a => (a.groupId || null) === (parentId || undefined)).forEach(a => {
                    orderedKeys.push(`asset:${a.id}`);
                });
            };

            Object.values(AssetType).forEach(t => {
                traverseGroups(groups[t], assets[t], groups[t], undefined);
            });

            const start = orderedKeys.indexOf(lastSelectedItem);
            const end = orderedKeys.indexOf(itemKey);
            if (start !== -1 && end !== -1) {
                const [from, to] = start < end ? [start, end] : [end, start];
                const range = orderedKeys.slice(from, to + 1);
                setSelectedItems(new Set(range));
            }
            // Do not update lastSelectedItem so consecutive shift-clicks extend selection
        } else {
            // Regular click: single selection
            setSelectedItems(new Set([itemKey]));
            setLastSelectedItem(itemKey);
        }

        // Update focus
        setFocusedItemId(itemKey);
    }, [lastSelectedItem, assets, groups]);

    const handleClearSelection = useCallback(() => {
        setSelectedItems(new Set());
        setLastSelectedItem(null);
    }, []);

    const handleSelectAll = useCallback((items: Array<{id: string, isGroup: boolean}>) => {
        const allKeys = items.map(item => item.isGroup ? `group:${item.id}` : `asset:${item.id}`);
        setSelectedItems(new Set(allKeys));
        setLastSelectedItem(null);
    }, []);

    // Search functions
    const performSearch = useCallback((query: string, allAssets: Record<AssetType, Asset[]>, allGroups: Record<AssetType, AssetGroup[]>) => {
        if (!query.trim()) {
            setSearchResults([]);
            setSearchResultsVisible(false);
            return;
        }

        const results: Array<any> = [];
        const lowerQuery = query.toLowerCase();

        // Search in assets
        Object.values(AssetType).forEach(assetType => {
            const typeAssets = allAssets[assetType];
            const typeGroups = allGroups[assetType];

            // Build group path map for quick lookup
            const groupPathMap = new Map<string, string[]>();
            const buildGroupPath = (group: AssetGroup, path: string[] = []): void => {
                groupPathMap.set(group.id, [...path, group.name]);
                const childGroups = typeGroups.filter(g => g.parentGroupId === group.id);
                childGroups.forEach(child => buildGroupPath(child, [...path, group.name]));
            };
            typeGroups.filter(g => !g.parentGroupId).forEach(group => buildGroupPath(group));

            // Search assets
            typeAssets.forEach(asset => {
                // Search in name
                if (asset.name.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        id: asset.id,
                        name: asset.name,
                        type: asset.type,
                        isGroup: false,
                        groupPath: asset.groupId ? groupPathMap.get(asset.groupId) : undefined,
                        matchReason: 'name' as const,
                        matchText: asset.name,
                    });
                }
                // Search in tags
                else if (asset.tags.some(tag => tag.toLowerCase().includes(lowerQuery))) {
                    const matchingTag = asset.tags.find(tag => tag.toLowerCase().includes(lowerQuery));
                    results.push({
                        id: asset.id,
                        name: asset.name,
                        type: asset.type,
                        isGroup: false,
                        groupPath: asset.groupId ? groupPathMap.get(asset.groupId) : undefined,
                        matchReason: 'tag' as const,
                        matchText: matchingTag || '',
                    });
                }
                // Search in description
                else if (asset.description.toLowerCase().includes(lowerQuery)) {
                    results.push({
                        id: asset.id,
                        name: asset.name,
                        type: asset.type,
                        isGroup: false,
                        groupPath: asset.groupId ? groupPathMap.get(asset.groupId) : undefined,
                        matchReason: 'description' as const,
                        matchText: asset.description,
                    });
                }
            });

            // Search groups
            typeGroups.forEach(group => {
                if (group.name.toLowerCase().includes(lowerQuery)) {
                    const parentPath = group.parentGroupId ? groupPathMap.get(group.parentGroupId) : [];
                    results.push({
                        id: group.id,
                        name: group.name,
                        type: group.type,
                        isGroup: true,
                        groupPath: parentPath?.length ? parentPath : undefined,
                        matchReason: 'name' as const,
                        matchText: group.name,
                    });
                }
            });
        });

        setSearchResults(results);
        setSearchResultsVisible(query.trim().length > 0);
    }, []);

    const handleSearchQueryChange = useCallback((query: string) => {
        setSearchQuery(query);
        // Always search in all assets, not filtered ones
        performSearch(query, assets, groups);
    }, [performSearch, assets, groups]);

    const handleSearchResultClick = useCallback((result: any) => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);

        if (result.isGroup) {
            // Focus group and expand it
            uiService.focus.setFocus(FocusArea.LeftPanel, `group:${result.id}`);
            setFocusedItemId(`group:${result.id}`);
            // TODO: Implement group expansion logic
        } else {
            // Focus asset and open preview if it's an image
            uiService.focus.setFocus(FocusArea.LeftPanel, `asset:${result.id}`);
            setFocusedItemId(`asset:${result.id}`);

            // Find the asset object
            const asset = Object.values(assets).flat().find(a => a.id === result.id);
            if (asset) {
                uiService.getStore().setSelection({ type: "asset", data: asset });
                uiService.panels.show("narraleaf-studio:properties");

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
            }
        }
    }, [context, assets]);

    // Filter configurations and logic
    const [refreshFiltersTrigger, setRefreshFiltersTrigger] = useState(0);

    const filterConfigs = useMemo(() => {
        const configs = createDefaultFilters();
        // Populate tag options dynamically
        const allAssets = Object.values(assets).flat();
        const tagFilter = configs.find(c => c.id === 'tags');
        if (tagFilter) {
            tagFilter.options = getUniqueTags(allAssets);
        }

        // Filter file extensions to only show existing ones
        const fileExtensionFilter = configs.find(c => c.id === 'file-extensions');
        if (fileExtensionFilter) {
            const existingExtensions = new Set<string>();
            allAssets.forEach(asset => {
                const extension = asset.name.toLowerCase().split('.').pop();
                if (extension) {
                    existingExtensions.add(extension);
                }
            });
            fileExtensionFilter.options = fileExtensionFilter.options.filter(option =>
                existingExtensions.has(option.value.toLowerCase().replace('.', ''))
            );
        }

        return configs;
    }, [assets, refreshFiltersTrigger]);

    const handleFilterOpen = useCallback(() => {
        setRefreshFiltersTrigger(prev => prev + 1);
    }, []);

    const applyFilters = useCallback((assetsToFilter: Record<AssetType, Asset[]>, groupsToFilter: Record<AssetType, AssetGroup[]>, filters: any[]) => {
        if (filters.length === 0) {
            return { assets: assetsToFilter, groups: groupsToFilter };
        }

        const filteredAssets: Record<AssetType, Asset[]> = createEmptyAssets();
        const filteredGroups: Record<AssetType, AssetGroup[]> = createEmptyGroups();

        // Group filters by type
        const tagFilters = filters.filter(f => f.filterId === 'tags').map(f => f.optionId);
        const extensionFilters = filters.filter(f => f.filterId === 'file-extensions').map(f => f.optionId);

        Object.values(AssetType).forEach(assetType => {
            const typeAssets = assetsToFilter[assetType];
            const typeGroups = groupsToFilter[assetType];

            // Filter assets
            filteredAssets[assetType] = typeAssets.filter(asset => {
                // Tag filter
                if (tagFilters.length > 0) {
                    const hasMatchingTag = tagFilters.some(tag => asset.tags.includes(tag));
                    if (!hasMatchingTag) return false;
                }

                // Extension filter (for all file types)
                if (extensionFilters.length > 0) {
                    const assetExtension = asset.name.toLowerCase().split('.').pop();
                    if (assetExtension && !extensionFilters.includes(assetExtension)) return false;
                }

                return true;
            });

            // Filter groups (include groups that have filtered assets or are ancestors of filtered assets)
            const assetGroupIds = new Set(filteredAssets[assetType].map(a => a.groupId).filter(Boolean));
            const relevantGroupIds = new Set(assetGroupIds);

            // Add ancestor groups
            const addAncestors = (groupId: string) => {
                const group = typeGroups.find(g => g.id === groupId);
                if (group?.parentGroupId) {
                    relevantGroupIds.add(group.parentGroupId);
                    addAncestors(group.parentGroupId);
                }
            };
            assetGroupIds.forEach(groupId => addAncestors(groupId as string));

            filteredGroups[assetType] = typeGroups.filter(group => relevantGroupIds.has(group.id));
        });

        return { assets: filteredAssets, groups: filteredGroups };
    }, []);

    const filteredData = useMemo(() => {
        return applyFilters(assets, groups, activeFilters);
    }, [assets, groups, activeFilters, applyFilters]);

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

    const handleAssetClick = useCallback((asset: Asset, event?: React.MouseEvent) => {
        if (!context) {
            return;
        }

        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: "asset", data: asset });
        uiService.focus.setFocus(FocusArea.LeftPanel, `asset:${asset.id}`);
        setFocusedItemId(`asset:${asset.id}`);

        // Only open preview if not multi-selecting or only one item selected
        if (selectedItems.size <= 1) {
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
        }
    }, [context, selectedItems.size]);

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

    const getSelectedAssets = (): Asset[] => {
        const ids = Array.from(selectedItems).filter(id => id.startsWith('asset:')).map(id => id.replace('asset:', ''));
        return Object.values(assets).flat().filter(a => ids.includes(a.id));
    };

    const handleCopy = useCallback(() => {
        let assetsToCopy: Asset[] = [];
        if (isMultiSelectMode) {
            assetsToCopy = getSelectedAssets();
        } else if (contextMenuTarget && contextMenuTarget.item && !contextMenuTarget.isGroup) {
            assetsToCopy = [contextMenuTarget.item as Asset];
        }

        if (assetsToCopy.length > 0) {
            setClipboard({ type: 'copy', assets: assetsToCopy });
        }
    }, [contextMenuTarget, isMultiSelectMode, selectedItems, assets]);

    const handleCut = useCallback(() => {
        let assetsToCut: Asset[] = [];
        if (isMultiSelectMode) {
            assetsToCut = getSelectedAssets();
        } else if (contextMenuTarget && contextMenuTarget.item && !contextMenuTarget.isGroup) {
            assetsToCut = [contextMenuTarget.item as Asset];
        }

        if (assetsToCut.length > 0) {
            setClipboard({ type: 'cut', assets: assetsToCut });
        }
    }, [contextMenuTarget, isMultiSelectMode, selectedItems, assets]);

    const handlePaste = useCallback(async () => {
        if (!context || !clipboard || !contextMenuTarget) {
            return;
        }

        const target = contextMenuTarget;

        await withAssetsService(async (assetsService) => {
            const targetGroupId = target.isGroup && target.item
                ? (target.item as AssetGroup).id
                : (!target.isGroup && target.item ? (target.item as Asset).groupId : undefined);

            if (clipboard.type === 'cut') {
                for (const a of clipboard.assets) {
                    await assetsService.moveAssetToGroup(a, targetGroupId);
                }
                setClipboard(null);
            } else if (clipboard.type === 'copy') {
                for (const a of clipboard.assets) {
                    const dupResult = await assetsService.duplicateAsset(a);
                    if (!dupResult.success || !dupResult.data) {
                        setError(dupResult.error || 'Failed to copy asset');
                        continue;
                    }
                    if (targetGroupId) {
                        await assetsService.moveAssetToGroup(dupResult.data, targetGroupId);
                    }
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
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);

        // Determine items to delete
        let targets: Array<{ isGroup: boolean; type: AssetType; item: Asset | AssetGroup }> = [];
        if (isMultiSelectMode) {
            // Collect asset targets from selection; groups not yet supported for multi-delete
            const assetIds = Array.from(selectedItems).filter(id => id.startsWith('asset:')).map(id => id.replace('asset:', ''));
            Object.values(assets).forEach(arr => {
                arr.forEach(a => {
                    if (assetIds.includes(a.id)) {
                        targets.push({ isGroup: false, type: a.type, item: a });
                    }
                })
            });
        } else if (contextMenuTarget && contextMenuTarget.item) {
            targets = [{ isGroup: contextMenuTarget.isGroup, type: contextMenuTarget.type, item: contextMenuTarget.item }];
        }

        if (targets.length === 0) return;

        const confirmed = await uiService.showConfirm(`Delete ${targets.length} item(s)?`, 'This cannot be undone.');
        if (!confirmed) return;

        await withAssetsService(async (assetsService) => {
            for (const t of targets) {
                if (t.isGroup) {
                    await assetsService.deleteGroup(t.type, (t.item as AssetGroup).id, false);
                } else {
                    await assetsService.deleteAsset(t.item as Asset);
                }
            }
        });

        // Clear selection if we deleted selected items
        handleClearSelection();

        await loadAssets();
    }, [context, isMultiSelectMode, selectedItems, assets, contextMenuTarget, loadAssets, withAssetsService, handleClearSelection]);

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
        // Multi-selection related
        selectedItems,
        isMultiSelectMode,
        setContextMenuTarget,
        setClipboard,
        setDraggedItem,
        setDropTargetId,
        setDragOver,
        setFocusedItemId,
        setError,
        // Multi-selection methods
        handleItemSelect,
        handleClearSelection,
        handleSelectAll,
        // Search related
        searchQuery,
        searchResults,
        isSearchResultsVisible,
        setSearchQuery: handleSearchQueryChange,
        setSearchResultsVisible,
        handleSearchResultClick,
        // Filter related
        filterConfigs,
        activeFilters,
        filteredAssets: filteredData.assets,
        filteredGroups: filteredData.groups,
        setActiveFilters,
        handleFilterOpen,
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

