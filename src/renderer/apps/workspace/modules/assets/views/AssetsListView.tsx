import { useMemo, useCallback, useState, Dispatch, SetStateAction, DragEvent } from "react";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Upload, Link, FolderPlus, RefreshCw } from "lucide-react";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { ASSET_TYPE_ICONS, ASSET_TYPE_LABELS } from "../constants";

interface AssetsListViewProps {
    dropTargetId: string | null;
    handleRootDrop: (event: DragEvent, type: AssetType) => Promise<void>;
    handleImport: (type: AssetType) => void;
    handleImportRemote: (type: AssetType) => void;
    handleCreateGroup: (type: AssetType) => void;
    actionLoading: boolean;
    setDropTargetId: Dispatch<SetStateAction<string | null>>;
}

export function AssetsListView({
    dropTargetId,
    handleRootDrop,
    handleImport,
    handleImportRemote,
    handleCreateGroup,
    actionLoading,
    setDropTargetId,
}: AssetsListViewProps) {
    const { filteredAssets, filteredGroups, draggedItem } = useAssetsPanelContext();

    const hasAnyItems = useMemo(() => Object.values(filteredAssets).some(list => list.length > 0) || Object.values(filteredGroups).some(list => list.length > 0), [filteredAssets, filteredGroups]);

    return (
        <Accordion defaultOpen={[AssetType.Image]} multiple>
            {Object.values(AssetType).map((type) => {
                const TypeIcon = ASSET_TYPE_ICONS[type];
                const typeAssets = filteredAssets[type];
                const typeGroups = filteredGroups[type];

                return (
                    <AccordionItem
                        key={type}
                        id={type}
                        icon={<TypeIcon className="w-4 h-4" />}
                        title={`${ASSET_TYPE_LABELS[type]} (${typeAssets.length})`}
                        actions={
                            actionLoading ? (
                                <RefreshCw className="w-3 h-3 animate-spin text-white" />
                            ) : (
                                <>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleImport(type);
                                        }}
                                        className="p-1 hover:text-primary"
                                        title="Import"
                                    >
                                        <Upload className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleImportRemote(type);
                                        }}
                                        className="p-1 hover:text-primary"
                                        title="Import Remote"
                                    >
                                        <Link className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCreateGroup(type);
                                        }}
                                        className="p-1 hover:text-primary"
                                        title="New Group"
                                    >
                                        <FolderPlus className="w-3 h-3" />
                                    </button>
                                </>
                            )
                        }
                    >
                        <div
                            className={`${dropTargetId === `root:${type}` ? 'bg-primary/10' : ''}`}
                            onDrop={(e) => handleRootDrop(e, type)}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItem?.type === type || e.dataTransfer.types.includes('Files')) {
                                    setDropTargetId(`root:${type}`);
                                }
                            }}
                            onDragLeave={(e) => {
                                e.stopPropagation();
                                setDropTargetId((prev) => (prev === `root:${type}` ? null : prev));
                            }}
                            onContextMenu={(e) => e.preventDefault()}
                        >
                            {typeAssets.length === 0 && typeGroups.length === 0 ? (
                                <div className="p-4 text-center text-xs text-gray-500">No {ASSET_TYPE_LABELS[type].toLowerCase()} yet</div>
                            ) : (
                                <div className="py-1">
                                    {typeGroups.filter(g => !g.parentGroupId).map(group => <GroupItem key={group.id} group={group} type={type} level={0} />)}
                                    {typeAssets.filter(a => !a.groupId).map(asset => <AssetItem key={asset.id} asset={asset} type={type} level={0} />)}
                                </div>
                            )}
                        </div>
                    </AccordionItem>
                );
            })}
            {!hasAnyItems && (
                <div className="px-3 py-4 text-center text-xs text-gray-500">No assets matched the current filters.</div>
            )}
        </Accordion>
    );
}

function GroupItem({ group, type, level }: { group: AssetGroup; type: AssetType; level: number }) {
    const {
        filteredGroups,
        filteredAssets,
        selectedItems,
        draggedItem,
        clipboard,
        expandedGroups,
        setExpandedGroups,
        handleItemSelect,
        handleGroupFocus,
        showContextMenu,
        handleDragStart,
        handleDragEnd,
        handleDropOnItem,
        handleImportToGroup,
        isFocused,
    } = useAssetsPanelContext();
    const [isDragOverLocal, setDragOverLocal] = useState(false);

    const isOpen = expandedGroups.has(group.id);
    const toggleOpen = useCallback(() => {
        setExpandedGroups((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(group.id)) {
                newSet.delete(group.id);
            } else {
                newSet.add(group.id);
            }
            return newSet;
        });
    }, [group.id, setExpandedGroups]);

    const childGroups = filteredGroups[type].filter(g => g.parentGroupId === group.id);
    const groupAssets = filteredAssets[type].filter(a => a.groupId === group.id);
    const isDragging = !!draggedItem && draggedItem.isGroup && draggedItem.item.id === group.id;
    const isSelected = selectedItems.has(`group:${group.id}`);
    const isCut = clipboard?.type === 'cut' && clipboard.groups.some(g => g.id === group.id);

    return (
        <div
            className={`${isDragOverLocal ? 'bg-primary/20' : ''}`}
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDragOverLocal(true);
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
            <div
                draggable
                className={`flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-gray-600/30 ${isSelected ? 'bg-primary/20 border-l-2 border-primary' : ''} ${isFocused(`group:${group.id}`) ? 'bg-gray-600/10' : ''} ${isDragging ? 'opacity-50' : ''} ${isCut ? 'opacity-40' : ''}`}
                style={{ paddingLeft: `${20 + level * 12}px` }}
                onClick={(e) => {
                    handleItemSelect(group.id, true, e);
                    handleGroupFocus(group.id);
                    toggleOpen();
                }}
                onContextMenu={(e) => showContextMenu(e, type, group, true)}
                onDragStart={(e) => handleDragStart?.(e, type, group, true)}
                onDragEnd={() => handleDragEnd?.()}
            >
                <FolderPlus className="w-4 h-4 text-primary" />
                <span className="text-sm">{group.name}</span>
                <span className="text-xs text-gray-500">({groupAssets.length + childGroups.length})</span>
            </div>

            {isOpen && (
                <div>
                    {childGroups.map(child => <GroupItem key={child.id} group={child} type={type} level={level + 1} />)}
                    {groupAssets.map(asset => <AssetItem key={asset.id} asset={asset} type={type} level={level + 1} />)}
                </div>
            )}
        </div>
    );
}

function AssetItem({ asset, type, level }: { asset: Asset; type: AssetType; level: number }) {
    const { selectedItems, clipboard, draggedItem, handleItemSelect, handleAssetClick, showContextMenu, handleDragStart, handleDragEnd, isFocused, isMultiSelectMode } = useAssetsPanelContext();
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const isSelected = selectedItems.has(`asset:${asset.id}`);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;

    return (
        <div
            draggable
            className={`flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-gray-600/30 ${isSelected ? 'bg-primary/20 border-l-2 border-primary' : ''} ${isFocused(`asset:${asset.id}`) ? 'bg-gray-600/10' : ''} ${clipboard?.type === 'cut' && clipboard.assets.some(a => a.id === asset.id) ? 'opacity-40' : ''} ${isDragging ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${20 + level * 12}px` }}
            onClick={(e) => {
                handleItemSelect(asset.id, false, e);
                handleAssetClick(asset, isMultiSelectMode);
            }}
            onContextMenu={(e) => showContextMenu(e, type, asset, false)}
            onDragStart={(e) => handleDragStart?.(e, type, asset, false)}
            onDragEnd={() => handleDragEnd?.()}
        >
            <Icon className="w-4 h-4 text-gray-400" />
            <span className="text-sm flex-1 truncate">{asset.name}</span>
            {asset.tags.length > 0 && <span className="text-xs text-gray-500">+{asset.tags.length}</span>}
        </div>
    );
}
