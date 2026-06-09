import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, RefObject, MouseEvent } from "react";
import { ChevronDown, ChevronRight, GripVertical, Hash, Image, Plus } from "lucide-react";
import { useSortable } from "@dnd-kit/sortable";
import type { StoryActionPayload, StoryBlock, StoryDocument, StoryScene } from "@shared/types/story";
import { useWorkspace } from "@/apps/workspace/context";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { Services } from "@/lib/workspace/services/services";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import type { Character } from "@/lib/workspace/services/character/Character";
import {
    ACTION_COMMAND_CATEGORIES,
    ACTION_COMMANDS,
    getActionCommandCategory,
    type ActionCommand,
    type ActionCommandCategory,
    type ActionCommandCategoryId,
    type ActionCommandId,
} from "./storyActionCommands";
import { ActionInspector } from "./StorySceneActionInspector";
import type { EditorMode, VisibleStoryRow } from "./storySceneEditorTypes";
import {
    canAcceptChildren,
    describeBlock,
    getBlockBadgeInfo,
    getCharacterName,
    getEmptyTextPlaceholder,
    getTextSegment,
} from "./storySceneBlockUtils";

export function StoryBlockRow(props: {
    row: VisibleStoryRow;
    scene: StoryScene;
    document: StoryDocument;
    characters: Character[];
    selected: boolean;
    active: boolean;
    collapsed: boolean;
    editing: boolean;
    editValue: string;
    textInputRef: RefObject<HTMLTextAreaElement | null>;
    inspectorOpen: boolean;
    onSelect: (event: MouseEvent) => void;
    onMouseDown: (event: MouseEvent) => void;
    onMouseEnter: () => void;
    onToggleCollapsed: () => void;
    onStartTextEdit: () => void;
    onEditValueChange: (value: string) => void;
    onCommitTextEdit: () => void;
    onCancelTextEdit: () => void;
    onInsertDialogueAfterCurrent: () => void;
    onOpenInspector: () => void;
    onCloseInspector: () => void;
    onUpdatePayload: (payload: StoryBlock["payload"]) => void;
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    generateTextId: () => string;
    onInsertAfter: () => void;
}) {
    const { row, scene, document, characters, selected, active, collapsed, editing, editValue, textInputRef, inspectorOpen } = props;
    const block = row.block;
    const canFold = block.childrenIds.length > 0 && canAcceptChildren(block);
    const textSegment = getTextSegment(block);
    const { attributes, listeners, setActivatorNodeRef, setNodeRef, transform, transition, isDragging } = useSortable({
        id: row.block.id,
    });
    const sortableStyle: CSSProperties = {
        transform: toSortableTransform(transform),
        transition,
        zIndex: isDragging ? 20 : undefined,
        opacity: isDragging ? 0.72 : undefined,
    };

    return (
        <div
            ref={setNodeRef}
            style={sortableStyle}
            data-story-row-block-id={block.id}
            className={[
                "group relative grid min-h-[40px] grid-cols-[44px_28px_1fr] items-start border-l-2 pr-3",
                selected ? "border-primary bg-primary/20" : active ? "border-primary bg-white/[0.035]" : "border-transparent hover:bg-white/[0.025]",
            ].join(" ")}
            onClick={props.onSelect}
            onMouseDown={props.onMouseDown}
            onMouseEnter={props.onMouseEnter}
            onDoubleClick={event => {
                event.stopPropagation();
                textSegment ? props.onStartTextEdit() : props.onOpenInspector();
            }}
        >
            <div className="flex h-full items-start justify-end gap-1 pt-2 text-[12px] tabular-nums text-slate-500">
                {canFold ? (
                    <button
                        type="button"
                        className="mt-0.5 rounded text-slate-500 hover:bg-white/10 hover:text-primary"
                        onClick={event => {
                            event.stopPropagation();
                            props.onToggleCollapsed();
                        }}
                    >
                        {collapsed ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                    </button>
                ) : (
                    <span className="h-3.5 w-3.5" />
                )}
                <span>{row.lineNumber}</span>
            </div>
            <div className="flex self-stretch items-center justify-center">
                <div
                    ref={setActivatorNodeRef}
                    {...attributes}
                    {...listeners}
                    role="button"
                    tabIndex={0}
                    aria-label="Drag row"
                    title="Drag row"
                    className="flex h-7 w-7 touch-none select-none items-center justify-center rounded text-slate-500 opacity-0 transition-colors hover:cursor-grab hover:text-primary hover:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60 group-hover:opacity-100"
                    onMouseDown={event => event.stopPropagation()}
                    onClick={event => event.stopPropagation()}
                >
                    <GripVertical className="pointer-events-none h-4 w-4" />
                </div>
            </div>
            <div className="min-w-0 py-1.5" style={{ paddingLeft: row.depth * 22 }}>
                <div className="flex min-h-[28px] min-w-0 items-center gap-2">
                    <BlockBadge block={block} />
                    {editing && textSegment ? (
                        <TextEditBox
                            textInputRef={textInputRef}
                            editValue={editValue}
                            onEditValueChange={props.onEditValueChange}
                            onCommitTextEdit={props.onCommitTextEdit}
                            onCancelTextEdit={props.onCancelTextEdit}
                            onInsertDialogueAfterCurrent={props.onInsertDialogueAfterCurrent}
                            onInsertAfter={props.onInsertAfter}
                            block={block}
                            characters={characters}
                            onSetDialogueCharacter={props.onSetDialogueCharacter}
                        />
                    ) : (
                        <BlockPreview
                            block={block}
                            scene={scene}
                            characters={characters}
                            onSetDialogueCharacter={props.onSetDialogueCharacter}
                            onTextDoubleClick={props.onStartTextEdit}
                        />
                    )}
                    <RowActions onInsertAfter={props.onInsertAfter} />
                </div>
                {inspectorOpen ? (
                    <ActionInspector
                        block={block}
                        document={document}
                        characters={characters}
                        onUpdatePayload={props.onUpdatePayload}
                        onClose={props.onCloseInspector}
                        onSetDialogueCharacter={props.onSetDialogueCharacter}
                        generateTextId={props.generateTextId}
                    />
                ) : null}
            </div>
        </div>
    );
}

function TextEditBox(props: {
    textInputRef: RefObject<HTMLTextAreaElement | null>;
    editValue: string;
    onEditValueChange: (value: string) => void;
    onCommitTextEdit: () => void;
    onCancelTextEdit: () => void;
    onInsertDialogueAfterCurrent: () => void;
    onInsertAfter: () => void;
    block: StoryBlock;
    characters: Character[];
    onSetDialogueCharacter: (characterId: string | undefined) => void;
}) {
    const dialoguePayload = props.block.kind === "nodeAction" && props.block.payload.action === "dialogue"
        ? props.block.payload
        : null;
    return (
        <div className="flex min-w-0 flex-1 items-stretch overflow-visible rounded border border-primary/50 bg-black/30">
            {dialoguePayload ? (
                <CharacterSelectTrigger
                    characters={props.characters}
                    characterId={dialoguePayload.characterId}
                    onChoose={props.onSetDialogueCharacter}
                    className="min-w-[128px] max-w-[200px] rounded-r-none border-r border-white/10 px-2"
                />
            ) : null}
            <textarea
                ref={props.textInputRef}
                className="min-h-[28px] flex-1 resize-none bg-transparent px-2 py-1 text-sm text-slate-100 outline-none"
                value={props.editValue}
                rows={1}
                onClick={event => event.stopPropagation()}
                onChange={event => props.onEditValueChange(event.target.value)}
                onBlur={props.onCommitTextEdit}
                onKeyDown={event => {
                    if (event.key === "Escape") {
                        event.preventDefault();
                        props.onCancelTextEdit();
                    }
                    if (event.key === "Enter" && event.shiftKey && dialoguePayload) {
                        event.preventDefault();
                        props.onInsertDialogueAfterCurrent();
                        return;
                    }
                    if (event.key === "Enter" && !event.shiftKey) {
                        event.preventDefault();
                        props.onCommitTextEdit();
                        props.onInsertAfter();
                    }
                }}
            />
        </div>
    );
}

function RowActions(props: { onInsertAfter: () => void }) {
    return (
        <div className="ml-auto hidden shrink-0 items-center gap-1 group-hover:flex">
            <button type="button" className="rounded px-1.5 py-1 text-[11px] text-slate-400 hover:bg-white/10 hover:text-primary" onClick={event => {
                event.stopPropagation();
                props.onInsertAfter();
            }}>
                Insert
            </button>
        </div>
    );
}

export function InsertRow(props: {
    mode: Extract<EditorMode, { kind: "insert" }>;
    characters: Character[];
    inputRef: RefObject<HTMLTextAreaElement | null>;
    onValueChange: (value: string) => void;
    onCommitNarration: (focusNext: boolean) => void;
    onCancelActionChooser: () => void;
    onChooseCommand: (commandId: ActionCommandId) => void;
    onChooseCharacter: (characterId: string) => void;
}) {
    const chooserQuery = props.mode.value.slice(1);
    const menuAnchorRef = useRef<HTMLDivElement | null>(null);
    const menuPlacement = useAutoMenuPlacement(menuAnchorRef, props.mode.chooser !== "none", 312);
    const actionOptions = useMemo(() => getActionCommandOptions(chooserQuery), [chooserQuery]);
    const characterOptions = useMemo(() => getCharacterOptions(props.characters, chooserQuery), [props.characters, chooserQuery]);
    const actionMenu = useActionCommandMenuState(actionOptions);
    const characterMenu = useCharacterPickerState(characterOptions);

    return (
        <div className="relative grid min-h-[40px] grid-cols-[44px_28px_1fr] items-start pr-3">
            <div className="pt-2 text-right text-[12px] text-slate-600">+</div>
            <div className="flex justify-center pt-2">
                <Plus className="h-4 w-4 text-primary" />
            </div>
            <div ref={menuAnchorRef} className="relative py-1.5">
                <textarea
                    ref={props.inputRef}
                    className="min-h-[30px] w-full resize-none rounded border border-primary/40 bg-black/30 px-2 py-1 text-sm text-slate-100 outline-none placeholder:italic placeholder:text-slate-500"
                    rows={1}
                    value={props.mode.value}
                    placeholder="Type narration, / for actions, # for characters..."
                    onChange={event => props.onValueChange(event.target.value)}
                    onBlur={() => {
                        if (props.mode.chooser === "none") {
                            props.onCommitNarration(false);
                        }
                    }}
                    onKeyDown={event => {
                        if (event.key === "Escape") {
                            event.preventDefault();
                            props.mode.chooser === "action" ? props.onCancelActionChooser() : props.onCommitNarration(false);
                            return;
                        }
                        if (props.mode.chooser === "action") {
                            if (event.key === "Tab") {
                                event.preventDefault();
                                actionMenu.moveCategory(event.shiftKey ? -1 : 1);
                                return;
                            }
                            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
                                event.preventDefault();
                                actionMenu.moveCategory(event.key === "ArrowLeft" ? -1 : 1);
                                return;
                            }
                            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                                event.preventDefault();
                                actionMenu.moveCommand(event.key === "ArrowDown" ? 1 : -1);
                                return;
                            }
                        }
                        if (props.mode.chooser === "character" && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
                            event.preventDefault();
                            characterMenu.moveCharacter(event.key === "ArrowDown" ? 1 : -1);
                            return;
                        }
                        if (event.key === "Enter") {
                            event.preventDefault();
                            if (event.shiftKey) {
                                return;
                            }
                            if (props.mode.chooser === "action") {
                                const command = actionMenu.activeCommand;
                                command ? props.onChooseCommand(command.id) : props.onCommitNarration(true);
                                return;
                            }
                            if (props.mode.chooser === "character") {
                                const character = characterMenu.activeCharacter;
                                character ? props.onChooseCharacter(character.profile.getId()) : props.onCommitNarration(true);
                                return;
                            }
                            props.onCommitNarration(true);
                        }
                    }}
                />
                {props.mode.chooser === "action" ? (
                    <ActionCommandMenu
                        categories={actionMenu.visibleCategories}
                        activeCategoryId={actionMenu.activeCategoryId}
                        activeCommandId={actionMenu.activeCommand?.id ?? null}
                        onSelectCategory={actionMenu.selectCategory}
                        onHighlightCommand={actionMenu.selectCommand}
                        onChoose={props.onChooseCommand}
                        onCancel={props.onCancelActionChooser}
                        placement={menuPlacement}
                    />
                ) : null}
                {props.mode.chooser === "character" ? (
                    <CharacterPicker
                        characters={characterOptions}
                        activeCharacterId={characterMenu.activeCharacter?.profile.getId() ?? null}
                        onHighlight={characterMenu.selectCharacter}
                        onChoose={props.onChooseCharacter}
                        onClear={() => props.onCommitNarration(false)}
                        placement={menuPlacement}
                    />
                ) : null}
            </div>
        </div>
    );
}

function getActionCommandOptions(query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    return ACTION_COMMANDS.filter(command => !normalizedQuery || command.label.toLowerCase().includes(normalizedQuery) || command.id.toLowerCase().includes(normalizedQuery));
}

function getCharacterOptions(characters: Character[], query: string) {
    const normalizedQuery = query.trim().toLowerCase();
    return characters.filter(character => {
        const name = character.profile.getName().toLowerCase();
        return !normalizedQuery || name.includes(normalizedQuery);
    });
}

type VisibleActionCommandCategory = ActionCommandCategory & {
    commands: ActionCommand[];
};

type PopupPlacement = "above" | "below";

function useAutoMenuPlacement(anchorRef: RefObject<HTMLElement | null>, open: boolean, expectedHeight: number): PopupPlacement {
    const [placement, setPlacement] = useState<PopupPlacement>("below");

    useEffect(() => {
        if (!open) {
            return;
        }
        const updatePlacement = () => {
            const rect = anchorRef.current?.getBoundingClientRect();
            if (!rect) {
                return;
            }
            const gap = 8;
            const spaceBelow = window.innerHeight - rect.bottom - gap;
            const spaceAbove = rect.top - gap;
            setPlacement(spaceBelow < expectedHeight && spaceAbove > spaceBelow ? "above" : "below");
        };
        updatePlacement();
        const raf = window.requestAnimationFrame(updatePlacement);
        window.addEventListener("resize", updatePlacement);
        window.addEventListener("scroll", updatePlacement, true);
        return () => {
            window.cancelAnimationFrame(raf);
            window.removeEventListener("resize", updatePlacement);
            window.removeEventListener("scroll", updatePlacement, true);
        };
    }, [anchorRef, expectedHeight, open]);

    return placement;
}

function getPopupPlacementClass(placement: PopupPlacement): string {
    return placement === "above" ? "bottom-full mb-1" : "top-full mt-1";
}

function useActionCommandMenuState(options: ActionCommand[]) {
    const visibleCategories = useMemo<VisibleActionCommandCategory[]>(() => {
        return ACTION_COMMAND_CATEGORIES.map(category => ({
            ...category,
            commands: category.id === "all"
                ? options
                : options.filter(command => command.category === category.id),
        }));
    }, [options]);
    const [activeCategoryId, setActiveCategoryId] = useState<ActionCommandCategoryId>("all");
    const [activeCommandId, setActiveCommandId] = useState<ActionCommandId | null>(null);

    const activeCategory = visibleCategories.find(category => category.id === activeCategoryId) ?? visibleCategories[0] ?? null;
    const activeCommand = activeCategory?.commands.find(command => command.id === activeCommandId) ?? activeCategory?.commands[0] ?? null;

    useEffect(() => {
        if (visibleCategories.length === 0) {
            setActiveCommandId(null);
            return;
        }
        setActiveCategoryId(current => visibleCategories.some(category => category.id === current) ? current : visibleCategories[0].id);
    }, [visibleCategories]);

    useEffect(() => {
        if (!activeCategory) {
            setActiveCommandId(null);
            return;
        }
        setActiveCommandId(current => activeCategory.commands.some(command => command.id === current) ? current : activeCategory.commands[0]?.id ?? null);
    }, [activeCategory]);

    const selectCategory = (categoryId: ActionCommandCategoryId) => {
        const category = visibleCategories.find(next => next.id === categoryId);
        if (!category) {
            return;
        }
        setActiveCategoryId(category.id);
        setActiveCommandId(category.commands[0]?.id ?? null);
    };

    const selectCommand = (commandId: ActionCommandId) => {
        setActiveCommandId(commandId);
    };

    const moveCategory = (direction: -1 | 1) => {
        if (visibleCategories.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, visibleCategories.findIndex(category => category.id === activeCategoryId));
        const nextIndex = (currentIndex + direction + visibleCategories.length) % visibleCategories.length;
        const nextCategory = visibleCategories[nextIndex];
        setActiveCategoryId(nextCategory.id);
        setActiveCommandId(nextCategory.commands[0]?.id ?? null);
    };

    const moveCommand = (direction: -1 | 1) => {
        if (!activeCategory || activeCategory.commands.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, activeCategory.commands.findIndex(command => command.id === activeCommand?.id));
        const nextIndex = (currentIndex + direction + activeCategory.commands.length) % activeCategory.commands.length;
        setActiveCommandId(activeCategory.commands[nextIndex].id);
    };

    return {
        visibleCategories,
        activeCategoryId: activeCategory?.id ?? activeCategoryId,
        activeCommand,
        selectCategory,
        selectCommand,
        moveCategory,
        moveCommand,
    };
}

function ActionCommandMenu(props: {
    categories: VisibleActionCommandCategory[];
    activeCategoryId: ActionCommandCategoryId;
    activeCommandId: ActionCommandId | null;
    onSelectCategory: (categoryId: ActionCommandCategoryId) => void;
    onHighlightCommand: (commandId: ActionCommandId) => void;
    onChoose: (commandId: ActionCommandId) => void;
    onCancel: () => void;
    placement: PopupPlacement;
}) {
    const activeCategory = props.categories.find(category => category.id === props.activeCategoryId) ?? props.categories[0] ?? null;
    const listRef = useRef<HTMLDivElement | null>(null);
    const categoryListRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!activeCategory) {
            return;
        }
        window.requestAnimationFrame(() => {
            const root = categoryListRef.current;
            const activeTab = root?.querySelector(`[data-action-category-id="${activeCategory.id}"]`);
            activeTab?.scrollIntoView({ block: "nearest", inline: "nearest" });
        });
    }, [activeCategory?.id]);

    useEffect(() => {
        if (!props.activeCommandId) {
            return;
        }
        window.requestAnimationFrame(() => {
            const root = listRef.current;
            const activeItem = root?.querySelector(`[data-action-command-id="${props.activeCommandId}"]`);
            activeItem?.scrollIntoView({ block: "nearest" });
        });
    }, [activeCategory?.id, props.activeCommandId]);

    return (
        <div
            className={["absolute left-0 z-50 w-[420px] overflow-hidden rounded-xl border border-white/10 bg-[#181b20] shadow-xl", getPopupPlacementClass(props.placement)].join(" ")}
            onMouseDown={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {props.categories.length === 0 ? (
                <button type="button" className="w-full px-3 py-2 text-left text-sm text-slate-400 hover:bg-white/[0.06]" onMouseDown={props.onCancel}>
                    No action found. 
                </button>
            ) : (
                <>
                    <div ref={categoryListRef} className="flex overflow-x-auto border-b border-white/10 bg-[#0f1115]" role="tablist" aria-label="Action types">
                        {props.categories.map(category => {
                            const active = category.id === activeCategory?.id;
                            return (
                                <button
                                    key={category.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={active}
                                    data-action-category-id={category.id}
                                    className={[
                                        "relative flex h-9 min-w-[74px] flex-none cursor-default items-center justify-center px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
                                        active ? "bg-[#151922] text-white" : "text-slate-400 hover:bg-white/[0.04] hover:text-slate-100",
                                    ].join(" ")}
                                    onMouseDown={() => props.onSelectCategory(category.id)}
                                >
                                    <span className="block truncate">{category.label}</span>
                                    {active ? <span className="pointer-events-none absolute inset-x-0 bottom-0 h-0.5 bg-primary/70" aria-hidden /> : null}
                                </button>
                            );
                        })}
                    </div>
                    <div ref={listRef} className="max-h-64 overflow-auto p-1">
                        {activeCategory && activeCategory.commands.length === 0 ? (
                            <button type="button" className="w-full rounded px-2 py-2 text-left text-sm text-slate-400 hover:bg-white/[0.06]" onMouseDown={props.onCancel}>
                                No {activeCategory.label.toLowerCase()} action found. 
                            </button>
                        ) : activeCategory?.commands.map(command => {
                            const Icon = command.icon;
                            const active = command.id === props.activeCommandId;
                            const category = getActionCommandCategory(command.category);
                            return (
                                <button
                                    key={command.id}
                                    type="button"
                                    role="option"
                                    aria-selected={active}
                                    data-action-command-id={command.id}
                                    className={[
                                        "flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors",
                                        active ? "bg-primary/15 text-white" : "hover:bg-white/[0.06]",
                                    ].join(" ")}
                                    onMouseDown={() => props.onChoose(command.id)}
                                    onMouseEnter={() => props.onHighlightCommand(command.id)}
                                >
                                    <Icon className="h-4 w-4 shrink-0" style={{ color: category.iconColor }} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm text-slate-100">{command.label}</span>
                                        <span className="block truncate text-[11px] text-slate-500">{command.detail}</span>
                                    </span>
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

function useCharacterPickerState(characters: Character[]) {
    const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
    const activeCharacter = characters.find(character => character.profile.getId() === activeCharacterId) ?? characters[0] ?? null;

    useEffect(() => {
        if (characters.length === 0) {
            setActiveCharacterId(null);
            return;
        }
        setActiveCharacterId(current => characters.some(character => character.profile.getId() === current) ? current : characters[0].profile.getId());
    }, [characters]);

    const selectCharacter = (characterId: string) => {
        setActiveCharacterId(characterId);
    };

    const moveCharacter = (direction: -1 | 1) => {
        if (characters.length === 0) {
            return;
        }
        const currentIndex = Math.max(0, characters.findIndex(character => character.profile.getId() === activeCharacter?.profile.getId()));
        const nextIndex = (currentIndex + direction + characters.length) % characters.length;
        setActiveCharacterId(characters[nextIndex].profile.getId());
    };

    return {
        activeCharacter,
        selectCharacter,
        moveCharacter,
    };
}

function CharacterPicker(props: {
    characters: Character[];
    activeCharacterId: string | null;
    onHighlight: (characterId: string) => void;
    onChoose: (characterId: string) => void;
    onClear: () => void;
    placement: PopupPlacement;
}) {
    const listRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!props.activeCharacterId) {
            return;
        }
        window.requestAnimationFrame(() => {
            const root = listRef.current;
            const activeItem = root?.querySelector(`[data-character-id="${props.activeCharacterId}"]`);
            activeItem?.scrollIntoView({ block: "nearest" });
        });
    }, [props.activeCharacterId]);

    return (
        <div
            ref={listRef}
            className={["absolute left-0 z-50 max-h-72 w-[320px] overflow-auto rounded-xl border border-white/10 bg-[#181b20] p-1 shadow-xl", getPopupPlacementClass(props.placement)].join(" ")}
            onMouseDown={event => {
                event.preventDefault();
                event.stopPropagation();
            }}
        >
            {props.characters.length === 0 ? (
                <button type="button" className="w-full rounded px-2 py-2 text-left text-sm text-slate-400 hover:bg-white/[0.06]" onMouseDown={props.onClear}>
                    No character found. 
                </button>
            ) : (
                props.characters.map(character => {
                    const characterId = character.profile.getId();
                    const active = characterId === props.activeCharacterId;
                    return (
                        <button
                            key={characterId}
                            type="button"
                            role="option"
                            aria-selected={active}
                            data-character-id={characterId}
                            className={[
                                "flex w-full items-center gap-2 rounded px-2 py-2 text-left transition-colors",
                                active ? "bg-primary/15 text-white" : "hover:bg-white/[0.06]",
                            ].join(" ")}
                            onMouseEnter={() => props.onHighlight(characterId)}
                            onMouseDown={() => props.onChoose(characterId)}
                        >
                            <Hash className={["h-4 w-4 shrink-0", active ? "text-primary" : "text-primary/80"].join(" ")} />
                            <span className="truncate text-sm text-slate-100">{character.profile.getName()}</span>
                        </button>
                    );
                })
            )}
        </div>
    );
}

function CharacterSelectTrigger(props: {
    characters: Character[];
    characterId: string | undefined;
    onChoose: (characterId: string | undefined) => void;
    className?: string;
}) {
    const rootRef = useRef<HTMLDivElement | null>(null);
    const [open, setOpen] = useState(false);
    const picker = useCharacterPickerState(props.characters);
    const placement = useAutoMenuPlacement(rootRef, open, 288);
    const label = getCharacterName(props.characters, props.characterId);
    const unassigned = !props.characterId;

    useEffect(() => {
        if (open && props.characterId) {
            picker.selectCharacter(props.characterId);
        }
    }, [open, props.characterId]);

    useEffect(() => {
        if (!open) {
            return;
        }
        const handlePointerDown = (event: PointerEvent) => {
            if (!rootRef.current?.contains(event.target as Node)) {
                setOpen(false);
            }
        };
        window.addEventListener("pointerdown", handlePointerDown);
        return () => window.removeEventListener("pointerdown", handlePointerDown);
    }, [open]);

    return (
        <div ref={rootRef} className="relative shrink-0 overflow-visible">
            <button
                type="button"
                className={[
                    "flex h-full min-h-[28px] max-w-full items-center truncate rounded px-1 py-0.5 text-left text-sm hover:bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60",
                    unassigned ? "italic text-slate-500 hover:text-primary" : "text-primary",
                    props.className ?? "",
                ].join(" ")}
                onMouseDown={event => {
                    event.preventDefault();
                    event.stopPropagation();
                }}
                onClick={event => {
                    event.stopPropagation();
                    setOpen(current => !current);
                }}
            >
                <span className="truncate">{label}</span>
            </button>
            {open ? (
                <CharacterPicker
                    characters={props.characters}
                    activeCharacterId={picker.activeCharacter?.profile.getId() ?? null}
                    onHighlight={picker.selectCharacter}
                    onChoose={characterId => {
                        props.onChoose(characterId);
                        setOpen(false);
                    }}
                    onClear={() => {
                        props.onChoose(undefined);
                        setOpen(false);
                    }}
                    placement={placement}
                />
            ) : null}
        </div>
    );
}

function BlockBadge({ block }: { block: StoryBlock }) {
    const { label, icon: Icon, iconColor } = getBlockBadgeInfo(block);
    return (
        <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded border border-white/10 bg-white/[0.04]" title={label} aria-label={label}>
            <Icon className="h-3.5 w-3.5" style={{ color: iconColor }} />
        </span>
    );
}

function toSortableTransform(transform: { x: number; y: number; scaleX?: number; scaleY?: number } | null): string | undefined {
    if (!transform) {
        return undefined;
    }
    const scaleX = transform.scaleX ?? 1;
    const scaleY = transform.scaleY ?? 1;
    return `translate3d(0, ${transform.y}px, 0) scaleX(${scaleX}) scaleY(${scaleY})`;
}

function BlockPreview(props: {
    block: StoryBlock;
    scene: StoryScene;
    characters: Character[];
    onSetDialogueCharacter: (characterId: string | undefined) => void;
    onTextDoubleClick: () => void;
}) {
    const block = props.block;
    const text = getTextSegment(block);
    if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
        const hasValue = Boolean(text?.value);
        return (
            <div className="flex min-w-0 items-center gap-2 text-sm">
                <CharacterSelectTrigger
                    characters={props.characters}
                    characterId={block.payload.characterId}
                    onChoose={props.onSetDialogueCharacter}
                />
                <span className={["min-w-0 flex-1 truncate", hasValue ? "text-slate-100" : "italic text-slate-500"].join(" ")} onDoubleClick={event => {
                    event.stopPropagation();
                    props.onTextDoubleClick();
                }}>
                    {text?.value || "Double-click to enter dialogue"}
                </span>
            </div>
        );
    }
    if (text) {
        const hasValue = Boolean(text.value);
        const note = block.kind === "note";
        return (
            <span className={["min-w-0 flex-1 truncate text-sm", note ? "italic text-slate-400" : hasValue ? "text-slate-100" : "italic text-slate-500"].join(" ")} onDoubleClick={event => {
                event.stopPropagation();
                props.onTextDoubleClick();
            }}>
                {text.value || getEmptyTextPlaceholder(block)}
            </span>
        );
    }
    if (block.kind === "action" && block.payload.action === "setBackground") {
        return <BackgroundBlockPreview payload={block.payload} />;
    }
    return <span className="min-w-0 flex-1 truncate text-sm text-slate-300">{describeBlock(block, props.characters, props.scene)}</span>;
}

function BackgroundBlockPreview({ payload }: { payload: Extract<StoryActionPayload, { action: "setBackground" }> }) {
    const { context, isInitialized } = useWorkspace();
    const assetsService = useMemo(
        () => context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null,
        [context, isInitialized],
    );
    const asset = payload.assetId ? assetsService?.getAssets()[AssetType.Image]?.[payload.assetId] ?? null : null;
    const { url } = useAssetObjectUrl(payload.assetId ?? null);
    const label = asset?.name ?? (payload.assetId ? "Missing image" : payload.color || "unassigned");
    const isColor = !payload.assetId && Boolean(payload.color);

    return (
        <span className="flex min-w-0 flex-1 items-center gap-2 text-sm text-slate-300">
            {payload.assetId ? (
                <span className="h-5 w-8 shrink-0 overflow-hidden rounded border border-white/10 bg-[#0f1115]">
                    {url ? (
                        <img
                            src={url}
                            alt=""
                            className="h-full w-full object-cover"
                            draggable={false}
                        />
                    ) : (
                        <span className="flex h-full w-full items-center justify-center">
                            <Image className="h-3 w-3 text-slate-600" />
                        </span>
                    )}
                </span>
            ) : isColor ? (
                <span
                    className="h-4 w-7 shrink-0 rounded border border-white/10"
                    style={{ backgroundColor: payload.color }}
                />
            ) : null}
            <span className="min-w-0 truncate">
                Set background <span className={payload.assetId || payload.color ? "text-slate-100" : "italic text-slate-500"}>{label}</span>
            </span>
        </span>
    );
}
