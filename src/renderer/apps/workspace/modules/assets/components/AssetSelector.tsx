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
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../../context";
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

const ASSET_TYPE_LABELS = {
    [AssetType.Image]: "Images",
    [AssetType.Audio]: "Audio",
    [AssetType.Video]: "Videos",
    [AssetType.JSON]: "JSON Files",
    [AssetType.Blueprint]: "Blueprints",
    [AssetType.Font]: "Fonts",
    [AssetType.Other]: "Other",
};

export interface AssetSelectorProps {
    visible: boolean;
    assetType: AssetType;
    multiple?: boolean;
    selectedIds?: string[];
    anchorRef?: React.RefObject<HTMLElement | null>;
    title?: string;
    className?: string;
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
    onClose,
    onConfirm,
}: AssetSelectorProps) {
    const { context, isInitialized } = useWorkspace();
    const { assets, groups, loading, error, loadAssets } = useAssetData({ context, isInitialized });
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

    const displayedAssets = useMemo(() => {
        const q = searchQuery.trim().toLowerCase();
        if (!q) return filteredTypeAssets;
        return filteredTypeAssets.filter((asset) => {
            if (asset.name.toLowerCase().includes(q)) return true;
            if (asset.description?.toLowerCase().includes(q)) return true;
            if (asset.tags?.some((tag) => tag.toLowerCase().includes(q))) return true;
            return false;
        });
    }, [filteredTypeAssets, searchQuery]);

    useLayoutEffect(() => {
        if (!visible) return;

        const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max);
        const viewportMargin = 12;
        const maxPanelHeight = 560; // matches max-h

        const updatePosition = () => {
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;
            const panelHeight = Math.min(panelRef.current?.offsetHeight ?? maxPanelHeight, maxPanelHeight);

            if (anchorRef?.current) {
                const rect = anchorRef.current.getBoundingClientRect();
                const width = clamp(rect.width, 320, 480);
                const availableBelow = viewportHeight - rect.bottom - viewportMargin;
                const availableAbove = rect.top - viewportMargin;

                const shouldOpenDown = availableBelow >= panelHeight || availableBelow >= availableAbove;
                let top = shouldOpenDown ? rect.bottom + 8 : rect.top - panelHeight - 8;
                top = clamp(top, viewportMargin, viewportHeight - viewportMargin - panelHeight);
                const left = clamp(rect.left, viewportMargin, viewportWidth - viewportMargin - width);

                setAnchorStyle({
                    top,
                    left,
                    width,
                });
            } else {
                const width = 420;
                const left = clamp((viewportWidth - width) / 2, viewportMargin, viewportWidth - viewportMargin - width);
                const top = clamp(96, viewportMargin, viewportHeight - viewportMargin - maxPanelHeight);
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
        const map = new Map(typeAssets.map((asset) => [asset.id, asset]));
        return Array.from(selection)
            .map((id) => map.get(id))
            .filter((asset): asset is Asset => Boolean(asset));
    }, [selection, typeAssets]);

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
            if (!assetsService) return null;
            const cached = previewCacheRef.current[asset.id];
            if (cached) return cached;
            const result = await assetsService.fetch(asset);
            if (!result.success) return null;
            const blob = new Blob([new Uint8Array(result.data.data)]);
            const url = URL.createObjectURL(blob);
            previewCacheRef.current[asset.id] = url;
            return url;
        },
        [assetsService],
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
            Object.values(previewCacheRef.current).forEach((url) => URL.revokeObjectURL(url));
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
                {groupId === null && (
                    <div className="px-2 text-[11px] uppercase tracking-wide text-gray-500 mb-1">Ungrouped</div>
                )}
                {visibleGroups.map((group) => {
                    const isExpanded = expandedGroups.has(group.id);
                    return (
                        <div key={group.id} className="mb-1">
                            <button
                                onClick={() => toggleGroup(group.id)}
                                className="w-full flex items-center gap-2 px-3 py-2 rounded-md hover:bg-white/5 transition-colors text-left"
                                style={{ paddingLeft: `${paddingLeft + 8}px` }}
                            >
                                <ChevronRight
                                    className={`w-3 h-3 text-gray-400 transition-transform ${isExpanded ? "rotate-90" : ""}`}
                                />
                                <span className="text-sm flex-1 truncate text-gray-100">{group.name}</span>
                            </button>
                            {isExpanded && (
                                <div className="space-y-1">
                                    {assetsByGroup.get(group.id)?.map((asset) => renderAssetRow(asset, level + 1))}
                                    {renderGroup(group.id, level + 1)}
                                </div>
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
                        {assets.map((asset) => renderAssetRow(asset, level + 1))}
                    </div>
                )}
            </div>
        );
    };

    const renderAssetRow = (asset: Asset, level: number) => {
        const isSelected = selection.has(asset.id);
        const ItemIcon = ASSET_TYPE_ICONS[asset.type];
        return (
            <button
                key={asset.id}
                onClick={() => handleItemClick(asset)}
                onMouseEnter={(e) => handlePreviewEnter(asset, e.currentTarget)}
                onMouseLeave={hidePreview}
                className={`w-full text-left rounded-md px-3 py-2 flex items-center gap-2 transition-colors hover:bg-white/5 ${
                    isSelected ? "bg-primary/20 border border-primary/60" : "border border-transparent"
                }`}
                style={{ paddingLeft: `${20 + level * 12}px` }}
            >
                <ItemIcon className="w-4 h-4 text-gray-400" />
                <div className="flex-1 min-w-0">
                    <div className="text-sm truncate">{asset.name}</div>
                    <div className="text-[11px] text-gray-500 truncate">
                        {asset.tags?.length ? asset.tags.join(", ") : "No tags"}
                    </div>
                </div>
                {isSelected && <Check className="w-4 h-4 text-primary flex-shrink-0" />}
            </button>
        );
    };

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
    const headerLabel = title ?? `Select ${ASSET_TYPE_LABELS[assetType]}`;

    const panel = (
        <div
            className="fixed inset-0 z-50 bg-black/40"
            onMouseDown={(e) => {
                if (e.target === e.currentTarget) {
                    onClose();
                }
            }}
        >
            <div
                ref={panelRef}
                style={anchorRef?.current ? { position: "absolute", top: anchorStyle.top, left: anchorStyle.left, width: anchorStyle.width } : { width: anchorStyle.width }}
                className={`${anchorRef?.current ? "" : "mt-12 mx-auto"} bg-[#0b0d12] border border-white/20 rounded-lg shadow-2xl text-gray-200 max-h-[560px] flex flex-col ${className}`}
                onMouseDown={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-4 py-3 border-b border-white/10">
                    <div className="flex items-center gap-2">
                        <Icon className="w-4 h-4 text-primary" />
                        <div className="flex flex-col">
                            <span className="text-sm font-semibold">{headerLabel}</span>
                            <span className="text-xs text-gray-400">{typeAssets.length} items</span>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={handleImportAssets}
                            disabled={loading}
                            className="p-1 rounded hover:bg-white/10 disabled:opacity-50"
                            title="Import from disk"
                        >
                            <FolderOpen className="w-4 h-4" />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1 rounded hover:bg-white/10"
                            title="Close"
                        >
                            <X className="w-4 h-4" />
                        </button>
                    </div>
                </div>

                <div className="p-4 space-y-3 border-b border-white/10">
                    <SearchBox value={searchQuery} onChange={setSearchQuery} placeholder="Search assets..." />
                    <FilterSystem
                        filters={filterConfigs}
                        activeFilters={activeFilters}
                        onFiltersChange={setActiveFilters}
                        onFilterOpen={handleFilterOpen}
                    />
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-8 text-gray-400 gap-2">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Loading assets...</span>
                    </div>
                ) : error ? (
                    <div className="flex items-start gap-2 px-4 py-6 text-red-400">
                        <AlertCircle className="w-4 h-4 mt-0.5" />
                        <div className="text-sm">
                            <div>Failed to load assets</div>
                            <div className="text-xs text-red-300/80">{error}</div>
                        </div>
                    </div>
                ) : displayedAssets.length === 0 ? (
                    <div className="px-4 py-8 text-center text-sm text-gray-500">
                        No assets match the current filters
                    </div>
                ) : (
                    <div className="flex-1 overflow-y-auto px-2 py-3 space-y-2">
                        {/* Root groups */}
                        {groupsByParent.get(null)?.length ? renderGroup(null, 0) : null}

                        {/* Ungrouped assets (null key handled in renderGroup) */}
                        {!groupsByParent.get(null)?.length && (assetsByGroup.get(null)?.length ?? 0) > 0 && (
                            <div className="space-y-1">{renderGroup(null, 0)}</div>
                        )}

                        {/* Fallback: if no groups present, still list all displayed assets flat */}
                        {groupsByParent.size === 0 && (
                            <div className="space-y-1">
                                {displayedAssets.map((asset) => renderAssetRow(asset, 0))}
                            </div>
                        )}
                    </div>
                )}

                {multiple && (
                    <div className="px-4 py-3 border-t border-white/10 flex items-center justify-between bg-black/20">
                        <div className="text-xs text-gray-400">
                            {selection.size} selected
                            {selection.size > 0 && (
                                <button
                                    onClick={() => setSelection(new Set())}
                                    className="ml-2 text-red-400 hover:text-red-300"
                                >
                                    Clear
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={onClose}
                                className="px-3 py-1.5 text-sm rounded-md bg-white/5 hover:bg-white/10 text-gray-200"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirm}
                                disabled={selection.size === 0}
                                className="px-3 py-1.5 text-sm rounded-md bg-primary text-white hover:bg-primary/90 disabled:opacity-60"
                            >
                                Choose
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
                    className="z-50 pointer-events-none border border-white/20 rounded-lg shadow-2xl bg-black/70 overflow-hidden backdrop-blur"
                >
                    <img src={previewState.url} alt={previewState.asset.name} className="w-full h-full object-contain bg-black/60" />
                </div>
            )}
        </>,
        document.body,
    );
}

