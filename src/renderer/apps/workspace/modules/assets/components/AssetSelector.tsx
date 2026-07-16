import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
    Image,
    Music,
    Video,
    FileJson,
    Workflow,
    Type,
    File,
    Check,
    X,
    RefreshCw,
    AlertCircle,
    ChevronRight,
    FolderOpen,
} from "lucide-react";
import { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../../context";
import { useTranslation } from "@/lib/i18n";
import { SearchBox } from "./SearchBox";
import { FilterSystem } from "./FilterSystem";
import { useAssetData } from "../state/useAssetData";
import { useAssetFilters } from "../state/useAssetFilters";

const ASSET_TYPE_ICONS = {
    [AssetType.Image]: Image,
    [AssetType.Audio]: Music,
    [AssetType.Video]: Video,
    [AssetType.JSON]: FileJson,
    [AssetType.Blueprint]: Workflow,
    [AssetType.Font]: Type,
    [AssetType.Other]: File,
};

const ASSET_SELECTOR_STATE_ID = "narraleaf-studio:asset-selector";
const WINDOW_TITLEBAR_HEIGHT = 40;

interface AssetSelectorState {
    expandedGroupIdsByType?: Partial<Record<AssetType, string[]>>;
}

function sanitizeStringIds(ids: string[] | undefined): string[] {
    if (!Array.isArray(ids)) {
        return [];
    }
    return ids.filter(id => typeof id === "string" && id.length > 0);
}

/**
 * Caller-defined section (e.g. built-in presets) shown as a collapsible group in the asset list.
 * Workspace filter chips do not apply; only the search box filters `assets` (same rules as project assets).
 */
export interface AssetSelectorVirtualGroup {
    id: string;
    title: string;
    assets: Asset[];
    defaultExpanded?: boolean;
}

export interface AssetSelectorProps {
    visible: boolean;
    assetType: AssetType;
    multiple?: boolean;
    selectedIds?: string[];
    anchorRef?: React.RefObject<HTMLElement | null>;
    title?: string;
    className?: string;
    /** Extra collapsible sections controlled by the caller (built-in entries, presets, etc.) */
    virtualGroups?: AssetSelectorVirtualGroup[];
    /** Where virtual groups appear relative to the workspace tree. Default: before. */
    virtualGroupsPlacement?: "before" | "after";
    /**
     * Optional preview URL for assets that are not served by AssetsService (e.g. built-in thumbnails).
     * Return null/undefined to fall back to the default fetch path.
     */
    resolveAssetPreviewUrl?: (asset: Asset) => Promise<string | null | undefined>;
    onClose: () => void;
    onConfirm: (assets: Asset[]) => void;
}

export function AssetSelector({
    visible,
    assetType,
    multiple = false,
    selectedIds = [],
    anchorRef,
    title,
    className = "",
    virtualGroups,
    virtualGroupsPlacement = "before",
    resolveAssetPreviewUrl,
    onClose,
    onConfirm,
}: AssetSelectorProps) {
    const { t, tn } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { assets, groups, loading, hasLoaded, error, loadAssets } = useAssetData({ context, isInitialized });
    const { filterConfigs, activeFilters, setActiveFilters, handleFilterOpen, filteredAssets, filteredGroups } = useAssetFilters({ assets, groups });
    const assetsService = useMemo(() => {
        if (!context) return null;
        return context.services.get<AssetsService>(Services.Assets);
    }, [context]);

    const [searchQuery, setSearchQuery] = useState("");
    const [selection, setSelection] = useState<Set<string>>(new Set(selectedIds));
    const [anchorStyle, setAnchorStyle] = useState<{ top: number; left: number; width: number }>({ top: 0, left: 0, width: 420 });
    const panelRef = useRef<HTMLDivElement | null>(null);
    const previewTimerRef = useRef<number | null>(null);
    const previewTargetRef = useRef<HTMLElement | null>(null);
    const previewCacheRef = useRef<Record<string, string>>({});
    const [previewState, setPreviewState] = useState<{
        asset: Asset<AssetType.Image>;
        url: string;
        position: { top: number; left: number };
    } | null>(null);

    useEffect(() => {
        setSelection(new Set(selectedIds));
    }, [selectedIds, visible]);

    const typeAssets = useMemo(() => assets[assetType] ?? [], [assets, assetType]);
    const filteredTypeAssets = useMemo(() => filteredAssets[assetType] ?? [], [filteredAssets, assetType]);
    const filteredTypeGroups = useMemo(() => filteredGroups[assetType] ?? [], [filteredGroups, assetType]);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [expandedVirtualGroups, setExpandedVirtualGroups] = useState<Set<string>>(new Set());
    const [stateReady, setStateReady] = useState(false);
    const selectorWasVisibleRef = useRef(false);

    useLayoutEffect(() => {
        if (!context) return;
        setStateReady(false);
        const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
        const saved = panelStateService.getPanelState<AssetSelectorState>(ASSET_SELECTOR_STATE_ID);
        setExpandedGroups(new Set(sanitizeStringIds(saved?.expandedGroupIdsByType?.[assetType])));
        setStateReady(true);
    }, [assetType, context]);

    useEffect(() => {
        if (!context || !stateReady) return;
        const panelStateService = context.services.get<PanelStateService>(Services.PanelState);
        const current = panelStateService.getPanelState<AssetSelectorState>(ASSET_SELECTOR_STATE_ID);
        panelStateService.setPanelState<AssetSelectorState>(ASSET_SELECTOR_STATE_ID, {
            expandedGroupIdsByType: {
                ...(current?.expandedGroupIdsByType ?? {}),
                [assetType]: Array.from(expandedGroups),
            },
        });
    }, [assetType, context, expandedGroups, stateReady]);

    useEffect(() => {
        if (!hasLoaded) return;
        const knownGroupIds = new Set((groups[assetType] ?? []).map(group => group.id));
        setExpandedGroups(prev => {
            const next = new Set(Array.from(prev).filter(id => knownGroupIds.has(id)));
            return next.size === prev.size ? prev : next;
        });
    }, [assetType, groups, hasLoaded]);

    useEffect(() => {
        if (!visible) {
            selectorWasVisibleRef.current = false;
            return;
        }
        if (!selectorWasVisibleRef.current) {
            selectorWasVisibleRef.current = true;
            if (virtualGroups?.length) {
                setExpandedVirtualGroups(
                    new Set(virtualGroups.filter((g) => g.defaultExpanded !== false).map((g) => g.id)),
                );
            } else {
                setExpandedVirtualGroups(new Set());
            }
        }
    }, [visible, virtualGroups]);

    const matchesAssetSearch = useCallback((asset: Asset, q: string) => {
        if (!q) return true;
        const lower = q.toLowerCase();
        if (asset.name.toLowerCase().includes(lower)) return true;
        if (asset.description?.toLowerCase().includes(lower)) return true;
        if (asset.tags?.some((tag) => tag.toLowerCase().includes(lower))) return true;
        return false;
    }, []);

    const displayedAssets = useMemo(() => {
        const q = searchQuery.trim();
        if (!q) return filteredTypeAssets;
        return filteredTypeAssets.filter((asset) => matchesAssetSearch(asset, q));
    }, [filteredTypeAssets, searchQuery, matchesAssetSearch]);

    const filteredVirtualGroups = useMemo(() => {
        if (!virtualGroups?.length) return [];
        const q = searchQuery.trim();
        return virtualGroups.map((group) => ({
            ...group,
            assets: q ? group.assets.filter((a) => matchesAssetSearch(a, q)) : group.assets,
        }));
    }, [virtualGroups, searchQuery, matchesAssetSearch]);

    const virtualAssetsFlat = useMemo(
        () => filteredVirtualGroups.flatMap((g) => g.assets),
        [filteredVirtualGroups],
    );

    const virtualAssetCount = useMemo(() => virtualGroups?.reduce((n, g) => n + g.assets.length, 0) ?? 0, [virtualGroups]);

    useLayoutEffect(() => {
        if (!visible) return;

        const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
        const viewportMargin = 12;
        const viewportTop = WINDOW_TITLEBAR_HEIGHT + viewportMargin;
        const maxPanelHeight = 560; // matches max-h

        const updatePosition = () => {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const panelHeight = Math.min(panelRef.current?.offsetHeight ?? maxPanelHeight, maxPanelHeight);

            if (anchorRef?.current) {
                const rect = anchorRef.current.getBoundingClientRect();
                const width = clamp(rect.width, 320, 480);
                const availableBelow = viewportHeight - rect.bottom - viewportMargin;
                const availableAbove = rect.top - viewportTop;

                const shouldOpenDown = availableBelow >= panelHeight || availableBelow >= availableAbove;
                let top = shouldOpenDown ? rect.bottom + 8 : rect.top - panelHeight - 8;
                top = clamp(top, viewportTop, Math.max(viewportTop, viewportHeight - viewportMargin - panelHeight));
                const left = clamp(rect.left, viewportMargin, viewportWidth - viewportMargin - width);

                setAnchorStyle({
                    top,
                    left,
                    width,
                });
            } else {
                const width = 420;
                const left = clamp((viewportWidth - width) / 2, viewportMargin, viewportWidth - viewportMargin - width);
                const top = clamp(96, viewportTop, Math.max(viewportTop, viewportHeight - viewportMargin - maxPanelHeight));
                setAnchorStyle((prev) => ({ ...prev, top, left, width }));
            }
        };

        updatePosition();
        const handleReposition = () => updatePosition();
        window.addEventListener("resize", handleReposition);
        window.addEventListener("scroll", handleReposition, { passive: true });

        let resizeObserver: ResizeObserver | undefined;
        if (panelRef.current && "ResizeObserver" in window) {
            resizeObserver = new ResizeObserver(() => updatePosition());
            resizeObserver.observe(panelRef.current);
        }

        return () => {
            window.removeEventListener("resize", handleReposition);
            window.removeEventListener("scroll", handleReposition);
            resizeObserver?.disconnect();
        };
    }, [anchorRef, visible, displayedAssets.length]);

    const assetsByGroup = useMemo(() => {
        const map = new Map<string | null | undefined, Asset[]>();
        displayedAssets.forEach((asset) => {
            const key = asset.groupId ?? null;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(asset);
        });
        return map;
    }, [displayedAssets]);

    const groupsByParent = useMemo(() => {
        const map = new Map<string | null | undefined, typeof filteredTypeGroups>();
        filteredTypeGroups.forEach((group) => {
            const key = group.parentGroupId ?? null;
            if (!map.has(key)) map.set(key, []);
            map.get(key)!.push(group);
        });
        return map;
    }, [filteredTypeGroups]);

    const shouldRenderGroup = useMemo(() => {
        const assetSet = new Set(displayedAssets.map((a) => a.id));
        const childrenMap = groupsByParent;
        const hasVisible = (groupId: string): boolean => {
            const directAssets = assetsByGroup.get(groupId)?.some((a) => assetSet.has(a.id)) ?? false;
            const childGroups = childrenMap.get(groupId) ?? [];
            if (directAssets) return true;
            return childGroups.some((child) => hasVisible(child.id));
        };
        return hasVisible;
    }, [assetsByGroup, groupsByParent, displayedAssets]);

    const selectedAssets = useMemo(() => {
        const map = new Map<string, Asset>();
        typeAssets.forEach((asset) => map.set(asset.id, asset));
        virtualAssetsFlat.forEach((asset) => map.set(asset.id, asset));
        return Array.from(selection)
            .map((id) => map.get(id))
            .filter((asset): asset is Asset => Boolean(asset));
    }, [selection, typeAssets, virtualAssetsFlat]);

    const clearPreviewTimer = useCallback(() => {
        if (previewTimerRef.current) {
            window.clearTimeout(previewTimerRef.current);
            previewTimerRef.current = null;
        }
    }, []);

    const hidePreview = useCallback(() => {
        clearPreviewTimer();
        previewTargetRef.current = null;
        setPreviewState(null);
    }, [clearPreviewTimer]);

    const ensurePreviewUrl = useCallback(
        async (asset: Asset<AssetType.Image>) => {
            const cached = previewCacheRef.current[asset.id];
            if (cached) return cached;
            if (resolveAssetPreviewUrl) {
                const resolved = await resolveAssetPreviewUrl(asset);
                if (resolved) {
                    previewCacheRef.current[asset.id] = resolved;
                    return resolved;
                }
            }
            if (!assetsService) return null;
            const result = await assetsService.fetch(asset);
            if (!result.success) return null;
            const blob = new Blob([new Uint8Array(result.data.data)]);
            const url = URL.createObjectURL(blob);
            previewCacheRef.current[asset.id] = url;
            return url;
        },
        [assetsService, resolveAssetPreviewUrl],
    );

    const computePreviewPosition = useCallback((target: HTMLElement) => {
        const rect = target.getBoundingClientRect();
        const margin = 8;
        const gap = 12;
        const previewWidth = 240;
        const previewHeight = 240;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let left = rect.right + gap;
        if (left + previewWidth > viewportWidth - margin) {
            left = rect.left - previewWidth - gap;
            if (left < margin) {
                left = viewportWidth - margin - previewWidth;
            }
        }

        let top = rect.top + rect.height / 2 - previewHeight / 2;
        const maxTop = viewportHeight - margin - previewHeight;
        if (top < margin) top = margin;
        if (top > maxTop) top = maxTop;

        return { top, left };
    }, []);

    const openPreview = useCallback(
        async (asset: Asset<AssetType.Image>, target: HTMLElement) => {
            previewTargetRef.current = target;
            const url = await ensurePreviewUrl(asset);
            if (!url) return;
            if (previewTargetRef.current !== target) return;
            const position = computePreviewPosition(target);
            setPreviewState({ asset, url, position });
        },
        [computePreviewPosition, ensurePreviewUrl],
    );

    const handlePreviewEnter = useCallback(
        (asset: Asset, target: HTMLElement) => {
            if (asset.type !== AssetType.Image) return;
            clearPreviewTimer();
            previewTargetRef.current = target;
            setPreviewState((prev) => (prev?.asset.id === asset.id ? prev : null));
            previewTimerRef.current = window.setTimeout(() => {
                void openPreview(asset as Asset<AssetType.Image>, target);
            }, 550);
        },
        [clearPreviewTimer, openPreview],
    );

    useEffect(() => {
        if (!visible) {
            hidePreview();
        }
    }, [visible, hidePreview]);

    useEffect(() => {
        return () => {
            hidePreview();
            Object.values(previewCacheRef.current).forEach((url) => {
                if (url.startsWith("blob:")) URL.revokeObjectURL(url);
            });
        };
    }, [hidePreview]);

    const toggleGroup = (groupId: string) => {
        setExpandedGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    const renderGroup = (groupId: string | null | undefined, level: number) => {
        const groups = groupsByParent.get(groupId) ?? [];
        const assets = assetsByGroup.get(groupId) ?? [];

        const visibleGroups = groups.filter((g) => shouldRenderGroup(g.id));
        const paddingLeft = 20 + level * 12;

        return (
            <div key={groupId ?? "root"}>
                {visibleGroups.map((group) => {
                    const isExpanded = expandedGroups.has(group.id);
                    return (
                        <div key={group.id} className="mb-1">
                            <button
                                onClick={() => toggleGroup(group.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-fill-subtle transition-colors text-left"
                                style={{ paddingLeft: `${paddingLeft + 8}px` }}
                            >
                                <ChevronRight
                                    className={`w-3 h-3 text-fg-muted transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                />
                                <span className="text-sm flex-1 truncate text-fg">{group.name}</span>
                            </button>
                            {isExpanded && (
                                <div className="space-y-1">{renderGroup(group.id, level + 1)}</div>
                            )}
                        </div>
                    );
                })}

                {groupId !== null && assets.length > 0 && (
                    <div className="space-y-1">
                        {assets.map((asset) => renderAssetRow(asset, level))}
                    </div>
                )}

                {groupId === null && assets.length > 0 && (
                    <div className="space-y-1">
                        {assets.map((asset) => renderAssetRow(asset, level))}
                    </div>
                )}
            </div>
        );
    };

    const toggleVirtualGroup = (groupId: string) => {
        setExpandedVirtualGroups((prev) => {
            const next = new Set(prev);
            if (next.has(groupId)) next.delete(groupId);
            else next.add(groupId);
            return next;
        });
    };

    const renderAssetRow = (asset: Asset, level: number) => {
        const isSelected = selection.has(asset.id);
        const ItemIcon = ASSET_TYPE_ICONS[asset.type] ?? File;
        return (
            <button
                key={asset.id}
                onClick={() => handleItemClick(asset)}
                onMouseEnter={(e) => handlePreviewEnter(asset, e.currentTarget)}
                onMouseLeave={hidePreview}
                className={`w-full text-left rounded-md px-3 py-2 flex items-center gap-2 transition-colors hover:bg-fill-subtle ${
                    isSelected ? "bg-primary/20 border border-primary/60" : "border border-transparent"
                }`}
                style={{ paddingLeft: `${20 + level * 12}px` }}
            >
                <ItemIcon className="w-4 h-4 text-fg-muted" />
                <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{asset.name}</div>
                    <div className="text-2xs text-fg-subtle truncate">
                        {asset.tags?.length ? asset.tags.join(", ") : t("assets.noTags")}
                    </div>
                </div>
                {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
            </button>
        );
    };

    const renderVirtualGroupsBlock = () => {
        if (!filteredVirtualGroups.length) return null;
        const rootHeaderPad = 20 + 8;
        return (
            <div className="space-y-1">
                {filteredVirtualGroups.map((group) => {
                    if (group.assets.length === 0) return null;
                    const isExpanded = expandedVirtualGroups.has(group.id);
                    return (
                        <div key={group.id} className="mb-1">
                            <button
                                type="button"
                                onClick={() => toggleVirtualGroup(group.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-fill-subtle transition-colors text-left"
                                style={{ paddingLeft: `${rootHeaderPad}px` }}
                            >
                                <ChevronRight
                                    className={`w-3 h-3 text-fg-muted transition-transform flex-shrink-0 ${isExpanded ? "rotate-90" : ""}`}
                                />
                                <span className="text-sm flex-1 truncate text-fg">{group.title}</span>
                            </button>
                            {isExpanded && (
                                <div className="space-y-1">
                                    {group.assets.map((asset) => renderAssetRow(asset, 1))}
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>
        );
    };

    const hasVisibleVirtualAssets = filteredVirtualGroups.some((g) => g.assets.length > 0);

    const handleItemClick = (asset: Asset) => {
        if (multiple) {
            setSelection((prev) => {
                const next = new Set(prev);
                if (next.has(asset.id)) {
                    next.delete(asset.id);
                } else {
                    next.add(asset.id);
                }
                return next;
            });
        } else {
            onConfirm([asset]);
            onClose();
        }
    };

    const handleConfirm = () => {
        onConfirm(selectedAssets);
        onClose();
    };

    const handleImportAssets = useCallback(async () => {
        if (!assetsService) return;

        try {
            const result = await assetsService.importLocalAssets(assetType);
            if (result.success && result.data) {
                // Reload assets to show the newly imported ones
                await loadAssets();

                // Auto-select the newly imported assets
                const newAssetIds = result.data
                    .filter(assetResult => assetResult.success && assetResult.data)
                    .map(assetResult => assetResult.data!.id);

                if (newAssetIds.length > 0) {
                    setSelection(prev => {
                        const next = new Set(prev);
                        newAssetIds.forEach(id => next.add(id));
                        return next;
                    });
                }
            } else {
                console.error('Failed to import assets:', result.error);
            }
        } catch (error) {
            console.error('Error importing assets:', error);
        }
    }, [assetsService, assetType, loadAssets]);

    if (!visible) {
        return null;
    }

    const Icon = ASSET_TYPE_ICONS[assetType];
    const headerLabel = title ?? t("assets.selector.selectType", { type: t(`assets.types.${assetType}`) });

    const panel = (
        <div
            className="nl-window-content-layer z-50 bg-black/40"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                ref={panelRef}
                style={anchorRef?.current ? { position: "fixed", top: anchorStyle.top, left: anchorStyle.left, width: anchorStyle.width } : { width: anchorStyle.width }}
                className={`${anchorRef?.current ? "" : "mt-12 mx-auto"} bg-surface-overlay border border-edge-strong rounded-lg shadow-2xl text-fg max-h-[560px] flex flex-col ${className}`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-edge">
                    <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-primary" />
                        <div className="flex flex-col">
                            <span className="text-sm font-semibold">{headerLabel}</span>
                            <span className="text-xs text-fg-muted">
                                {virtualAssetCount > 0 ? tn("assets.itemCount", typeAssets.length + virtualAssetCount) : tn("assets.itemCount", typeAssets.length)}
                            </span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleImportAssets}
                            disabled={loading}
                            className="p-1 rounded hover:bg-fill disabled:opacity-50"
                            title={t("assets.selector.importFromDisk")}
                        >
                            <FolderOpen className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-fill"
                            title={t("common.close")}
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="p-4 space-y-3 border-b border-edge">
                    <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder={t("assets.searchPlaceholder")} />
                    <FilterSystem
                        filters={filterConfigs}
                        activeFilters={activeFilters}
                        onFiltersChange={setActiveFilters}
                        onFilterOpen={handleFilterOpen}
                    />
                </div>

                {loading && !hasLoaded ? (
                    <div className="flex items-center justify-center py-8 text-fg-muted gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>{t("assets.loading")}</span>
                    </div>
                ) : error ? (
                    <div className="flex items-start gap-2 px-4 py-6 text-danger">
                        <AlertCircle className="w-4 h-4 mt-0.5" />
                        <div className="text-sm">
                            <div>{t("assets.loadError")}</div>
                            <div className="text-xs text-danger/80">{error}</div>
                        </div>
                    </div>
                ) : displayedAssets.length === 0 && !hasVisibleVirtualAssets ? (
                    <div className="px-4 py-8 text-center text-sm text-fg-subtle">
                        {t("assets.selector.noAssets")}
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
                        {virtualGroupsPlacement === "before" && renderVirtualGroupsBlock()}

                        {/* Root groups */}
                        {groupsByParent.get(null)?.length ? renderGroup(null, 0) : null}

                        {/* Root-level assets when there are no top-level folders */}
                        {!groupsByParent.get(null)?.length && (assetsByGroup.get(null)?.length ?? 0) > 0 && (
                            <div className="space-y-1">{renderGroup(null, 0)}</div>
                        )}

                        {/* Orphan assets: grouped by id but no folder rows in filtered groups */}
                        {groupsByParent.size === 0 &&
                            (assetsByGroup.get(null)?.length ?? 0) === 0 &&
                            displayedAssets.length > 0 && (
                                <div className="space-y-1">
                                    {displayedAssets.map((asset) => renderAssetRow(asset, 0))}
                                </div>
                            )}

                        {virtualGroupsPlacement === "after" && renderVirtualGroupsBlock()}
                    </div>
                )}

                {multiple && (
                    <div className="px-4 py-3 border-t border-edge flex items-center justify-between bg-fill-subtle">
                        <div className="text-xs text-fg-muted">
                            {t("assets.selector.selectedCount", { count: selection.size })}
                            {selection.size > 0 && (
                                <button
                                    onClick={() => setSelection(new Set())}
                                    className="ml-2 text-danger hover:text-danger/80"
                                >
                                    {t("common.clear")}
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={onClose}
                                className="px-3 py-1.5 text-sm rounded-md bg-fill-subtle hover:bg-fill text-fg"
                            >
                                {t("common.cancel")}
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={selection.size === 0}
                                className="px-3 py-1.5 text-sm rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
                            >
                                {t("assets.selector.choose")}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );

    return createPortal(
        <>
            {panel}
            {previewState && (
                <div
                    style={{
                        position: "fixed",
                        top: previewState.position.top,
                        left: previewState.position.left,
                        width: 240,
                        height: 240,
                    }}
                    className="z-50 pointer-events-none border border-edge-strong rounded-lg shadow-2xl bg-black/70 overflow-hidden backdrop-blur"
                >
                    <img src={previewState.url} alt={previewState.asset.name} className="w-full h-full object-contain bg-black/60" />
                </div>
            )}
        </>,
        document.body,
    );
}
