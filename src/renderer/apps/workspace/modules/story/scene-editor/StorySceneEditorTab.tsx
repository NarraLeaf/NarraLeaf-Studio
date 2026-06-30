import { useEffect, useMemo } from "react";
import { FileText, ListPlus, Plus } from "lucide-react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useKeybindings, whenEditorFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import type { EditorComponentProps } from "../../types";
import { PanelPosition } from "../../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { StorySceneEditorTabPayload } from "./storySceneEditorTabId";
import { StoryActionCreatorPanel } from "./StoryActionCreatorPanel";
import {
    STORY_ACTION_CREATE_REQUEST_EVENT,
    STORY_ACTION_CREATOR_PANEL_ID,
    type StoryActionCreateRequestDetail,
} from "./storyActionCreatorEvents";
import { InsertRow, StoryBlockRow } from "./StorySceneEditorRows";
import { getTextSegment } from "./storySceneBlockUtils";
import { useStorySceneEditorController } from "./useStorySceneEditorController";

export function StorySceneEditorTab({ tabId, payload }: EditorComponentProps<StorySceneEditorTabPayload | undefined>) {
    const editor = useStorySceneEditorController(tabId, payload);
    const sensors = useSensors(
        useSensor(PointerSensor),
    );
    const keybindings = useMemo<KeybindingDefinition[]>(() => [
        {
            id: "delete",
            key: "delete",
            description: "Delete selected story rows",
            handler: () => {
                void editor.deleteSelection({ confirmMultiple: false });
            },
        },
        {
            id: "backspace",
            key: "backspace",
            description: "Delete selected story rows with multi-select confirmation",
            handler: () => {
                void editor.deleteSelection({ confirmMultiple: true });
            },
        },
        {
            id: "undo",
            key: "ctrl+z",
            description: "Undo story scene edit",
            handler: editor.undoEdit,
        },
        {
            id: "redo",
            key: "ctrl+shift+z",
            description: "Redo story scene edit",
            handler: editor.redoEdit,
        },
        {
            id: "insert-after-active",
            key: "enter",
            description: "Insert a story row after the active row",
            handler: editor.startInsertAfterActive,
        },
        {
            id: "indent",
            key: "tab",
            description: "Indent selected story rows",
            handler: () => editor.indentSelection("in"),
        },
        {
            id: "outdent",
            key: "shift+tab",
            description: "Outdent selected story rows",
            handler: () => editor.indentSelection("out"),
        },
        {
            id: "select-all-ctrl",
            key: "ctrl+a",
            description: "Select all visible story rows",
            handler: editor.selectAllRows,
        },
        {
            id: "select-all-meta",
            key: "meta+a",
            description: "Select all visible story rows",
            handler: editor.selectAllRows,
        },
        {
            id: "move-selection-down",
            key: "arrowdown",
            description: "Move story row selection down",
            handler: () => editor.moveActiveRowSelection("down"),
        },
        {
            id: "move-selection-up",
            key: "arrowup",
            description: "Move story row selection up",
            handler: () => editor.moveActiveRowSelection("up"),
        },
    ], [
        editor.deleteSelection,
        editor.indentSelection,
        editor.moveActiveRowSelection,
        editor.redoEdit,
        editor.selectAllRows,
        editor.startInsertAfterActive,
        editor.undoEdit,
    ]);

    useKeybindings({
        keybindings,
        enabled: editor.isInitialized && Boolean(editor.context && payload?.storyId && payload.sceneId),
        when: whenEditorFocused(tabId),
        idPrefix: `story-scene-editor-${tabId}`,
    });

    useEffect(() => {
        if (!editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        const unregister = uiService.panels.register({
            id: STORY_ACTION_CREATOR_PANEL_ID,
            title: "Actions",
            icon: <ListPlus className="w-4 h-4" />,
            position: PanelPosition.Right,
            component: StoryActionCreatorPanel,
            defaultVisible: false,
            order: 10,
            payload: {
                tabId,
                storyId: payload.storyId,
                sceneId: payload.sceneId,
            },
        });
        return () => {
            uiService.panels.hide(STORY_ACTION_CREATOR_PANEL_ID);
            unregister();
        };
    }, [editor.context, editor.isInitialized, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        if (!editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_ACTION_CREATOR_PANEL_ID, {
            tabId,
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId, tabId]);

    useEffect(() => {
        const handleCreateRequest = (event: Event) => {
            const detail = (event as CustomEvent<StoryActionCreateRequestDetail>).detail;
            if (detail?.tabId !== tabId) {
                return;
            }
            editor.createActionFromSidebar(detail.commandId);
        };
        window.addEventListener(STORY_ACTION_CREATE_REQUEST_EVENT, handleCreateRequest);
        return () => window.removeEventListener(STORY_ACTION_CREATE_REQUEST_EVENT, handleCreateRequest);
    }, [editor.createActionFromSidebar, tabId]);

    if (!editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
                Story scene editor tab is invalid.
            </div>
        );
    }

    if (editor.loading) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-gray-400">
                Loading story scene...
            </div>
        );
    }

    const document = editor.document;
    const scene = editor.scene;

    if (!document || !scene) {
        return (
            <div className="flex h-full items-center justify-center p-6 text-sm text-amber-300">
                Story or scene not found.
            </div>
        );
    }

    const lastVisibleRowId = editor.visibleRows[editor.visibleRows.length - 1]?.block.id ?? null;
    const isInsertingAfterLastRow = editor.editorMode.kind === "insert" && editor.editorMode.slot.afterBlockId === lastVisibleRowId;
    const sortableRowIds = editor.visibleRows.map(row => row.block.id);
    const handleDragEnd = (event: DragEndEvent) => {
        const activeId = String(event.active.id);
        const overId = event.over ? String(event.over.id) : null;
        if (!overId || activeId === overId) {
            return;
        }
        editor.moveDraggedBlockToSortablePosition(activeId, overId);
    };

    return (
        <div
            ref={editor.rootRef}
            tabIndex={0}
            className="flex h-full min-h-0 flex-col bg-[#0d0f12] text-slate-100 outline-none"
            onFocus={editor.focusWorkspace}
            onKeyDown={editor.handleKeyDown}
            onCopy={editor.copySelectionToClipboard}
            onPaste={editor.handlePaste}
        >
            <div className="flex min-h-[44px] items-center gap-3 border-b border-white/10 px-3">
                <div className="flex min-w-0 items-center gap-2">
                    <FileText className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-white">{scene.name}</div>
                        <div className="truncate text-[11px] text-slate-400">{document.name}</div>
                    </div>
                </div>
            </div>

            <div ref={editor.scrollContainerRef} className="min-h-0 flex-1 overflow-auto py-2" onMouseDown={editor.focusRoot}>
                <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                    <SortableContext items={sortableRowIds} strategy={verticalListSortingStrategy}>
                        {editor.visibleRows.map(row => (
                            <div key={row.block.id}>
                                <StoryBlockRow
                                    row={row}
                                    scene={scene}
                                    document={document}
                                    characters={editor.characters}
                                    selected={editor.selectedBlockIds.has(row.block.id)}
                                    active={editor.activeBlockId === row.block.id}
                                    collapsed={editor.collapsedBlockIds.has(row.block.id)}
                                    editing={editor.editorMode.kind === "text" && editor.editorMode.blockId === row.block.id}
                                    editValue={editor.editorMode.kind === "text" && editor.editorMode.blockId === row.block.id ? editor.editorMode.value : ""}
                                    textInputRef={editor.textInputRef}
                                    inspectorOpen={editor.editorMode.kind === "inspector" && editor.editorMode.blockId === row.block.id}
                                    onSelect={event => editor.selectRow(row.block.id, event)}
                                    onMouseDown={event => editor.beginDragSelection(row.block.id, event)}
                                    onMouseEnter={() => editor.extendDragSelection(row.block.id)}
                                    onToggleCollapsed={() => editor.toggleCollapsed(row.block.id)}
                                    onStartTextEdit={() => {
                                        const text = getTextSegment(row.block);
                                        if (text) {
                                            editor.setEditorMode({ kind: "text", blockId: row.block.id, value: text.value });
                                        }
                                    }}
                                    onEditValueChange={value =>
                                        editor.setEditorMode(current =>
                                            current.kind === "text" && current.blockId === row.block.id
                                                ? { ...current, value }
                                                : current,
                                        )
                                    }
                                    onCommitTextEdit={editor.commitTextEdit}
                                    onCancelTextEdit={() => editor.setEditorMode({ kind: "idle" })}
                                    onInsertDialogueAfterCurrent={editor.insertDialogueAfterCurrentTextEdit}
                                    onOpenInspector={() => editor.setEditorMode({ kind: "inspector", blockId: row.block.id })}
                                    onCloseInspector={() => editor.setEditorMode({ kind: "idle" })}
                                    onUpdatePayload={payload => editor.updateBlockPayloadFor(row.block.id, payload)}
                                    onSetDialogueCharacter={characterId => editor.setDialogueCharacter(row.block, characterId)}
                                    generateTextId={() => editor.uuidService?.generate() ?? crypto.randomUUID()}
                                    onInsertAfter={() => editor.startInsertAfter(row.block.id, true)}
                                />
                                {editor.shouldRenderActiveInsertSlot && editor.editorMode.kind === "insert" && editor.editorMode.slot.afterBlockId === row.block.id ? (
                                    <InsertRow
                                        mode={editor.editorMode}
                                        characters={editor.characters}
                                        inputRef={editor.insertInputRef}
                                        onValueChange={editor.handleInsertValueChange}
                                        onCommitNarration={focusNext => editor.commitNarrationFromInsert(focusNext)}
                                        onCancelActionChooser={() => editor.commitNarrationFromInsert(false)}
                                        onChooseCommand={editor.chooseCommand}
                                        onChooseCharacter={editor.chooseCharacterForInsert}
                                    />
                                ) : null}
                            </div>
                        ))}
                    </SortableContext>
                </DndContext>
                {editor.editorMode.kind === "insert" && editor.editorMode.slot.afterBlockId === null ? (
                    <InsertRow
                        mode={editor.editorMode}
                        characters={editor.characters}
                        inputRef={editor.insertInputRef}
                        onValueChange={editor.handleInsertValueChange}
                        onCommitNarration={focusNext => editor.commitNarrationFromInsert(focusNext)}
                        onCancelActionChooser={() => editor.commitNarrationFromInsert(false)}
                        onChooseCommand={editor.chooseCommand}
                        onChooseCharacter={editor.chooseCharacterForInsert}
                    />
                ) : isInsertingAfterLastRow ? null : (
                    <button
                        type="button"
                        className="ml-[72px] mt-1 flex min-h-[32px] w-[calc(100%-96px)] items-center gap-2 px-2 text-left text-sm italic text-slate-500 hover:bg-white/[0.04] hover:text-slate-300"
                        onClick={() => editor.startInsertAfter(null, true)}
                    >
                        <Plus className="h-4 w-4 text-primary" />
                        Click or type to add a row...
                    </button>
                )}
            </div>
        </div>
    );
}
