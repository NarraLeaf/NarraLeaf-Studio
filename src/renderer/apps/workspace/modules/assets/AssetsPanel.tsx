import { useMemo, useCallback, useState } from "react";
import {
    Image, Music, Video, FileJson, Type, File,
    FolderPlus, Upload, RefreshCw, AlertCircle
} from "lucide-react";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { PanelComponentProps } from "../types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { ContextMenu } from "@/lib/components/elements/ContextMenu";
import { useAssetsContextMenu } from "./hooks/useAssetsContextMenu";
import React from "react";
import { createInputDialog } from "@/lib/components/dialogs";
import { useAssetsPanelState } from "./hooks/useAssetsPanelState";

// Asset type icons mapping
const ASSET_TYPE_ICONS = {
    [AssetType.Image]: Image,
    [AssetType.Audio]: Music,
    [AssetType.Video]: Video,
    [AssetType.JSON]: FileJson,
    [AssetType.Font]: Type,
    [AssetType.Other]: File,
};

// Asset type labels
const ASSET_TYPE_LABELS = {
    [AssetType.Image]: "Images",
    [AssetType.Audio]: "Audio",
    [AssetType.Video]: "Videos",
    [AssetType.JSON]: "JSON Files",
    [AssetType.Font]: "Fonts",
    [AssetType.Other]: "Other",
};

/**
 * Assets panel component
 * Displays assets organized by type and groups using accordion layout
 */
export function AssetsPanel({ panelId, payload }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const inputDialog = useMemo(() => {
        if (!context) return null;
        const uiService = context.services.get<UIService>(Services.UI);
        return createInputDialog(uiService);
    }, [context]);

    const {
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
        setContextMenuTarget,
        setDragOver,
        setDropTargetId,
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
    } = useAssetsPanelState({
        context,
        isInitialized,
        panelId,
        inputDialog,
    });

    const {
        menuState,
        contextMenu,
        showContextMenu,
        closeContextMenu,
    } = useAssetsContextMenu({
        clipboard,
        contextMenuTarget,
        setContextMenuTarget,
        handleCopy,
        handleCut,
        handlePaste,
        handleRename,
        handleDelete,
        handleCreateGroup,
        handleImportToGroup,
    });

    const handlePanelDragOver = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(true);
    }, [setDragOver]);

    const handlePanelDragLeave = useCallback((event: React.DragEvent) => {
        event.preventDefault();
        event.stopPropagation();
        setDragOver(false);
        setDropTargetId(null);
    }, [setDragOver, setDropTargetId]);

    const handleRootDrop = useCallback(async (event: React.DragEvent, type: AssetType) => {
        await handleDrop(event, type);
        await handleDropOnItem(event, type, null);
    }, [handleDrop, handleDropOnItem]);

    // Loading state
    if (loading && Object.values(assets).every(arr => arr.length === 0)) {
        return (
            <div className="p-4">
                <div className="flex items-center gap-2 text-gray-400">
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span className="text-sm">Loading assets...</span>
                </div>
            </div>
        );
    }

    // Error state
    if (error) {
        return (
            <div className="p-4">
                <div className="flex items-start gap-2 text-red-400 bg-red-500/10 rounded-md p-3">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div className="flex-1">
                        <p className="text-sm font-medium">Failed to load assets</p>
                        <p className="text-xs mt-1 text-red-300">{error}</p>
                        <button
                            onClick={loadAssets}
                            className="mt-2 text-xs text-red-300 hover:text-red-200 underline cursor-default"
                        >
                            Try again
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    const isFocused = (id: string) => focusedItemId === id;

    return (
        <div
            className={`h-full flex flex-col ${dragOver ? 'bg-primary/10' : ''}`}
            onDragOver={handlePanelDragOver}
            onDragLeave={handlePanelDragLeave}
        >
            {/* Toolbar */}
            <div className="flex items-center justify-between px-3 py-2 border-b border-white/10">
                <span className="text-xs text-gray-400">
                    {Object.values(assets).reduce((sum, arr) => sum + arr.length, 0)} items
                </span>
                <button
                    onClick={loadAssets}
                    disabled={loading}
                    className="p-1 rounded hover:bg-white/10 text-gray-400 hover:text-white transition-colors cursor-default disabled:opacity-50"
                    title="Refresh"
                >
                    <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                </button>
            </div>

            {/* Asset List */}
            <div className="flex-1 overflow-y-auto">
                <Accordion
                    defaultOpen={[AssetType.Image]}
                    multiple={true}
                    isActive={false}
                >
                    {Object.values(AssetType).map((type) => {
                        const TypeIcon = ASSET_TYPE_ICONS[type];
                        const typeAssets = assets[type];
                        const typeGroups = groups[type];

                        return (
                            <AccordionItem
                                key={type}
                                id={type}
                                title={`${ASSET_TYPE_LABELS[type]} (${typeAssets.length})`}
                                icon={<TypeIcon className="w-4 h-4" />}
                                contentClassName="bg-[#0b0d12]"
                                focusable={false}
                            >
                                <div
                                    onDrop={(e) => handleRootDrop(e, type)}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        if (draggedItem && draggedItem.type === type) {
                                            setDropTargetId(`root:${type}`);
                                        }
                                    }}
                                    onContextMenu={(e) => showContextMenu(e, type, null, false)}
                                >
                                    {/* Actions */}
                                    <div className="flex gap-1 p-2 border-b border-white/10">
                                        <button
                                            onClick={() => handleImport(type)}
                                            className="flex-1 flex items-center justify-center gap-1 px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded transition-colors cursor-default"
                                            title="Import"
                                        >
                                            <Upload className="w-3 h-3" />
                                            Import
                                        </button>
                                        <button
                                            onClick={() => handleCreateGroup(type)}
                                            className="flex items-center justify-center gap-1 px-2 py-1 text-xs bg-white/5 hover:bg-white/10 rounded transition-colors cursor-default"
                                            title="New Group"
                                        >
                                            <FolderPlus className="w-3 h-3" />
                                        </button>
                                    </div>

                                    {/* Groups and Assets */}
                                    {typeAssets.length === 0 && typeGroups.length === 0 ? (
                                        <div className="p-4 text-center text-gray-500 text-xs">
                                            No {ASSET_TYPE_LABELS[type].toLowerCase()} yet
                                        </div>
                                    ) : (
                                        <div className="py-1">
                                            {/* Root groups */}
                                            {typeGroups
                                                .filter(g => !g.parentGroupId)
                                                .map(group => (
                                                    <GroupItem
                                                        key={group.id}
                                                        group={group}
                                                        type={type}
                                                        assets={typeAssets}
                                                        groups={typeGroups}
                                                        level={0}
                                                        onAssetClick={handleAssetClick}
                                                        onContextMenu={showContextMenu}
                                                        onGroupFocus={handleGroupFocus}
                                                        isFocused={isFocused}
                                                        onDragStart={handleDragStart}
                                                        onDragEnd={handleDragEnd}
                                                        onDragOver={handleDragOverItem}
                                                        onDrop={handleDropOnItem}
                                                        draggedItemId={draggedItem?.isGroup ? (draggedItem.item as AssetGroup).id : draggedItem ? (draggedItem.item as Asset).hash : null}
                                                        dropTargetId={dropTargetId}
                                                    />
                                                ))}

                                            {/* Root assets (no group) */}
                                            {typeAssets
                                                .filter(a => !a.groupId)
                                                .map(asset => (
                                                    <AssetItem
                                                        key={asset.hash}
                                                        asset={asset}
                                                        type={type}
                                                        level={0}
                                                        onClick={() => handleAssetClick(asset)}
                                                        onContextMenu={(e) => showContextMenu(e, type, asset, false)}
                                                        isFocused={isFocused(`asset:${asset.hash}`)}
                                                        onDragStart={handleDragStart}
                                                        onDragEnd={handleDragEnd}
                                                        isDragging={draggedItem?.item === asset}
                                                    />
                                                ))}
                                        </div>
                                    )}
                                </div>
                            </AccordionItem>
                        );
                    })}
                </Accordion>
            </div>

            {/* Context Menu */}
            <ContextMenu
                items={contextMenu}
                position={menuState.position}
                visible={menuState.visible}
                onClose={closeContextMenu}
            />
        </div>
    );
}

// Group item component (recursive)
interface GroupItemProps {
    group: AssetGroup;
    type: AssetType;
    assets: Asset[];
    groups: AssetGroup[];
    level: number;
    onAssetClick: (asset: Asset) => void;
    onContextMenu: (e: React.MouseEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => void;
    onGroupFocus: (groupId: string) => void;
    isFocused: (id: string) => boolean;
    onDragStart: (e: React.DragEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => void;
    onDragEnd: () => void;
    onDragOver: (e: React.DragEvent, targetId: string) => void;
    onDrop: (e: React.DragEvent, targetType: AssetType, targetGroup: AssetGroup | null) => void;
    draggedItemId: string | null;
    dropTargetId: string | null;
}

function GroupItem({
    group,
    type,
    assets,
    groups,
    level,
    onAssetClick,
    onContextMenu,
    onGroupFocus,
    isFocused,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
    draggedItemId,
    dropTargetId,
}: GroupItemProps) {
    const [isOpen, setIsOpen] = useState(false);
    const childGroups = groups.filter(g => g.parentGroupId === group.id);
    const groupAssets = assets.filter(a => a.groupId === group.id);
    const isDragging = draggedItemId === group.id;
    const isDropTarget = dropTargetId === `group:${group.id}`;

    return (
        <div>
            <div
                draggable={true}
                className={`
                    flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-gray-600/30 transition-colors
                    ${isFocused(`group:${group.id}`) ? 'border-l-2 border-primary bg-gray-600/10' : ''}
                    ${isDragging ? 'opacity-50' : ''}
                    ${isDropTarget ? 'bg-primary/20 border-l-2 border-primary' : ''}
                `}
                style={{ paddingLeft: `${20 + level * 12}px` }}
                onClick={() => {
                    onGroupFocus(group.id);
                    setIsOpen(!isOpen);
                }}
                onContextMenu={(e) => onContextMenu(e, type, group, true)}
                onDragStart={(e) => onDragStart(e, type, group, true)}
                onDragEnd={onDragEnd}
                onDragOver={(e) => onDragOver(e, `group:${group.id}`)}
                onDrop={(e) => onDrop(e, type, group)}
            >
                <FolderPlus className="w-4 h-4 text-primary" />
                <span className="text-sm text-gray-300">{group.name}</span>
                <span className="text-xs text-gray-500">({groupAssets.length + childGroups.length})</span>
            </div>

            {isOpen && (
                <div>
                    {/* Child groups */}
                    {childGroups.map(childGroup => (
                        <GroupItem
                            key={childGroup.id}
                            group={childGroup}
                            type={type}
                            assets={assets}
                            groups={groups}
                            level={level + 1}
                            onAssetClick={onAssetClick}
                            onContextMenu={onContextMenu}
                            onGroupFocus={onGroupFocus}
                            isFocused={isFocused}
                            onDragStart={onDragStart}
                            onDragEnd={onDragEnd}
                            onDragOver={onDragOver}
                            onDrop={onDrop}
                            draggedItemId={draggedItemId}
                            dropTargetId={dropTargetId}
                        />
                    ))}

                    {/* Group assets */}
                    {groupAssets.map(asset => (
                        <AssetItem
                            key={asset.hash}
                            asset={asset}
                            type={type}
                            level={level + 1}
                            onClick={() => onAssetClick(asset)}
                            onContextMenu={(e) => onContextMenu(e, type, asset, false)}
                            isFocused={isFocused(`asset:${asset.hash}`)}
                            onDragStart={onDragStart}
                            onDragEnd={onDragEnd}
                            isDragging={draggedItemId === asset.hash}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

// Asset item component
interface AssetItemProps {
    asset: Asset;
    type: AssetType;
    level: number;
    onClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    isFocused: boolean;
    onDragStart: (e: React.DragEvent, type: AssetType, item: Asset | AssetGroup, isGroup: boolean) => void;
    onDragEnd: () => void;
    isDragging: boolean;
}

function AssetItem({ asset, type, level, onClick, onContextMenu, isFocused, onDragStart, onDragEnd, isDragging }: AssetItemProps) {
    const Icon = ASSET_TYPE_ICONS[asset.type];

    return (
        <div
            draggable={true}
            className={`
                flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-gray-600/30 transition-colors
                ${isFocused ? 'border-l-2 border-primary bg-gray-600/10' : ''}
                ${isDragging ? 'opacity-50' : ''}
            `}
            style={{ paddingLeft: `${20 + level * 12}px` }}
            onClick={onClick}
            onContextMenu={onContextMenu}
            onDragStart={(e) => onDragStart(e, type, asset, false)}
            onDragEnd={onDragEnd}
        >
            <Icon className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-300 flex-1 truncate">{asset.name}</span>
            {asset.tags.length > 0 && (
                <span className="text-xs text-gray-500">+{asset.tags.length}</span>
            )}
        </div>
    );
}
