import { useMemo, useCallback, useState, Dispatch, SetStateAction, DragEvent } from "react";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { Upload, Link, FolderPlus, RefreshCw } from "lucide-react";
import { ASSET_CATEGORY_ORDER, AssetCategory } from "@/lib/workspace/services/assets/assetTypes";
import { Asset, AssetGroup, AssetSource } from "@/lib/workspace/services/assets/types";
import { useAssetsPanelContext } from "../AssetsPanelContext";
import { AssetSetListRow } from "../components/AssetSetRow";
import type { ResolvedAssetSet } from "../state/useAssetSets";
import { AssetSupportBadge } from "../components/AssetSupportBadge";
import { ASSET_CATEGORY_ICONS, ASSET_TYPE_ICONS } from "../constants";
import { useTranslation } from "@/lib/i18n";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";

interface AssetsListViewProps {
    dropTargetId: string | null;
    handleRootDrop: (event: DragEvent, category: AssetCategory, contextualGroup?: AssetGroup | null) => Promise<void>;
    handleImport: (category: AssetCategory) => void;
    handleImportRemote: (category: AssetCategory) => void;
    handleCreateGroup: (category: AssetCategory) => void;
    actionLoading: boolean;
    setDropTargetId: Dispatch<SetStateAction<string | null>>;
    openItems: string[];
    onOpenChange: (openItems: string[]) => void;
    disableAnimation: boolean;
}

export function AssetsListView({
    dropTargetId,
    handleRootDrop,
    handleImport,
    handleImportRemote,
    handleCreateGroup,
    actionLoading,
    setDropTargetId,
    openItems,
    onOpenChange,
    disableAnimation,
}: AssetsListViewProps) {
    const { t, tn } = useTranslation();
    const freeze = useFreezeGuard();
    const { filteredAssets, filteredGroups, assetSets, draggedItem, showContextMenu } = useAssetsPanelContext();

    const hasAnyItems = useMemo(() => Object.values(filteredAssets).some(list => list.length > 0) || Object.values(filteredGroups).some(list => list.length > 0), [filteredAssets, filteredGroups]);

    return (
        <Accordion openItems={openItems} onOpenChange={onOpenChange} multiple disableAnimation={disableAnimation}>
            {ASSET_CATEGORY_ORDER.map((category) => {
                const CategoryIcon = ASSET_CATEGORY_ICONS[category];
                const categoryAssets = filteredAssets[category];
                const categoryGroups = filteredGroups[category];
                const categorySets = assetSets[category];

                return (
                    <AccordionItem
                        key={category}
                        id={category}
                        icon={<CategoryIcon className="w-4 h-4" />}
                        headerProps={{
                            // The section's handle: verification and any future command that has to
                            // find a category on screen reads this rather than matching its label,
                            // which is translated.
                            "data-asset-category": category,
                            // The header had no menu at all. It is the section's own row, so it is
                            // where a command about the section as a whole belongs — today, Other's
                            // "New Text File". The body below still swallows contextmenu.
                            onContextMenu: (event) => showContextMenu(event, category, null, false),
                        }}
                        title={
                            <span className="flex items-center gap-1.5">
                                <span>{t(`assets.categories.${category}`)}</span>
                                <span className="text-xs text-fg-subtle">{tn("assets.itemCount", categoryAssets.length)}</span>
                            </span>
                        }
                        actions={
                            actionLoading ? (
                                <RefreshCw className="w-3 h-3 animate-spin text-fg" />
                            ) : (
                                <>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleImport(category);
                                        }}
                                        className="p-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                        {...freeze.writes(false, t("common.import"))}
                                    >
                                        <Upload className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleImportRemote(category);
                                        }}
                                        className="p-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                        {...freeze.writes(false, t("assets.importRemote"))}
                                    >
                                        <Link className="w-3 h-3" />
                                    </button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleCreateGroup(category);
                                        }}
                                        className="p-1 hover:text-primary disabled:cursor-not-allowed disabled:opacity-40"
                                        {...freeze.writes(false, t("assets.menu.newGroup"))}
                                    >
                                        <FolderPlus className="w-3 h-3" />
                                    </button>
                                </>
                            )
                        }
                    >
                        <div
                            className={`${dropTargetId === `root:${category}` ? 'bg-primary/10' : ''}`}
                            onDrop={(e) => handleRootDrop(e, category)}
                            onDragOver={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                if (draggedItem?.category === category || e.dataTransfer.types.includes('Files')) {
                                    setDropTargetId(`root:${category}`);
                                }
                            }}
                            onDragLeave={(e) => {
                                e.stopPropagation();
                                setDropTargetId((prev) => (prev === `root:${category}` ? null : prev));
                            }}
                            onContextMenu={(e) => e.preventDefault()}
                        >
                            {/* An empty category prints nothing. The accordion header's import buttons
                                are the way in; announcing the absence is not information. */}
                            {(categoryAssets.length > 0 || categoryGroups.length > 0 || categorySets.length > 0) && (
                                <div className="py-1">
                                    {/* Above the folders: a set is what a reference points at, and the
                                        files it resolves to are filed below in the ordinary way. */}
                                    {categorySets.map(entry => <AssetSetItem key={entry.set.id} entry={entry} />)}
                                    {categoryGroups.filter(g => !g.parentGroupId).map(group => <GroupItem key={group.id} group={group} category={category} level={0} />)}
                                    {categoryAssets.filter(a => !a.groupId).map(asset => <AssetItem key={asset.id} asset={asset} category={category} level={0} />)}
                                </div>
                            )}
                        </div>
                    </AccordionItem>
                );
            })}
            {!hasAnyItems && (
                <div className="px-3 py-4 text-center text-xs text-fg-subtle">{t("assets.list.emptyFiltered")}</div>
            )}
        </Accordion>
    );
}

function AssetSetItem({ entry }: { entry: ResolvedAssetSet }) {
    const {
        assets,
        assetSetNaming,
        expandedAssetSets,
        setExpandedAssetSets,
        handleAssetSetSelect,
        handleAssetClick,
        showAssetSetContextMenu,
        isMultiSelectMode,
    } = useAssetsPanelContext();

    // The whole library of that section, not the filtered list: a set's rows are its own, and one of
    // them turning into "no file" because a search is narrowing the panel would read as a hole in the
    // project.
    const assetsById = useMemo(
        () => new Map(assets[entry.category].map(asset => [asset.id, asset])),
        [assets, entry.category],
    );

    const toggle = useCallback(() => {
        setExpandedAssetSets(current => {
            const next = new Set(current);
            if (next.has(entry.set.id)) {
                next.delete(entry.set.id);
            } else {
                next.add(entry.set.id);
            }
            return next;
        });
    }, [entry.set.id, setExpandedAssetSets]);

    return (
        <AssetSetListRow
            entry={entry}
            level={0}
            // A set is not part of the library's multi-selection: nothing that acts on marked rows
            // (copy, export, delete bytes) means anything for a set, so it is never one of them.
            selected={false}
            focused={false}
            open={expandedAssetSets.has(entry.set.id)}
            naming={assetSetNaming}
            assetsById={assetsById}
            onSelect={() => handleAssetSetSelect(entry)}
            onToggle={toggle}
            onOpenMember={asset => handleAssetClick(asset, isMultiSelectMode)}
            onContextMenu={event => showAssetSetContextMenu(event, entry)}
        />
    );
}

function GroupItem({ group, category, level }: { group: AssetGroup; category: AssetCategory; level: number }) {
    const freeze = useFreezeGuard();
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
        isNarrowed,
    } = useAssetsPanelContext();
    const [isDragOverLocal, setDragOverLocal] = useState(false);

    // Groups default to collapsed, so a search that left them collapsed would return hits nobody can
    // see. While something is narrowing the library, every surviving group is open.
    const isOpen = isNarrowed || expandedGroups.has(group.id);
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

    const childGroups = filteredGroups[category].filter(g => g.parentGroupId === group.id);
    const groupAssets = filteredAssets[category].filter(a => a.groupId === group.id);
    const isDragging = !!draggedItem && draggedItem.isGroup && draggedItem.item.id === group.id;
    const isSelected = selectedItems.has(`group:${group.id}`);
    const isCut = clipboard?.type === 'cut' && clipboard.groups.some(g => g.id === group.id);

    return (
        <div
            className={`${isDragOverLocal ? 'bg-primary/20' : ''}`}
            onDragOver={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const files = e.dataTransfer.types.includes("Files");
                const internal = draggedItem && draggedItem.category === category;
                // A frozen library never lights up as a drop target: the move and the import are both
                // refused, and a folder that glows and then keeps its old contents reads as a bug.
                if (freeze.frozen || (!internal && !files)) {
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
                    handleDropOnItem(e, category, group);
                } else {
                    handleImportToGroup(category, group.id, e.dataTransfer.files, e.dataTransfer);
                }
            }}
        >
            <div
                draggable
                data-asset-group-id={group.id}
                className={`nl-drag-source flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-fill ${isSelected ? 'bg-primary/20 border-l-2 border-primary' : ''} ${isFocused(`group:${group.id}`) ? 'bg-fill-subtle' : ''} ${isDragging ? 'opacity-50' : ''} ${isCut ? 'opacity-40' : ''}`}
                style={{ paddingLeft: `${20 + level * 12}px` }}
                onClick={(e) => {
                    handleItemSelect(group.id, true, e);
                    handleGroupFocus(group.id);
                    toggleOpen();
                }}
                onContextMenu={(e) => showContextMenu(e, category, group, true)}
                onDragStart={(e) => handleDragStart?.(e, category, group, true)}
                onDragEnd={() => handleDragEnd?.()}
            >
                <FolderPlus className="w-4 h-4 text-primary" />
                <span className="text-sm">{group.name}</span>
                <span className="text-xs text-fg-subtle">({groupAssets.length + childGroups.length})</span>
            </div>

            {isOpen && (
                <div>
                    {childGroups.map(child => <GroupItem key={child.id} group={child} category={category} level={level + 1} />)}
                    {groupAssets.map(asset => <AssetItem key={asset.id} asset={asset} category={category} level={level + 1} />)}
                </div>
            )}
        </div>
    );
}

function AssetItem({ asset, category, level }: { asset: Asset; category: AssetCategory; level: number }) {
    const { selectedItems, clipboard, draggedItem, handleItemSelect, handleAssetClick, showContextMenu, handleDragStart, handleDragEnd, isFocused, isMultiSelectMode, mediaSupport, handleConvertMedia } = useAssetsPanelContext();
    const Icon = ASSET_TYPE_ICONS[asset.type];
    const isSelected = selectedItems.has(`asset:${asset.id}`);
    const isDragging = !!draggedItem && !draggedItem.isGroup && draggedItem.item.id === asset.id;
    const support = mediaSupport.get(asset.id);

    return (
        <div
            draggable
            className={`nl-drag-source flex items-center gap-2 px-3 py-1.5 cursor-default hover:bg-fill ${isSelected ? 'bg-primary/20 border-l-2 border-primary' : ''} ${isFocused(`asset:${asset.id}`) ? 'bg-fill-subtle' : ''} ${clipboard?.type === 'cut' && clipboard.assets.some(a => a.id === asset.id) ? 'opacity-40' : ''} ${isDragging ? 'opacity-50' : ''}`}
            style={{ paddingLeft: `${20 + level * 12}px` }}
            onClick={(e) => {
                handleItemSelect(asset.id, false, e);
                handleAssetClick(asset, isMultiSelectMode);
            }}
            onContextMenu={(e) => showContextMenu(e, category, asset, false)}
            onDragStart={(e) => handleDragStart?.(e, category, asset, false)}
            onDragEnd={() => handleDragEnd?.()}
        >
            <Icon className="w-4 h-4 text-fg-muted" />
            <span className="text-sm flex-1 truncate">{asset.name}</span>
            {support && (
                <AssetSupportBadge
                    record={support}
                    onConvert={asset.source === AssetSource.Local ? () => handleConvertMedia(asset) : undefined}
                />
            )}
            {asset.tags.length > 0 && <span className="text-xs text-fg-subtle">+{asset.tags.length}</span>}
        </div>
    );
}
