import { FileText, Plus } from "lucide-react";
import type { EditorComponentProps } from "../../types";
import type { StorySceneEditorTabPayload } from "./storySceneEditorTabId";
import { InsertRow, StoryBlockRow } from "./StorySceneEditorRows";
import { getTextSegment } from "./storySceneBlockUtils";
import { useStorySceneEditorController } from "./useStorySceneEditorController";

export function StorySceneEditorTab({ payload }: EditorComponentProps<StorySceneEditorTabPayload | undefined>) {
    const editor = useStorySceneEditorController(payload);

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

    return (
        <div
            ref={editor.rootRef}
            tabIndex={0}
            className="flex h-full min-h-0 flex-col bg-[#0d0f12] text-slate-100 outline-none"
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

            <div className="min-h-0 flex-1 overflow-auto py-2" onMouseDown={editor.focusRoot}>
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
                            onOpenInspector={() => editor.setEditorMode({ kind: "inspector", blockId: row.block.id })}
                            onCloseInspector={() => editor.setEditorMode({ kind: "idle" })}
                            onUpdatePayload={payload => editor.updateBlockPayloadFor(row.block.id, payload)}
                            onSetDialogueCharacter={characterId => editor.setDialogueCharacter(row.block, characterId)}
                            generateTextId={() => editor.uuidService?.generate() ?? `text-${Date.now()}`}
                            onInsertAfter={() => editor.startInsertAfter(row.block.id, true)}
                            onDragStart={editor.startDraggingBlock}
                            onDragEnd={editor.endDraggingBlock}
                            onDropAfter={draggedBlockId => editor.moveDraggedBlockAfter(draggedBlockId, row.block.id)}
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
                ) : (
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
