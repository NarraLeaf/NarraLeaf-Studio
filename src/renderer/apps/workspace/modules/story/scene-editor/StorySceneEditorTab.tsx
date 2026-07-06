import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FileText, Image as ImageIcon, ListPlus, Plus, Trash2 } from "lucide-react";
import { closestCenter, DndContext, PointerSensor, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useKeybindings, whenEditorFocused, type KeybindingDefinition } from "@/apps/workspace/hooks";
import type { EditorComponentProps } from "../../types";
import { PanelPosition } from "../../../registry/types";
import { Services } from "@/lib/workspace/services/services";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { StoryDocument, StoryScene, StorySceneUpdate } from "@shared/types/story";
import type { Asset } from "@/lib/workspace/services/assets/types";
import { AssetType } from "@/lib/workspace/services/assets/assetTypes";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { useAssetObjectUrl } from "@/lib/workspace/hooks/useAssetObjectUrl";
import { AssetSelector } from "@/apps/workspace/modules/assets/components/AssetSelector";
import type { StorySceneEditorTabPayload } from "./storySceneEditorTabId";
import { StoryActionCreatorPanel } from "./StoryActionCreatorPanel";
import {
    STORY_ACTION_CREATE_REQUEST_EVENT,
    STORY_ACTION_CREATOR_PANEL_ID,
    type StoryActionCreateRequestDetail,
} from "./storyActionCreatorEvents";
import { STORY_MOTION_PANEL_ID } from "../../story-motion";
import { InsertRow, StoryBlockRow } from "./StorySceneEditorRows";
import { getTextSegment } from "./storySceneBlockUtils";
import { useStorySceneEditorController } from "./useStorySceneEditorController";

const SCENE_FIELD_LABEL_CLASS = "mb-1 block text-[11px] font-medium text-slate-500";
const SCENE_TEXT_FIELD_CLASS = "w-full rounded-md border border-white/10 bg-[#16181d] px-3 py-2 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-600 focus:border-primary/50";

function StorySceneOverviewBlock(props: {
    document: StoryDocument;
    scene: StoryScene;
    backgroundAsset: Asset<AssetType.Image> | null;
    onUpdateScene: (patch: StorySceneUpdate) => boolean;
}) {
    const { document, scene, backgroundAsset, onUpdateScene } = props;
    const [nameValue, setNameValue] = useState(scene.name);
    const [descriptionValue, setDescriptionValue] = useState(scene.description ?? "");
    const [selectorOpen, setSelectorOpen] = useState(false);
    const selectButtonRef = useRef<HTMLButtonElement | null>(null);
    const backgroundAssetId = scene.defaultBackgroundAssetId ?? null;
    const { url, loading, error } = useAssetObjectUrl(backgroundAssetId);

    useEffect(() => {
        setNameValue(scene.name);
        setDescriptionValue(scene.description ?? "");
    }, [scene.description, scene.name]);

    const commitName = useCallback(() => {
        const nextName = nameValue.trim() || scene.name || "Untitled Scene";
        const changed = onUpdateScene({ name: nextName });
        if (!changed) {
            setNameValue(scene.name);
        }
    }, [nameValue, onUpdateScene, scene.name]);

    const commitDescription = useCallback(() => {
        const nextDescription = descriptionValue.trim();
        const changed = onUpdateScene({ description: nextDescription });
        if (!changed) {
            setDescriptionValue(scene.description ?? "");
        }
    }, [descriptionValue, onUpdateScene, scene.description]);

    const handleSelectBackground = useCallback((assets: Asset[]) => {
        const selected = assets[0];
        if (!selected) {
            return;
        }
        onUpdateScene({ defaultBackgroundAssetId: selected.id });
        setSelectorOpen(false);
    }, [onUpdateScene]);

    const clearBackground = useCallback(() => {
        onUpdateScene({ defaultBackgroundAssetId: null });
    }, [onUpdateScene]);

    const backgroundLabel = backgroundAsset?.name ?? (backgroundAssetId ? "Missing image" : "No background");

    return (
        <div className="mx-3 mb-3 rounded-lg border border-white/10 bg-white/[0.025] p-3">
            <div
                className="grid items-start gap-3"
                style={{ gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 340px), 1fr))" }}
            >
                <button
                    type="button"
                    className="group relative aspect-[16/9] min-h-40 overflow-hidden rounded-md border border-white/10 bg-[#101216] text-left focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/70"
                    onClick={() => setSelectorOpen(true)}
                    title={backgroundAssetId ? "Change default background" : "Select default background"}
                >
                    {url ? (
                        <img src={url} alt="" className="absolute inset-0 h-full w-full object-cover" draggable={false} />
                    ) : (
                        <div className="flex h-full w-full flex-col items-center justify-center gap-2 text-sm text-slate-500">
                            <ImageIcon className="h-6 w-6 text-slate-600" />
                            <span className="max-w-[80%] truncate">{backgroundLabel}</span>
                        </div>
                    )}
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center bg-black/45 text-xs text-slate-100">
                            Loading...
                        </div>
                    ) : null}
                    <div className="absolute inset-x-0 bottom-0 flex min-h-9 items-center justify-between gap-2 bg-black/55 px-3 py-2 text-xs text-slate-200 backdrop-blur-sm">
                        <span className="min-w-0 truncate">{backgroundLabel}</span>
                        <span className="shrink-0 text-primary opacity-0 transition-opacity group-hover:opacity-100">
                            {backgroundAssetId ? "Change" : "Select"}
                        </span>
                    </div>
                </button>

                <div className="grid min-w-0 gap-3">
                    <div>
                        <div className="mb-2 flex min-w-0 items-center gap-2">
                            <FileText className="h-4 w-4 shrink-0 text-primary" />
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium text-white">{document.name}</div>
                                <div className="truncate text-[11px] text-slate-500">{scene.runtimeName || scene.id}</div>
                            </div>
                        </div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>Scene name</label>
                        <input
                            className={SCENE_TEXT_FIELD_CLASS}
                            value={nameValue}
                            maxLength={120}
                            onChange={event => setNameValue(event.target.value)}
                            onBlur={commitName}
                            onKeyDown={event => {
                                if (event.key === "Enter") {
                                    event.preventDefault();
                                    event.currentTarget.blur();
                                }
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setNameValue(scene.name);
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </div>

                    <div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>Description</label>
                        <textarea
                            className={`${SCENE_TEXT_FIELD_CLASS} min-h-20 resize-y leading-relaxed`}
                            value={descriptionValue}
                            rows={3}
                            maxLength={600}
                            placeholder="No description"
                            onChange={event => setDescriptionValue(event.target.value)}
                            onBlur={commitDescription}
                            onKeyDown={event => {
                                if (event.key === "Escape") {
                                    event.preventDefault();
                                    setDescriptionValue(scene.description ?? "");
                                    event.currentTarget.blur();
                                }
                            }}
                        />
                    </div>

                    <div>
                        <label className={SCENE_FIELD_LABEL_CLASS}>Default background</label>
                        <div className="flex gap-2">
                            <button
                                ref={selectButtonRef}
                                type="button"
                                className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-md border border-white/10 bg-[#16181d] px-3 text-left text-sm text-gray-300 hover:border-primary/40"
                                onClick={() => setSelectorOpen(true)}
                            >
                                <ImageIcon className="h-3.5 w-3.5 shrink-0 text-slate-500" />
                                <span className={["truncate", backgroundAsset ? "" : "italic text-gray-500"].join(" ")}>
                                    {backgroundLabel}
                                </span>
                            </button>
                            <button
                                type="button"
                                className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-white/10 bg-white/[0.04] text-slate-400 hover:border-red-400/40 hover:text-red-300 disabled:cursor-not-allowed disabled:opacity-40"
                                disabled={!backgroundAssetId}
                                title="Clear background"
                                onClick={clearBackground}
                            >
                                <Trash2 className="h-3.5 w-3.5" />
                            </button>
                        </div>
                        {backgroundAssetId && error ? (
                            <div className="mt-1 text-[11px] text-amber-400/90">
                                Image asset could not be resolved: {error}
                            </div>
                        ) : null}
                    </div>
                </div>
            </div>

            <AssetSelector
                visible={selectorOpen}
                assetType={AssetType.Image}
                onClose={() => setSelectorOpen(false)}
                onConfirm={handleSelectBackground}
                selectedIds={backgroundAssetId ? [backgroundAssetId] : []}
                anchorRef={selectButtonRef}
                title="Select Default Background"
                multiple={false}
            />
        </div>
    );
}

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
        if (!editor.isInitialized || !editor.context || !payload?.storyId || !payload.sceneId) {
            return;
        }
        const uiService = editor.context.services.get<UIService>(Services.UI);
        uiService.panels.updatePayload(STORY_MOTION_PANEL_ID, {
            storyId: payload.storyId,
            sceneId: payload.sceneId,
            blockId: editor.activeBlockId ?? undefined,
            storyName: editor.document?.name,
            sceneName: editor.scene?.name,
        });
    }, [editor.activeBlockId, editor.context, editor.document?.name, editor.isInitialized, editor.scene?.name, payload?.sceneId, payload?.storyId]);

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
    const assetsService = editor.context.services.get<AssetsService>(Services.Assets);
    const backgroundAsset = scene.defaultBackgroundAssetId
        ? assetsService.getAssets()[AssetType.Image]?.[scene.defaultBackgroundAssetId] ?? null
        : null;
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
                <StorySceneOverviewBlock
                    document={document}
                    scene={scene}
                    backgroundAsset={backgroundAsset}
                    onUpdateScene={editor.updateSceneMetadata}
                />
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
                                    textInputRef={editor.textInputRef}
                                    inspectorOpen={editor.editorMode.kind === "inspector" && editor.editorMode.blockId === row.block.id}
                                    onSelect={event => editor.selectRow(row.block.id, event)}
                                    onMouseDown={event => editor.beginDragSelection(row.block.id, event)}
                                    onMouseEnter={() => editor.extendDragSelection(row.block.id)}
                                    onToggleCollapsed={() => editor.toggleCollapsed(row.block.id)}
                                    onStartTextEdit={() => {
                                        const text = getTextSegment(row.block);
                                        if (text) {
                                            editor.setEditorMode({ kind: "text", blockId: row.block.id, value: text.value, rich: text.rich });
                                        }
                                    }}
                                    onEditRichChange={(value, rich) =>
                                        editor.setEditorMode(current =>
                                            current.kind === "text" && current.blockId === row.block.id
                                                ? { ...current, value, rich }
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
