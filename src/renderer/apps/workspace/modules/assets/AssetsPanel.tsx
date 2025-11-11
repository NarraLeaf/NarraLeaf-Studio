import { useEffect, useState, useCallback } from "react";
import { 
    Image, Music, Video, FileJson, Type, File, 
    Plus, FolderPlus, Upload, RefreshCw, AlertCircle 
} from "lucide-react";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { PanelComponentProps } from "../types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup } from "@/lib/workspace/services/assets/types";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { ContextMenu, useContextMenu, ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { FocusArea } from "@/lib/workspace/services/ui/types";

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
    const [assets, setAssets] = useState<Record<AssetType, Asset[]>>({
        [AssetType.Image]: [],
        [AssetType.Audio]: [],
        [AssetType.Video]: [],
        [AssetType.JSON]: [],
        [AssetType.Font]: [],
        [AssetType.Other]: [],
    });
    const [groups, setGroups] = useState<Record<AssetType, AssetGroup[]>>({
        [AssetType.Image]: [],
        [AssetType.Audio]: [],
        [AssetType.Video]: [],
        [AssetType.JSON]: [],
        [AssetType.Font]: [],
        [AssetType.Other]: [],
    });
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
    
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [contextMenuTarget, setContextMenuTarget] = useState<{
        type: AssetType;
        item: Asset | AssetGroup | null;
        isGroup: boolean;
    } | null>(null);

    // Clipboard state
    const [clipboard, setClipboard] = useState<{
        type: 'copy' | 'cut';
        asset: Asset | null;
    } | null>(null);

    // Load assets from service
    const loadAssets = useCallback(async () => {
        if (!context) return;

        setLoading(true);
        setError(null);

        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            const assetsMap = assetsService.getAssets();

            // Load assets for each type
            const newAssets: Record<AssetType, Asset[]> = {
                [AssetType.Image]: [],
                [AssetType.Audio]: [],
                [AssetType.Video]: [],
                [AssetType.JSON]: [],
                [AssetType.Font]: [],
                [AssetType.Other]: [],
            };

            const newGroups: Record<AssetType, AssetGroup[]> = {
                [AssetType.Image]: [],
                [AssetType.Audio]: [],
                [AssetType.Video]: [],
                [AssetType.JSON]: [],
                [AssetType.Font]: [],
                [AssetType.Other]: [],
            };

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

    // Set focus when panel is active
    useEffect(() => {
        if (!context || !isInitialized) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const unsubscribe = uiService.focus.onFocusChange((focusContext) => {
            if (focusContext.area === FocusArea.LeftPanel && focusContext.targetId === panelId) {
                // Panel is focused
            }
        });

        return unsubscribe;
    }, [context, isInitialized, panelId]);

    // Handle drag and drop
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);
    };

    const handleDrop = async (e: React.DragEvent, type: AssetType) => {
        e.preventDefault();
        e.stopPropagation();
        setDragOver(false);

        if (!context) return;

        const files = Array.from(e.dataTransfer.files);
        if (files.length === 0) return;

        const paths = files.map(f => (f as any).path).filter(Boolean);
        if (paths.length === 0) return;

        setLoading(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            await assetsService.importFromPaths(type, paths);
            await loadAssets();
        } catch (err) {
            console.error("Failed to import assets:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    // Handle asset click
    const handleAssetClick = (asset: Asset) => {
        if (!context) return;

        const uiService = context.services.get<UIService>(Services.UI);
        
        // Set focus
        uiService.focus.setFocus(FocusArea.LeftPanel, `asset:${asset.hash}`);
        setFocusedItemId(`asset:${asset.hash}`);

        // Open editor based on asset type
        if (asset.type === AssetType.Image) {
            uiService.editor.open({
                id: `image-preview:${asset.hash}`,
                type: "narraleaf-studio:image-preview",
                title: asset.name,
                payload: { asset },
            });
        }

        // Show properties panel
        uiService.panels.setPanelVisible("narraleaf-studio:properties", true);
    };

    // Handle context menu
    const handleContextMenu = (e: React.MouseEvent, type: AssetType, item: Asset | AssetGroup | null, isGroup: boolean) => {
        e.preventDefault();
        setContextMenuTarget({ type, item, isGroup });
        showMenu(e);
    };

    // Context menu actions
    const handleCopy = () => {
        if (contextMenuTarget && contextMenuTarget.item && !contextMenuTarget.isGroup) {
            setClipboard({
                type: 'copy',
                asset: contextMenuTarget.item as Asset,
            });
        }
        hideMenu();
    };

    const handleCut = () => {
        if (contextMenuTarget && contextMenuTarget.item && !contextMenuTarget.isGroup) {
            setClipboard({
                type: 'cut',
                asset: contextMenuTarget.item as Asset,
            });
        }
        hideMenu();
    };

    const handlePaste = async () => {
        if (!context || !clipboard || !contextMenuTarget) return;

        const assetsService = context.services.get<AssetsService>(Services.Assets);
        const targetGroupId = contextMenuTarget.isGroup && contextMenuTarget.item 
            ? (contextMenuTarget.item as AssetGroup).id 
            : undefined;

        if (clipboard.type === 'cut') {
            // Move asset
            await assetsService.moveAssetToGroup(clipboard.asset!, targetGroupId);
            setClipboard(null);
        }

        await loadAssets();
        hideMenu();
    };

    const handleRename = async () => {
        if (!context || !contextMenuTarget || !contextMenuTarget.item) return;

        const uiService = context.services.get<UIService>(Services.UI);
        const assetsService = context.services.get<AssetsService>(Services.Assets);

        // Show prompt dialog
        const newName = prompt(
            contextMenuTarget.isGroup ? "Enter new group name:" : "Enter new asset name:",
            contextMenuTarget.isGroup 
                ? (contextMenuTarget.item as AssetGroup).name 
                : (contextMenuTarget.item as Asset).name
        );

        if (!newName) {
            hideMenu();
            return;
        }

        if (contextMenuTarget.isGroup) {
            await assetsService.renameGroup(
                contextMenuTarget.type,
                (contextMenuTarget.item as AssetGroup).id,
                newName
            );
        } else {
            await assetsService.renameAsset(contextMenuTarget.item as Asset, newName);
        }

        await loadAssets();
        hideMenu();
    };

    const handleDelete = async () => {
        if (!context || !contextMenuTarget || !contextMenuTarget.item) return;

        const confirmed = confirm(
            contextMenuTarget.isGroup
                ? "Are you sure you want to delete this group? Assets will be moved to root."
                : "Are you sure you want to delete this asset? This cannot be undone."
        );

        if (!confirmed) {
            hideMenu();
            return;
        }

        const assetsService = context.services.get<AssetsService>(Services.Assets);

        if (contextMenuTarget.isGroup) {
            await assetsService.deleteGroup(
                contextMenuTarget.type,
                (contextMenuTarget.item as AssetGroup).id,
                false
            );
        } else {
            await assetsService.deleteAsset(contextMenuTarget.item as Asset);
        }

        await loadAssets();
        hideMenu();
    };

    const handleCreateGroup = async (type: AssetType, parentGroupId?: string) => {
        if (!context) return;

        const groupName = prompt("Enter group name:");
        if (!groupName) return;

        const assetsService = context.services.get<AssetsService>(Services.Assets);
        assetsService.createGroup(type, groupName, parentGroupId);
        
        await loadAssets();
    };

    const handleImport = async (type: AssetType) => {
        if (!context) return;

        setLoading(true);
        try {
            const assetsService = context.services.get<AssetsService>(Services.Assets);
            await assetsService.importLocalAssets(type);
            await loadAssets();
        } catch (err) {
            console.error("Failed to import assets:", err);
            setError(err instanceof Error ? err.message : String(err));
        } finally {
            setLoading(false);
        }
    };

    // Build context menu
    const contextMenu: ContextMenuDef = contextMenuTarget
        ? [
            ...(contextMenuTarget.item && !contextMenuTarget.isGroup
                ? [
                    { id: 'copy', label: 'Copy', onClick: handleCopy },
                    { id: 'cut', label: 'Cut', onClick: handleCut },
                ]
                : []
            ),
            ...(clipboard && contextMenuTarget.isGroup
                ? [{ id: 'paste', label: 'Paste', onClick: handlePaste }]
                : []
            ),
            ...(contextMenuTarget.item
                ? [
                    { separator: true, id: 'sep1' },
                    { id: 'rename', label: 'Rename', onClick: handleRename },
                    { id: 'delete', label: 'Delete', onClick: handleDelete },
                ]
                : []
            ),
            ...(contextMenuTarget.isGroup || !contextMenuTarget.item
                ? [
                    { separator: true, id: 'sep2' },
                    {
                        id: 'new-group',
                        label: 'New Group',
                        onClick: () => {
                            handleCreateGroup(
                                contextMenuTarget.type,
                                contextMenuTarget.item ? (contextMenuTarget.item as AssetGroup).id : undefined
                            );
                            hideMenu();
                        },
                    },
                ]
                : []
            ),
        ]
        : [];

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
            className={`h-full flex flex-col ${dragOver ? 'bg-blue-500/10' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
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
                    isActive={true}
                    onItemFocus={setFocusedItemId}
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
                            >
                                <div
                                    onDrop={(e) => handleDrop(e, type)}
                                    onContextMenu={(e) => handleContextMenu(e, type, null, false)}
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
                                                        onContextMenu={handleContextMenu}
                                                        isFocused={isFocused}
                                                    />
                                                ))}

                                            {/* Root assets (no group) */}
                                            {typeAssets
                                                .filter(a => !a.groupId)
                                                .map(asset => (
                                                    <AssetItem
                                                        key={asset.hash}
                                                        asset={asset}
                                                        level={0}
                                                        onClick={() => handleAssetClick(asset)}
                                                        onContextMenu={(e) => handleContextMenu(e, type, asset, false)}
                                                        isFocused={isFocused(`asset:${asset.hash}`)}
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
                onClose={hideMenu}
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
    isFocused: (id: string) => boolean;
}

function GroupItem({
    group,
    type,
    assets,
    groups,
    level,
    onAssetClick,
    onContextMenu,
    isFocused,
}: GroupItemProps) {
    const [isOpen, setIsOpen] = useState(false);
    const childGroups = groups.filter(g => g.parentGroupId === group.id);
    const groupAssets = assets.filter(a => a.groupId === group.id);

    return (
        <div>
            <div
                className={`
                    flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-white/10 transition-colors
                    ${isFocused(`group:${group.id}`) ? 'bg-blue-500/20' : ''}
                `}
                style={{ paddingLeft: `${12 + level * 12}px` }}
                onClick={() => setIsOpen(!isOpen)}
                onContextMenu={(e) => onContextMenu(e, type, group, true)}
            >
                <FolderPlus className="w-4 h-4 text-blue-400" />
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
                            isFocused={isFocused}
                        />
                    ))}

                    {/* Group assets */}
                    {groupAssets.map(asset => (
                        <AssetItem
                            key={asset.hash}
                            asset={asset}
                            level={level + 1}
                            onClick={() => onAssetClick(asset)}
                            onContextMenu={(e) => onContextMenu(e, type, asset, false)}
                            isFocused={isFocused(`asset:${asset.hash}`)}
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
    level: number;
    onClick: () => void;
    onContextMenu: (e: React.MouseEvent) => void;
    isFocused: boolean;
}

function AssetItem({ asset, level, onClick, onContextMenu, isFocused }: AssetItemProps) {
    const Icon = ASSET_TYPE_ICONS[asset.type];

    return (
        <div
            className={`
                flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-white/10 transition-colors
                ${isFocused ? 'bg-blue-500/20' : ''}
            `}
            style={{ paddingLeft: `${12 + level * 12}px` }}
            onClick={onClick}
            onContextMenu={onContextMenu}
        >
            <Icon className="w-4 h-4 text-gray-400" />
            <span className="text-sm text-gray-300 flex-1 truncate">{asset.name}</span>
            {asset.tags.length > 0 && (
                <span className="text-xs text-gray-500">+{asset.tags.length}</span>
            )}
        </div>
    );
}
