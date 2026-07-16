import { Dispatch, SetStateAction, DragEvent, useMemo, useState, useEffect, useLayoutEffect, useCallback, useRef } from "react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { FolderPlus, Link, Upload, ChevronLeft } from "lucide-react";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { ASSET_TYPE_ICONS } from "../constants";
import { useWorkspace } from "../../../context";
import { useTranslation } from "@/lib/i18n";
import { FileSystemService } from "@/lib/workspace/services/core/FileSystem";

interface AssetsIconViewProps {
    dropTargetId: string | null;
    handleRootDrop: (event: DragEvent, type: AssetType, contextualGroup?: AssetGroup | null) => Promise<void>;
    actionLoading: boolean;
    setDropTargetId: Dispatch<SetStateAction<string | null>>;
    handleImport: (type: AssetType) => void;
    handleImportRemote: (type: AssetType) => void;
    handleCreateGroup: (type: AssetType) => void;
    iconSize: number;
    onIconSizeChange: (nextSize: number) => void;
    groupPathIds: string[];
    onGroupPathChange: (nextPathIds: string[]) => void;
}

export function AssetsIconView({
    dropTargetId,
    handleRootDrop,
    actionLoading,
    setDropTargetId,
    handleImport,
    handleImportRemote,
    handleCreateGroup,
    iconSize,
    onIconSizeChange,
    groupPathIds,
    onGroupPathChange,
}: AssetsIconViewProps) {
    const { t, tn } = useTranslation();
    const {
        groups,
        filteredAssets,
        filteredGroups,
        draggedItem,
        handleGroupFocus,
        compactToolbar,
        setAssetsIconToolbarCenter,
    } = useAssetsPanelContext();
    const { context } = useWorkspace();
    const groupStack = useMemo(() => {
        const groupById = new Map<string, AssetGroup>();
        Object.values(groups).flat().forEach(group => groupById.set(group.id, group));
        const stack: Array<{ group: AssetGroup; type: AssetType }> = [];
        groupPathIds.forEach(groupId => {
            const group = groupById.get(groupId);
            if (group) {
                stack.push({ group, type: group.type });
            }
        });
        return stack;
    }, [groups, groupPathIds]);
    const activeGroup = groupStack.length > 0 ? groupStack[groupStack.length - 1] : null;
    const parentPredicate = useCallback(
        (parentId?: string) => (activeGroup ? parentId === activeGroup.group.id : !parentId),
        [activeGroup],
    );
    const [thumbnailMap, setThumbnailMap] = useState<Record<string, string>>({});
    const thumbnailCacheRef = useRef<Record<string, string>>({});
    const imageAssets = useMemo(
        () => Object.values(filteredAssets).flat().filter((asset) => asset.type === AssetType.Image),
        [filteredAssets],
    );

    const requestThumbnail = useCallback(
        async (asset: Asset) => {
            if (!context) {
                return;
            }

            if (thumbnailCacheRef.current[asset.id]) {
                return thumbnailCacheRef.current[asset.id];
            }

            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const fsService = context.services.get<FileSystemService>(Services.FileSystem);
            const result = await assetsService.getThumbnailPath(asset);
            if (!result.success || !result.data) {
                return;
            }

            const rawResult = await fsService.readRaw(result.data);
            if (!rawResult.ok || !rawResult.data) {
                return;
            }

            const bufferSource = rawResult.data.buffer.slice(
                rawResult.data.byteOffset,
                rawResult.data.byteOffset + rawResult.data.byteLength,
            ) as ArrayBuffer;
            const blob = new Blob([bufferSource]);
            const url = URL.createObjectURL(blob);

            thumbnailCacheRef.current[asset.id] = url;
            setThumbnailMap((prev) => {
                if (prev[asset.id] === url) {
                    return prev;
                }
                return { ...prev, [asset.id]: url };
            });

            return url;
        },
        [context],
    );

    useEffect(() => {
        return () => {
            Object.values(thumbnailCacheRef.current).forEach(URL.revokeObjectURL);
            thumbnailCacheRef.current = {};
        };
    }, []);

    const handleEnterGroup = useCallback((group: AssetGroup, type: AssetType) => {
        onGroupPathChange([...groupPathIds, group.id]);
    }, [groupPathIds, onGroupPathChange]);

    const handleBack = useCallback(() => {
        onGroupPathChange(groupPathIds.slice(0, -1));
    }, [groupPathIds, onGroupPathChange]);

    useLayoutEffect(() => {
        if (!compactToolbar) {
            setAssetsIconToolbarCenter(null);
            return;
        }
        if (activeGroup) {
            setAssetsIconToolbarCenter({
                title: activeGroup.group.name,
                onBack: handleBack,
            });
        } else {
            setAssetsIconToolbarCenter(null);
        }
    }, [compactToolbar, activeGroup, handleBack, setAssetsIconToolbarCenter]);

    useEffect(() => {
        return () => setAssetsIconToolbarCenter(null);
    }, [setAssetsIconToolbarCenter]);

    const displayTypes = activeGroup ? [activeGroup.type] : Object.values(AssetType);
    const minIconSize = 120;
    const maxIconSize = 240;
    const step = 10;

    return (
        <div
            className="h-full flex flex-col relative"
            onWheel={(event) => {
                if (!event.ctrlKey) return;
                event.preventDefault();
                const direction = event.deltaY > 0 ? -1 : 1;
                const next = Math.min(maxIconSize, Math.max(minIconSize, iconSize + direction * step));
                if (next !== iconSize) {
                    onIconSizeChange(next);
                }
            }}
        >
            {activeGroup && !compactToolbar && (
                <div className="sticky top-0 z-10 flex items-center justify-between px-4 py-2 bg-surface border-b border-edge">
                    <button
                        onClick={handleBack}
                        className="p-1 rounded hover:bg-fill"
                        title={t("assets.backToParent")}
                    >
                        <ChevronLeft className="w-4 h-4" />
                    </button>
                    <div className="text-sm font-semibold truncate px-2">{activeGroup.group.name}</div>
                    <div className="w-6 h-6" />
                </div>
            )}
            <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
                {displayTypes.map((type) => {
                    const TypeIcon = ASSET_TYPE_ICONS[type];
                    const typeGroups = filteredGroups[type].filter((group) => parentPredicate(group.parentGroupId));
                    const typeAssets = filteredAssets[type].filter((asset) => parentPredicate(asset.groupId));
                    const hasItems = typeGroups.length > 0 || typeAssets.length > 0;

                    return (
                        <section
                            key={type}
                            className={`border rounded-lg p-3 bg-fill-subtle ${dropTargetId === "root:" + type ? "border-primary" : "border-transparent"}`}
                            onDrop={(e) => handleRootDrop(e, type, activeGroup?.group ?? undefined)}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItem?.type === type || e.dataTransfer.types.includes("Files")) {
                                    setDropTargetId("root:" + type);
                                }
                            }}
                            onDragLeave={(e) => {
                                e.stopPropagation();
                                setDropTargetId((prev) => (prev === "root:" + type ? null : prev));
                            }}
                        >
                            <header className="flex items-center justify-between gap-3">
                                <div className="flex items-center gap-2">
                                    <TypeIcon className="w-5 h-5 text-fg" />
                                    <div>
                                        <p className="text-sm font-medium">{t(`assets.types.${type}`)}</p>
                                        <p className="text-xs text-fg-subtle">{tn("assets.iconView.assetCount", typeAssets.length)}</p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    {actionLoading ? (
                                        <span className="text-xs text-fg-muted">{t("assets.iconView.updating")}</span>
                                    ) : (
                                        <>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleImport(type);
                                                }}
                                                className="p-1 rounded hover:bg-fill"
                                                title={t("common.import")}
                                            >
                                                <Upload className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleImportRemote(type);
                                                }}
                                                className="p-1 rounded hover:bg-fill"
                                                title={t("assets.importRemote")}
                                            >
                                                <Link className="w-4 h-4" />
                                            </button>
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleCreateGroup(type);
                                                }}
                                                className="p-1 rounded hover:bg-fill"
                                                title={t("assets.menu.newGroup")}
                                            >
                                                <FolderPlus className="w-4 h-4" />
                                            </button>
                                        </>
                                    )}
                                </div>
                            </header>

                            {hasItems ? (
                                <div
                                    className="mt-3 grid gap-3"
                                    style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${iconSize}px, 1fr))` }}
                                >
                                    {typeGroups.map((group) => {
                                        const childGroups = filteredGroups[type].filter((g) => g.parentGroupId === group.id);
                                        const childAssets = filteredAssets[type].filter((a) => a.groupId === group.id);
                                        const childCount = childGroups.length + childAssets.length;

                                        return (
                                            <GroupIconTile
                                                key={group.id}
                                                group={group}
                                                type={type}
                                                childCount={childCount}
                                                onNavigate={() => {
                                                    handleGroupFocus(group.id);
                                                    handleEnterGroup(group, type);
                                                }}
                                            />
                                        );
                                    })}
                                    {typeAssets.map((asset) => (
                                        <AssetIconTile
                                            key={asset.id}
                                            asset={asset}
                                            type={type}
                                            thumbnailUrl={thumbnailMap[asset.id]}
                                            requestThumbnail={requestThumbnail}
                                        />
                                    ))}
                                </div>
                            ) : (
                                <div className="mt-4 text-center text-xs text-fg-subtle">
                                    {t("assets.emptyType", { label: t(`assets.types.${type}`).toLowerCase() })}
                                </div>
                            )}
                        </section>
                    );
                })}
            </div>
        </div>
    );
}

function GroupIconTile({
    group,
    type,
    childCount,
    onNavigate,
}: {
    group: AssetGroup;
    type: AssetType;
    childCount: number;
    onNavigate?: () => void;
}) {
    const { tn } = useTranslation();
    const {
        selectedItems,
        clipboard,
        showContextMenu,
        handleItemSelect,
        handleGroupFocus,
        handleDropOnItem,
        handleImportToGroup,
        handleDragStart,
        handleDragEnd,
        draggedItem,
    } = useAssetsPanelContext();
    const [isDragOverLocal, setDragOverLocal] = useState(false);
    const isSelected = selectedItems.has("group:" + group.id);
    const isDragging = !!draggedItem && draggedItem.isGroup && draggedItem.item.id === group.id;
    const isCut = clipboard?.type === "cut" && clipboard.groups.some((g) => g.id === group.id);

    return (
        <div
            draggable
            className={`nl-asset-drag-source border rounded-lg p-3 bg-fill-subtle flex flex-col gap-2 cursor-pointer hover:border-edge-strong ${
                isSelected ? "border-primary/80 bg-primary/10" : "border-transparent"
            } ${isDragging ? "opacity-50" : ""} ${isCut ? "opacity-40" : ""} ${isDragOverLocal ? "ring-1 ring-primary/50 bg-primary/10" : ""}`}
            onClick={(e) => {
                const isMultiSelectIntent = e.ctrlKey || e.metaKey || e.shiftKey;
                handleItemSelect(group.id, true, e);
                handleGroupFocus(group.id);
                if (!isMultiSelectIntent) {
                    onNavigate?.();
                }
            }}
            onContextMenu={(e) => showContextMenu(e, type, group, true)}
            onDragStart={(e) => handleDragStart?.(e, type, group, true)}
            onDragEnd={() => handleDragEnd?.()}
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const files = e.dataTransfer.types.includes("Files");
                const internal = draggedItem && draggedItem.type === type;
                if (!internal && !files) {
                    return;
                }
                setDragOverLocal(true);
                e.dataTransfer.dropEffect = internal ? "move" : "copy";
            }}
            onDragLeave={(e) => {
                e.stopPropagation();
                setDragOverLocal(false);
            }}
            onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverLocal(false);
                if (draggedItem && handleDropOnItem) {
                    handleDropOnItem(e, type, group);
                } else {
                    handleImportToGroup(type, group.id, e.dataTransfer.files, e.dataTransfer);
                }
            }}
        >
            <div className="flex items-center gap-2 text-sm font-medium">
                <FolderPlus className="w-4 h-4 text-primary" />
                <span className="truncate">{group.name}</span>
            </div>
            <span className="text-xs text-fg-subtle">{tn("assets.itemCount", childCount)}</span>
        </div>
    );
}

function AssetIconTile({
    asset,
    type,
    thumbnailUrl,
    requestThumbnail,
}: { asset: Asset; type: AssetType; thumbnailUrl?: string; requestThumbnail: (asset: Asset) => Promise<string | undefined> }) {
    const { t, tn } = useTranslation();
    const {
        selectedItems,
        handleItemSelect,
        handleAssetClick,
        isMultiSelectMode,
        showContextMenu,
        handleDragStart,
        handleDragEnd,
        clipboard,
        draggedItem,
    } = useAssetsPanelContext();
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const isSelected = selectedItems.has("asset:" + asset.id);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;

    useEffect(() => {
        if (!thumbnailUrl) {
            void requestThumbnail(asset);
        }
    }, [thumbnailUrl, requestThumbnail, asset.id]);

    return (
        <div
            draggable
            className={`nl-asset-drag-source border rounded-lg p-3 bg-fill-subtle flex items-start gap-3 cursor-pointer hover:border-edge-strong ${
                isSelected ? "border-primary/80 bg-primary/10" : "border-transparent"
            } ${isDragging ? "opacity-50" : ""} ${
                clipboard?.type === "cut" && clipboard.assets.some((a) => a.id === asset.id) ? "opacity-40" : ""
            }`}
            onClick={(e) => {
                const isMultiSelectIntent = e.ctrlKey || e.metaKey || e.shiftKey;
                handleItemSelect(asset.id, false, e);
                handleAssetClick(asset, isMultiSelectIntent || isMultiSelectMode);
            }}
            onContextMenu={(e) => showContextMenu(e, type, asset, false)}
            onDragStart={(e) => handleDragStart?.(e, type, asset, false)}
            onDragEnd={() => handleDragEnd?.()}
        >
            <div className="w-16 h-16 shrink-0 rounded-lg bg-surface-sunken overflow-hidden flex items-center justify-center">
                {thumbnailUrl ? (
                    <img src={thumbnailUrl} alt={asset.name} draggable={false} className="w-full h-full object-cover" />
                ) : (
                    <Icon className="w-5 h-5 text-fg-muted" />
                )}
            </div>
            <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{asset.name}</p>
                <p className="text-xs text-fg-subtle">{asset.tags.length > 0 ? tn("assets.iconView.tagCount", asset.tags.length) : t("assets.noTags")}</p>
            </div>
            {clipboard?.type === "cut" && clipboard.assets.some((a) => a.id === asset.id) && (
                <span className="text-xs text-fg-muted">{t("common.cut")}</span>
            )}
        </div>
    );
}
