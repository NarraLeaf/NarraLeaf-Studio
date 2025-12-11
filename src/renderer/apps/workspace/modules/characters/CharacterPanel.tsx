import { useCallback, useEffect, useMemo, useState } from "react";
import { Accordion, AccordionItem } from "@/lib/components/elements/Accordion";
import { ContextMenu, ContextMenuDef, ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { SearchBox } from "../assets/components/SearchBox";
import { FilterSystem, FilterConfig, ActiveFilter } from "../assets/components/FilterSystem";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Character } from "@/lib/workspace/services/character/Character";
import { CharacterGroup } from "@/lib/workspace/services/character/types";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import { ServiceAssetsService } from "@/lib/workspace/services/core/ServiceAssetsService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { Services } from "@/lib/workspace/services/services";
import { FolderPlus, MoreVertical, RefreshCw, Tag, User, UserPlus, Users } from "lucide-react";
import { useCharacterFocus } from "./state/useCharacterFocus";

type MenuTarget =
    | { type: "panel" }
    | { type: "character"; character: Character }
    | { type: "group"; group: CharacterGroup };

type CharacterItem = {
    id: string;
    name: string;
    groupId?: string;
    thumbnailId: string | null;
    nicknames: string[];
    tags: string[];
    source: Character;
};

export function CharacterPanel({ panelId }: PanelComponentProps) {
    const { context, isInitialized } = useWorkspace();
    const { focusedCharacterId, handleCharacterClick, setFocusToPanel } = useCharacterFocus({ context, panelId });

    const [characters, setCharacters] = useState<Character[]>([]);
    const [groups, setGroups] = useState<CharacterGroup[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [groupFilter, setGroupFilter] = useState<string>("all");
    const [activeFilters, setActiveFilters] = useState<ActiveFilter[]>([]);
    const [filterRefreshKey, setFilterRefreshKey] = useState(0);
    const [thumbnails, setThumbnails] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(true);
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const [menuState, setMenuState] = useState({ visible: false, position: { x: 0, y: 0 } });

    const inputDialog = useMemo(() => {
        if (!context) return null;
        const uiService = context.services.get<UIService>(Services.UI);
        return createInputDialog(uiService);
    }, [context]);

    const characterService = useMemo(() => {
        if (!context || !isInitialized) return null;
        return context.services.get<CharacterService>(Services.Character);
    }, [context, isInitialized]);

    const loadCharacters = useCallback(() => {
        if (!characterService) return;
        setCharacters([...characterService.listCharacter()]);
        setGroups([...characterService.listGroups()]);
        setLoading(false);
    }, [characterService]);

    useEffect(() => {
        loadCharacters();
    }, [loadCharacters]);

    // Subscribe to character service changes (rename, group changes, etc.)
    useEffect(() => {
        if (!characterService) return;
        const unsubscribe = characterService.subscribe(() => {
            loadCharacters();
        });
        return () => unsubscribe();
    }, [characterService, loadCharacters]);

    const characterItems = useMemo<CharacterItem[]>(() => {
        return characters.map(character => {
            const profile = character.profile.getProfile();
            return {
                id: profile.id,
                name: profile.name,
                groupId: profile.groupId,
                thumbnailId: profile.thumbnail,
                nicknames: profile.nicknames,
                tags: profile.tags,
                source: character,
            };
        });
    }, [characters]);

    const groupMap = useMemo<Record<string, CharacterGroup>>(() => {
        const map: Record<string, CharacterGroup> = {};
        groups.forEach(group => {
            map[group.id] = group;
        });
        return map;
    }, [groups]);

    useEffect(() => {
        if (!context || !isInitialized) return;
        let cancelled = false;
        const serviceAssets = context.services.get<ServiceAssetsService>(Services.ServiceAssets);

        const loadThumbnails = async () => {
            const results = await Promise.all(characterItems.map(async (item) => {
                if (!item.thumbnailId) {
                    return [item.id, null] as const;
                }
                const result = await serviceAssets.readRaw(item.thumbnailId);
                if (!result.ok || cancelled) {
                    return [item.id, null] as const;
                }
                const buffer = new Uint8Array(result.data);
                const url = URL.createObjectURL(new Blob([buffer]));
                return [item.id, url] as const;
            }));

            if (cancelled) {
                results.forEach(([, url]) => {
                    if (url) URL.revokeObjectURL(url);
                });
                return;
            }

            const next: Record<string, string> = {};
            results.forEach(([id, url]) => {
                if (url) {
                    next[id] = url;
                }
            });
            setThumbnails(next);
        };

        loadThumbnails();

        return () => {
            cancelled = true;
        };
    }, [context, isInitialized, characterItems]);

    useEffect(() => {
        return () => {
            Object.values(thumbnails).forEach(url => URL.revokeObjectURL(url));
        };
    }, [thumbnails]);

    const normalizeTag = useCallback((tag: string) => tag.trim().toLowerCase(), []);

    const tagFilter = useMemo(
        () => new Set(activeFilters.filter(f => f.filterId === "tags").map(f => normalizeTag(f.optionId))),
        [activeFilters, normalizeTag]
    );

    const filteredCharacters = useMemo(() => {
        const keyword = searchQuery.trim().toLowerCase();
        return characterItems
            .filter(item => {
                const matchesKeyword = !keyword
                    || item.name.toLowerCase().includes(keyword)
                    || item.nicknames.some(nickname => nickname.toLowerCase().includes(keyword));
                const matchesGroup = groupFilter === "all"
                    ? true
                    : groupFilter === "ungrouped"
                        ? !item.groupId || !groupMap[item.groupId]
                        : item.groupId === groupFilter;
                const normalizedTags = new Set(item.tags.map(normalizeTag));
                const matchesTags = tagFilter.size === 0
                    ? true
                    : Array.from(tagFilter).every(tag => normalizedTags.has(tag));
                return matchesKeyword && matchesGroup && matchesTags;
            })
            .sort((a, b) => a.name.localeCompare(b.name));
    }, [characterItems, searchQuery, groupFilter, groupMap, tagFilter, normalizeTag]);

    const filterConfigs = useMemo<FilterConfig[]>(() => {
        const tagMap = new Map<string, string>();
        characterItems.forEach(item => {
            item.tags.forEach(raw => {
                const id = normalizeTag(raw);
                if (!id) return;
                if (!tagMap.has(id)) {
                    tagMap.set(id, raw.trim() || id);
                }
            });
        });
        const tagOptions = Array.from(tagMap.entries())
            .map(([id, label]) => ({ id, label, value: id }))
            .sort((a, b) => a.label.localeCompare(b.label));
        return [
            {
                id: "tags",
                label: "Tags",
                icon: <Tag className="w-4 h-4" />,
                options: tagOptions,
                multiSelect: true,
            },
        ];
    }, [characterItems, normalizeTag, filterRefreshKey]);

    const handleFilterOpen = useCallback(() => {
        // Force refresh to reflect latest tag updates when opening dropdown
        setFilterRefreshKey(prev => prev + 1);
    }, []);

    const ungroupedCharacters = useMemo(
        () => filteredCharacters.filter(item => !item.groupId || !groupMap[item.groupId]),
        [filteredCharacters, groupMap]
    );

    const groupedCharacters = useMemo(
        () => groups.map(group => ({
            group,
            members: filteredCharacters.filter(item => item.groupId === group.id),
        })),
        [groups, filteredCharacters]
    );

    const closeMenu = useCallback(() => {
        setMenuState(prev => ({ ...prev, visible: false }));
    }, []);

    const handleCreateCharacter = useCallback(async (groupId?: string) => {
        if (!characterService || !inputDialog) return;
        const name = await inputDialog.show({
            title: "New Character",
            placeholder: "Enter character name",
            required: true,
            maxLength: 100,
            description: "Create a new character profile",
        });
        if (!name) return;
        const character = characterService.createCharacter(name);
        if (groupId) {
            characterService.assignCharacterToGroup(character.profile.getId(), groupId);
        }
        loadCharacters();
        closeMenu();
    }, [characterService, inputDialog, loadCharacters, closeMenu]);

    const handleCreateGroup = useCallback(async () => {
        if (!characterService || !inputDialog) return;
        const name = await inputDialog.show({
            title: "New Group",
            placeholder: "Enter group name",
            required: true,
            maxLength: 100,
        });
        if (!name) return;
        characterService.createGroup(name);
        loadCharacters();
        closeMenu();
    }, [characterService, inputDialog, loadCharacters, closeMenu]);

    const handleRenameCharacter = useCallback(async (item: CharacterItem) => {
        if (!characterService || !inputDialog) return;
        const nextName = await inputDialog.showRenameDialog(item.name, "character");
        if (!nextName) return;
        characterService.renameCharacter(item.id, nextName);
        loadCharacters();
        closeMenu();
    }, [characterService, inputDialog, loadCharacters, closeMenu]);

    const handleDeleteCharacter = useCallback(async (item: CharacterItem) => {
        if (!characterService || !context) return;
        const uiService = context.services.get<UIService>(Services.UI);
        const confirmed = await uiService.showConfirm(`Delete character "${item.name}"?`, "This action cannot be undone.");
        if (!confirmed) return;
        const removed = characterService.deleteCharacter(item.id);
        if (removed) {
            const editorId = `narraleaf-studio:character-editor-${item.id}`;
            const store = uiService.getStore();
            const layout = store.getEditorLayout();

            // Ensure all editor instances related to this character are closed across groups
            const collectTabs = (node: any, acc: Array<{ tab: any; groupId: string }>) => {
                if (!node) return;
                if ("tabs" in node) {
                    (node.tabs as any[]).forEach((t) => acc.push({ tab: t, groupId: node.id }));
                } else {
                    collectTabs(node.first, acc);
                    collectTabs(node.second, acc);
                }
            };

            const allTabs: Array<{ tab: any; groupId: string }> = [];
            collectTabs(layout, allTabs);

            allTabs.forEach(({ tab, groupId }) => {
                const sameId = tab.id === editorId;
                const payloadCharacterId = tab?.payload?.character?.profile?.getId?.();
                if (sameId || payloadCharacterId === item.id) {
                    store.closeEditorTabInGroup(tab.id, groupId);
                }
            });

            const selection = store.getSelection();
            if (selection.type === "character" && (selection.data as Character)?.profile?.getId?.() === item.id) {
                store.setSelection({ type: null, data: null });
            }
            loadCharacters();
        }
        closeMenu();
    }, [characterService, context, loadCharacters, closeMenu]);

    const handleAssignToGroup = useCallback((characterId: string, targetGroupId?: string) => {
        if (!characterService) return;
        characterService.assignCharacterToGroup(characterId, targetGroupId);
        loadCharacters();
        closeMenu();
    }, [characterService, loadCharacters, closeMenu]);

    const handleRenameGroup = useCallback(async (group: CharacterGroup) => {
        if (!characterService || !inputDialog) return;
        const name = await inputDialog.showRenameDialog(group.name, "group");
        if (!name) return;
        characterService.renameGroup(group.id, name);
        loadCharacters();
        closeMenu();
    }, [characterService, inputDialog, loadCharacters, closeMenu]);

    const handleDeleteGroup = useCallback(async (group: CharacterGroup) => {
        if (!characterService || !context) return;
        const uiService = context.services.get<UIService>(Services.UI);
        const confirmed = await uiService.showConfirm(`Delete group "${group.name}"?`, "Characters in this group will be unassigned.");
        if (!confirmed) return;
        characterService.deleteGroup(group.id);
        loadCharacters();
        closeMenu();
    }, [characterService, context, loadCharacters, closeMenu]);

    const buildContextMenu = useCallback((target: MenuTarget): ContextMenuDef => {
        if (target.type === "character") {
            const profile = target.character.profile.getProfile();
            const item = filteredCharacters.find(c => c.id === profile.id);
            const moveItems: ContextMenuItemDef[] = [
                {
                    id: "move-none",
                    label: "Move to Ungrouped",
                    disabled: !profile.groupId,
                    onClick: () => handleAssignToGroup(profile.id),
                },
                ...groups.map(group => ({
                    id: `move-${group.id}`,
                    label: group.name,
                    disabled: profile.groupId === group.id,
                    onClick: () => handleAssignToGroup(profile.id, group.id),
                })),
            ];

            return [
                {
                    id: "rename-character",
                    label: "Rename",
                    onClick: () => item && handleRenameCharacter(item),
                },
                {
                    id: "move-character",
                    label: "Move to Group",
                    submenu: moveItems,
                },
                { separator: true, id: "character-separator" },
                {
                    id: "delete-character",
                    label: "Delete",
                    onClick: () => item && handleDeleteCharacter(item),
                },
            ];
        }

        if (target.type === "group") {
            return [
                {
                    id: "create-character-in-group",
                    label: "Add Character",
                    onClick: () => handleCreateCharacter(target.group.id),
                },
                {
                    id: "rename-group",
                    label: "Rename Group",
                    onClick: () => handleRenameGroup(target.group),
                },
                { separator: true, id: "group-sep" },
                {
                    id: "delete-group",
                    label: "Delete Group",
                    onClick: () => handleDeleteGroup(target.group),
                },
            ];
        }

        return [
            {
                id: "panel-new-character",
                label: "New Character",
                onClick: () => handleCreateCharacter(),
            },
            {
                id: "panel-new-group",
                label: "New Group",
                onClick: () => handleCreateGroup(),
            },
            {
                id: "panel-refresh",
                label: "Refresh",
                onClick: loadCharacters,
            },
        ];
    }, [filteredCharacters, groups, handleAssignToGroup, handleCreateCharacter, handleCreateGroup, handleDeleteCharacter, handleDeleteGroup, handleRenameCharacter, handleRenameGroup, loadCharacters]);

    const handleMenuOpen = useCallback((event: React.MouseEvent, target: MenuTarget) => {
        event.preventDefault();
        event.stopPropagation();
        const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
        const items = buildContextMenu(target);
        setMenuItems(items);
        setMenuState({ visible: true, position: { x: rect.right, y: rect.bottom } });
    }, [buildContextMenu]);

    const renderCharacterRow = useCallback((item: CharacterItem) => {
        const thumbnailUrl = thumbnails[item.id];
        const isFocused = focusedCharacterId === item.id;
        const focusedStyles = isFocused ? "bg-primary/20 border-l-2 border-primary" : "";

        return (
            <div
                key={item.id}
                className={`group flex items-center gap-3 px-3 py-2 cursor-default hover:bg-gray-600/30 border-b border-white/5 last:border-b-0 transition-colors ${focusedStyles}`}
                data-character-id={item.id}
                onClick={() => handleCharacterClick(item.source)}
            >
                <div className="w-10 h-10 rounded-md bg-white/10 overflow-hidden flex items-center justify-center flex-shrink-0">
                    {thumbnailUrl ? (
                        <img src={thumbnailUrl} alt={item.name} className="w-full h-full object-cover" />
                    ) : (
                        <User className="w-5 h-5 text-gray-400" />
                    )}
                </div>
                <div className="min-w-0 flex-1">
                    <div className="text-sm text-white truncate">{item.name}</div>
                    {item.nicknames.length > 0 && (
                        <div className="text-xs text-gray-500 truncate">{item.nicknames.join(", ")}</div>
                    )}
                </div>
                <button
                    className="p-1 rounded hover:bg-white/10 text-gray-300 opacity-0 group-hover:opacity-100"
                    onClick={(event) => { event.stopPropagation(); handleMenuOpen(event, { type: "character", character: item.source }); }}
                    title="Actions"
                >
                    <MoreVertical className="w-4 h-4" />
                </button>
            </div>
        );
    }, [focusedCharacterId, handleCharacterClick, handleMenuOpen, thumbnails]);

    const hasNoData = !loading && filteredCharacters.length === 0 && groups.length === 0;

    return (
        <div className="h-full flex flex-col" data-panel-id={panelId} onClick={setFocusToPanel}>
            <div className="px-3 py-2 border-b border-white/10 space-y-3">
                <SearchBox
                    value={searchQuery}
                    onChange={setSearchQuery}
                    placeholder="Search characters..."
                    className="w-full"
                />
                <div className="flex items-center gap-2">
                    <button
                        onClick={(event) => { event.stopPropagation(); handleCreateCharacter(); }}
                        className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors"
                        title="Add Character"
                    >
                        <UserPlus className="w-4 h-4" />
                    </button>
                    <button
                        onClick={(event) => { event.stopPropagation(); handleCreateGroup(); }}
                        className="flex items-center justify-center gap-2 px-3 py-2.5 rounded-md border border-white/20 bg-white/5 text-white hover:bg-white/10 transition-colors"
                        title="Add Group"
                    >
                        <FolderPlus className="w-4 h-4" />
                    </button>
                    <FilterSystem
                        className="flex-1"
                        filters={filterConfigs}
                        activeFilters={activeFilters}
                        onFiltersChange={(next) => {
                            setActiveFilters(next.filter(f => f.filterId === "tags"));
                        }}
                        onFilterOpen={handleFilterOpen}
                    />
                    {/* Count removed per request */}
                    <button
                        onClick={loadCharacters}
                        className="p-2 rounded hover:bg-white/10 text-gray-300"
                        title="Refresh"
                    >
                        <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            <div className="flex-1 overflow-y-auto">
                {loading ? (
                    <div className="p-4 flex items-center gap-2 text-gray-400">
                        <RefreshCw className="w-4 h-4 animate-spin" />
                        <span>Loading characters...</span>
                    </div>
                ) : hasNoData ? (
                    <div className="p-4 text-sm text-gray-400">No characters match your filters.</div>
                ) : (
                    <div className="divide-y divide-white/10">
                        {ungroupedCharacters.length > 0 && (
                            <div>
                                <div className="px-3 py-2 text-xs text-gray-400 flex items-center gap-2 border-b border-white/10">
                                    <Users className="w-4 h-4" />
                                    <span>Ungrouped</span>
                                    <span className="text-gray-500">({ungroupedCharacters.length})</span>
                                </div>
                                <div className="divide-y divide-white/5">
                                    {ungroupedCharacters.map(renderCharacterRow)}
                                </div>
                            </div>
                        )}

                        {groupedCharacters.length > 0 && (
                            <Accordion defaultOpen={groupedCharacters.filter(item => item.members.length > 0).map(item => item.group.id)} multiple>
                                {groupedCharacters.map(({ group, members }) => (
                                    <div key={group.id}>
                                        <AccordionItem
                                            id={group.id}
                                            title={
                                                <div className="flex items-center gap-2">
                                                    <span>{group.name}</span>
                                                    <span className="text-xs text-gray-500">({members.length})</span>
                                                </div>
                                            }
                                            icon={<Users className="w-4 h-4" />}
                                            actions={
                                                <div className="flex items-center gap-1">
                                                    <button
                                                        onClick={(event) => {
                                                            event.stopPropagation();
                                                            handleCreateCharacter(group.id);
                                                        }}
                                                        className="inline-flex items-center justify-center p-1.5 rounded-md border border-primary/30 bg-primary/5 text-primary hover:bg-primary/15 hover:border-primary/50 transition-colors"
                                                        title="Add character"
                                                    >
                                                        <UserPlus className="w-3 h-3" />
                                                    </button>
                                                    <button
                                                        onClick={(event) => handleMenuOpen(event, { type: "group", group })}
                                                        className="p-1 rounded hover:bg-white/10"
                                                        title="Group actions"
                                                    >
                                                        <MoreVertical className="w-3 h-3" />
                                                    </button>
                                                </div>
                                            }
                                            headerClassName="border-b border-white/10"
                                            focusable={false}
                                        >
                                            {members.length === 0 ? (
                                                <div className="px-3 py-2 text-xs text-gray-500">No characters in this group.</div>
                                            ) : (
                                                <div className="divide-y divide-white/5">
                                                    {members.map(renderCharacterRow)}
                                                </div>
                                            )}
                                        </AccordionItem>
                                    </div>
                                ))}
                            </Accordion>
                        )}
                    </div>
                )}
            </div>

            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={closeMenu}
            />
        </div>
    );
}

