import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene } from "@shared/types/story";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { StorySceneEditorTabPayload } from "./storySceneEditorTabId";
import { createBlockForCommand, isInspectorFirstCommand, type ActionCommandId } from "./storyActionCommands";
import {
    buildVisibleRows,
    canAcceptChildren,
    describeBlock,
    filterOutSelectedDescendants,
    findPreviousSibling,
    getInsertionTargetAfter,
    getMoveTargetBefore,
    getMoveTargetAfter,
    getTextSegment,
    isTextEditableBlock,
    selectRange,
    updateTextPayload,
} from "./storySceneBlockUtils";
import { isInteractiveTarget, isTextInputActive } from "./storySceneDom";
import type { EditorMode } from "./storySceneEditorTypes";
import { useStorySceneClipboardHandlers } from "./useStorySceneClipboardHandlers";

const STORY_EDITOR_HISTORY_LIMIT = 100;
const DRAG_SELECT_AUTO_SCROLL_EDGE_PX = 64;
const DRAG_SELECT_AUTO_SCROLL_MAX_SPEED = 18;

type StorySceneHistoryState = {
    scene: StoryScene;
    activeBlockId: StoryBlockId | null;
    selectedBlockIds: StoryBlockId[];
    collapsedBlockIds: StoryBlockId[];
};

function cloneScene(scene: StoryScene): StoryScene {
    return JSON.parse(JSON.stringify(scene)) as StoryScene;
}

export function useStorySceneEditorController(tabId: string, payload: StorySceneEditorTabPayload | undefined) {
    const { context, isInitialized } = useWorkspace();
    const storyService = useMemo(() => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null), [context, isInitialized]);
    const uiService = useMemo(() => (context && isInitialized ? context.services.get<UIService>(Services.UI) : null), [context, isInitialized]);
    const uuidService = useMemo(() => (context && isInitialized ? context.services.get<UuidService>(Services.Uuid) : null), [context, isInitialized]);
    const characterService = useMemo(() => (context && isInitialized ? context.services.get<CharacterService>(Services.Character) : null), [context, isInitialized]);

    const storyId = payload?.storyId;
    const sceneId = payload?.sceneId;
    const rootRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const insertInputRef = useRef<HTMLTextAreaElement | null>(null);
    const textInputRef = useRef<HTMLTextAreaElement | null>(null);
    const dragSelectionStartRef = useRef<StoryBlockId | null>(null);
    const dragSelectPointerRef = useRef<{ x: number; y: number } | null>(null);
    const dragSelectAutoScrollRef = useRef<number | null>(null);
    const draggingBlockIdRef = useRef<StoryBlockId | null>(null);
    const plainPasteRequestedRef = useRef(false);
    const undoStackRef = useRef<StorySceneHistoryState[]>([]);
    const redoStackRef = useRef<StorySceneHistoryState[]>([]);
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [loading, setLoading] = useState(false);
    const [activeBlockId, setActiveBlockId] = useState<StoryBlockId | null>(payload?.activeBlockId ?? null);
    const [selectedBlockIds, setSelectedBlockIds] = useState<Set<StoryBlockId>>(() => payload?.activeBlockId ? new Set([payload.activeBlockId]) : new Set());
    const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<StoryBlockId>>(() => new Set());
    const [editorMode, setEditorMode] = useState<EditorMode>({ kind: "idle" });
    const [draggingBlockId, setDraggingBlockId] = useState<StoryBlockId | null>(null);
    const [dragSelectActive, setDragSelectActive] = useState(false);
    const [statusText, setStatusText] = useState("Action row editor. Slash and hash only trigger on the first character.");

    useEffect(() => {
        if (!storyService || !storyId) {
            setDocument(null);
            return;
        }
        let cancelled = false;
        setLoading(true);
        storyService.loadStory(storyId)
            .then(nextDocument => {
                if (!cancelled) setDocument({ ...nextDocument });
            })
            .catch(() => {
                if (!cancelled) setDocument(null);
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [storyId, storyService]);

    useEffect(() => {
        if (!storyService || !storyId) {
            return;
        }
        return storyService.onDocumentChanged(event => {
            if (event.storyId === storyId) {
                setDocument({ ...event.document });
            }
        });
    }, [storyId, storyService]);

    useEffect(() => {
        if (!characterService) {
            return;
        }
        return characterService.subscribe(() => setStatusText("Character list refreshed."));
    }, [characterService]);

    const scene = useMemo(() => (document && sceneId ? document.scenes[sceneId] ?? null : null), [document, sceneId]);
    const characters = useMemo(() => characterService?.listCharacter() ?? [], [characterService, statusText]);
    const visibleRows = useMemo(() => (scene ? buildVisibleRows(scene, collapsedBlockIds) : []), [collapsedBlockIds, document, scene]);
    const rowIndexById = useMemo(() => {
        const result = new Map<StoryBlockId, number>();
        visibleRows.forEach((row, index) => result.set(row.block.id, index));
        return result;
    }, [visibleRows]);
    const shouldRenderActiveInsertSlot = editorMode.kind === "insert" && editorMode.slot.afterBlockId !== null;
    const editorFocusKey = editorMode.kind === "insert"
        ? `insert:${editorMode.slot.focusToken}`
        : editorMode.kind === "text"
            ? `text:${editorMode.blockId}`
            : editorMode.kind;

    useEffect(() => {
        if (editorMode.kind === "insert") {
            window.requestAnimationFrame(() => insertInputRef.current?.focus());
        }
        if (editorMode.kind === "text") {
            window.requestAnimationFrame(() => {
                textInputRef.current?.focus();
                textInputRef.current?.select();
            });
        }
    }, [editorFocusKey]);

    const extendDragSelectionAtPoint = useCallback((x: number, y: number) => {
        const startBlockId = dragSelectionStartRef.current;
        if (!startBlockId) {
            return;
        }
        const target = globalThis.document
            .elementFromPoint(x, y)
            ?.closest<HTMLElement>("[data-story-row-block-id]");
        const blockId = target?.dataset.storyRowBlockId;
        if (blockId && scene?.blocks[blockId]) {
            setSelectedBlockIds(selectRange(visibleRows, startBlockId, blockId));
            setActiveBlockId(blockId);
        }
    }, [scene, visibleRows]);

    const stopDragSelection = useCallback(() => {
        if (dragSelectAutoScrollRef.current !== null) {
            window.cancelAnimationFrame(dragSelectAutoScrollRef.current);
            dragSelectAutoScrollRef.current = null;
        }
        dragSelectPointerRef.current = null;
        setDragSelectActive(false);
        dragSelectionStartRef.current = null;
    }, []);

    const runDragSelectAutoScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        const pointer = dragSelectPointerRef.current;
        if (!container || !pointer || !dragSelectionStartRef.current) {
            dragSelectAutoScrollRef.current = null;
            return;
        }

        const rect = container.getBoundingClientRect();
        let delta = 0;
        if (pointer.y < rect.top + DRAG_SELECT_AUTO_SCROLL_EDGE_PX) {
            const distance = rect.top + DRAG_SELECT_AUTO_SCROLL_EDGE_PX - pointer.y;
            delta = -Math.min(DRAG_SELECT_AUTO_SCROLL_MAX_SPEED, Math.ceil(distance / 4));
        } else if (pointer.y > rect.bottom - DRAG_SELECT_AUTO_SCROLL_EDGE_PX) {
            const distance = pointer.y - (rect.bottom - DRAG_SELECT_AUTO_SCROLL_EDGE_PX);
            delta = Math.min(DRAG_SELECT_AUTO_SCROLL_MAX_SPEED, Math.ceil(distance / 4));
        }

        if (delta !== 0) {
            container.scrollTop += delta;
            extendDragSelectionAtPoint(pointer.x, pointer.y);
        }

        dragSelectAutoScrollRef.current = window.requestAnimationFrame(runDragSelectAutoScroll);
    }, [extendDragSelectionAtPoint]);

    const startDragSelectAutoScroll = useCallback(() => {
        if (dragSelectAutoScrollRef.current === null) {
            dragSelectAutoScrollRef.current = window.requestAnimationFrame(runDragSelectAutoScroll);
        }
    }, [runDragSelectAutoScroll]);

    useEffect(() => {
        const handleMouseMove = (event: globalThis.MouseEvent) => {
            if (!dragSelectionStartRef.current) {
                return;
            }
            dragSelectPointerRef.current = { x: event.clientX, y: event.clientY };
            extendDragSelectionAtPoint(event.clientX, event.clientY);
            startDragSelectAutoScroll();
        };
        const handleMouseUp = () => {
            stopDragSelection();
        };
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            if (dragSelectAutoScrollRef.current !== null) {
                window.cancelAnimationFrame(dragSelectAutoScrollRef.current);
                dragSelectAutoScrollRef.current = null;
            }
        };
    }, [extendDragSelectionAtPoint, startDragSelectAutoScroll, stopDragSelection]);

    const isStoryEditorFocusActive = useCallback(() => {
        if (!uiService || uiService.dialogs.getActive()) {
            return false;
        }
        const focus = uiService.focus.getFocus();
        return focus.area === FocusArea.Editor && focus.targetId === tabId;
    }, [tabId, uiService]);

    const focusWorkspace = useCallback(() => {
        if (uiService?.dialogs.getActive()) {
            return;
        }
        uiService?.focus.setFocus(FocusArea.Editor, tabId);
    }, [tabId, uiService]);

    const focusRoot = useCallback(() => {
        focusWorkspace();
        if (uiService?.dialogs.getActive()) {
            return;
        }
        rootRef.current?.focus();
    }, [focusWorkspace, uiService]);

    const captureHistoryState = useCallback((): StorySceneHistoryState | null => {
        if (!scene) {
            return null;
        }
        return {
            scene: cloneScene(scene),
            activeBlockId,
            selectedBlockIds: [...selectedBlockIds],
            collapsedBlockIds: [...collapsedBlockIds],
        };
    }, [activeBlockId, collapsedBlockIds, scene, selectedBlockIds]);

    const recordHistory = useCallback(() => {
        const state = captureHistoryState();
        if (!state) {
            return false;
        }
        undoStackRef.current.push(state);
        if (undoStackRef.current.length > STORY_EDITOR_HISTORY_LIMIT) {
            undoStackRef.current.shift();
        }
        redoStackRef.current = [];
        return true;
    }, [captureHistoryState]);

    const restoreHistoryState = useCallback((state: StorySceneHistoryState, label: string) => {
        if (!storyService || !storyId || !sceneId) {
            return;
        }
        storyService.replaceScene(storyId, sceneId, state.scene);
        setActiveBlockId(state.activeBlockId);
        setSelectedBlockIds(new Set(state.selectedBlockIds));
        setCollapsedBlockIds(new Set(state.collapsedBlockIds));
        setEditorMode({ kind: "idle" });
        setStatusText(label);
    }, [sceneId, storyId, storyService]);

    const undoEdit = useCallback(() => {
        const previous = undoStackRef.current.pop();
        if (!previous) {
            setStatusText("Nothing to undo.");
            return;
        }
        const current = captureHistoryState();
        if (current) {
            redoStackRef.current.push(current);
        }
        restoreHistoryState(previous, "Undid edit.");
    }, [captureHistoryState, restoreHistoryState]);

    const redoEdit = useCallback(() => {
        const next = redoStackRef.current.pop();
        if (!next) {
            setStatusText("Nothing to redo.");
            return;
        }
        const current = captureHistoryState();
        if (current) {
            undoStackRef.current.push(current);
        }
        restoreHistoryState(next, "Redid edit.");
    }, [captureHistoryState, restoreHistoryState]);

    const updateBlockPayloadFor = useCallback((blockId: StoryBlockId, payload: StoryBlock["payload"]) => {
        if (storyService && storyId && sceneId) {
            const currentPayload = scene?.blocks[blockId]?.payload;
            if (currentPayload && JSON.stringify(currentPayload) === JSON.stringify(payload)) {
                return;
            }
            recordHistory();
            storyService.updateBlock(storyId, sceneId, blockId, payload);
        }
    }, [recordHistory, scene, sceneId, storyId, storyService]);

    const commitTextEdit = useCallback(() => {
        if (editorMode.kind !== "text" || !storyService || !storyId || !sceneId || !scene) {
            setEditorMode({ kind: "idle" });
            return;
        }
        const block = scene.blocks[editorMode.blockId];
        const payload = block ? updateTextPayload(block, editorMode.value) : null;
        if (payload) {
            const changed = JSON.stringify(block.payload) !== JSON.stringify(payload);
            if (!changed) {
                setEditorMode({ kind: "idle" });
                return;
            }
            recordHistory();
            storyService.updateBlock(storyId, sceneId, editorMode.blockId, payload);
        }
        setEditorMode({ kind: "idle" });
    }, [editorMode, recordHistory, scene, sceneId, storyId, storyService]);

    const createBlock = useCallback((kind: ActionCommandId, initialText = "", characterId?: string): StoryBlock | null => {
        if (!uuidService) {
            return null;
        }
        const block = createBlockForCommand(kind, () => uuidService.generate(), initialText, characterId);
        if (block.kind === "jump" && !block.payload.targetSceneId && document) {
            block.payload.targetSceneId = Object.keys(document.scenes)[0] ?? "";
        }
        return block;
    }, [document, uuidService]);

    const insertBlock = useCallback((block: StoryBlock, afterBlockId: StoryBlockId | null, openInspector = false, options?: { recordHistory?: boolean }) => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        if (options?.recordHistory !== false) {
            recordHistory();
        }
        storyService.insertBlock(storyId, sceneId, block, getInsertionTargetAfter(scene, afterBlockId));
        setActiveBlockId(block.id);
        setSelectedBlockIds(new Set([block.id]));
        setStatusText(`Inserted ${describeBlock(block, characters)}.`);
        setEditorMode(openInspector ? { kind: "inspector", blockId: block.id } : { kind: "idle" });
    }, [characters, recordHistory, scene, sceneId, storyId, storyService]);

    const insertDialogueAfterCurrentTextEdit = useCallback(() => {
        if (editorMode.kind !== "text" || !storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const currentBlock = scene.blocks[editorMode.blockId];
        if (!currentBlock || currentBlock.kind !== "nodeAction" || currentBlock.payload.action !== "dialogue") {
            return;
        }
        recordHistory();
        const updatedPayload = updateTextPayload(currentBlock, editorMode.value);
        if (updatedPayload) {
            storyService.updateBlock(storyId, sceneId, currentBlock.id, updatedPayload);
        }
        const block = createBlock("dialogue", "", currentBlock.payload.characterId);
        if (!block) {
            return;
        }
        insertBlock(block, currentBlock.id, false, { recordHistory: false });
        setEditorMode({ kind: "text", blockId: block.id, value: "" });
    }, [createBlock, editorMode, insertBlock, recordHistory, scene, sceneId, storyId, storyService]);

    const startInsertAfter = useCallback((afterBlockId: StoryBlockId | null, focus = true) => {
        setEditorMode({ kind: "insert", slot: { afterBlockId, focusToken: Date.now() }, value: "", chooser: "none" });
        if (afterBlockId) {
            setActiveBlockId(afterBlockId);
        }
        if (focus) {
            window.requestAnimationFrame(() => insertInputRef.current?.focus());
        }
    }, []);

    const commitNarrationFromInsert = useCallback((focusNext: boolean) => {
        if (editorMode.kind !== "insert") {
            return;
        }
        if (!editorMode.value.trim()) {
            setEditorMode({ kind: "idle" });
            return;
        }
        const block = createBlock("narration", editorMode.value);
        if (!block) {
            return;
        }
        insertBlock(block, editorMode.slot.afterBlockId);
        if (focusNext) {
            startInsertAfter(block.id, true);
        }
    }, [createBlock, editorMode, insertBlock, startInsertAfter]);

    const handleInsertValueChange = useCallback((value: string) => {
        setEditorMode(current => current.kind !== "insert" ? current : { ...current, value, chooser: value.startsWith("/") ? "action" : value.startsWith("#") ? "character" : "none" });
    }, []);

    const chooseCommand = useCallback((commandId: ActionCommandId) => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const block = createBlock(commandId, editorMode.value.replace(/^\/\S*\s?/, ""));
        if (!block) {
            return;
        }
        insertBlock(block, editorMode.slot.afterBlockId, isInspectorFirstCommand(commandId));
        if (!isInspectorFirstCommand(commandId) && isTextEditableBlock(block)) {
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
        }
    }, [createBlock, editorMode, insertBlock]);

    const chooseCharacterForInsert = useCallback((characterId: string) => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const block = createBlock("dialogue", editorMode.value.replace(/^#\s*/, ""), characterId);
        if (block) {
            insertBlock(block, editorMode.slot.afterBlockId);
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
        }
    }, [createBlock, editorMode, insertBlock]);

    const createActionFromSidebar = useCallback((commandId: ActionCommandId) => {
        const block = createBlock(commandId, "");
        if (!block) {
            return;
        }
        insertBlock(block, activeBlockId, isInspectorFirstCommand(commandId));
        if (!isInspectorFirstCommand(commandId) && isTextEditableBlock(block)) {
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
        }
    }, [activeBlockId, createBlock, insertBlock]);

    const setDialogueCharacter = useCallback((block: StoryBlock, characterId: string | undefined) => {
        if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
            updateBlockPayloadFor(block.id, { ...block.payload, characterId });
        }
    }, [updateBlockPayloadFor]);

    const selectRow = useCallback((blockId: StoryBlockId, event?: MouseEvent) => {
        setActiveBlockId(blockId);
        if (event?.shiftKey && activeBlockId) {
            setSelectedBlockIds(selectRange(visibleRows, activeBlockId, blockId));
            return;
        }
        if (event?.ctrlKey || event?.metaKey) {
            setSelectedBlockIds(previous => {
                const next = new Set(previous);
                next.has(blockId) ? next.delete(blockId) : next.add(blockId);
                return next.size > 0 ? next : new Set([blockId]);
            });
            return;
        }
        setSelectedBlockIds(new Set([blockId]));
    }, [activeBlockId, visibleRows]);

    const beginDragSelection = useCallback((blockId: StoryBlockId, event: MouseEvent) => {
        if (event.button !== 0 || isInteractiveTarget(event.target)) {
            return;
        }
        selectRow(blockId, event);
        dragSelectPointerRef.current = { x: event.clientX, y: event.clientY };
        dragSelectionStartRef.current = blockId;
        setDragSelectActive(true);
        startDragSelectAutoScroll();
    }, [selectRow, startDragSelectAutoScroll]);

    const extendDragSelection = useCallback((blockId: StoryBlockId) => {
        if (dragSelectActive && dragSelectionStartRef.current) {
            setSelectedBlockIds(selectRange(visibleRows, dragSelectionStartRef.current, blockId));
            setActiveBlockId(blockId);
        }
    }, [dragSelectActive, visibleRows]);

    const startDraggingBlock = useCallback((blockId: StoryBlockId) => {
        draggingBlockIdRef.current = blockId;
        setDraggingBlockId(blockId);
        setActiveBlockId(blockId);
        setSelectedBlockIds(new Set([blockId]));
    }, []);

    const endDraggingBlock = useCallback(() => {
        draggingBlockIdRef.current = null;
        setDraggingBlockId(null);
    }, []);

    const toggleCollapsed = useCallback((blockId: StoryBlockId) => {
        setCollapsedBlockIds(previous => {
            const next = new Set(previous);
            next.has(blockId) ? next.delete(blockId) : next.add(blockId);
            return next;
        });
    }, []);

    const { copySelectionToClipboard, handlePaste } = useStorySceneClipboardHandlers({
        storyService,
        uuidService,
        storyId,
        sceneId,
        scene,
        characters,
        selectedBlockIds,
        activeBlockId,
        visibleRows,
        plainPasteRequestedRef,
        recordHistory,
        setActiveBlockId,
        setSelectedBlockIds,
        setEditorMode,
        setStatusText,
    });

    const handleCopy = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
        if (!isStoryEditorFocusActive()) {
            return;
        }
        copySelectionToClipboard(event);
    }, [copySelectionToClipboard, isStoryEditorFocusActive]);

    const handlePasteInEditor = useCallback((event: ClipboardEvent<HTMLDivElement>) => {
        if (!isStoryEditorFocusActive()) {
            return;
        }
        handlePaste(event);
    }, [handlePaste, isStoryEditorFocusActive]);

    const deleteSelection = useCallback(async (options?: { confirmMultiple?: boolean }) => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        if (ids.length === 0) {
            return;
        }
        if (options?.confirmMultiple && ids.length > 1) {
            if (!uiService) {
                setStatusText("Could not confirm row deletion.");
                return;
            }
            const confirmed = await uiService.showConfirm(
                `Delete ${ids.length} selected rows?`,
                "This removes the selected script rows and their children.",
            );
            if (!confirmed) {
                return;
            }
        }
        const roots = filterOutSelectedDescendants(scene, ids);
        if (roots.length === 0) {
            return;
        }
        recordHistory();
        roots.forEach(id => storyService.deleteBlock(storyId, sceneId, id));
        setSelectedBlockIds(new Set());
        setActiveBlockId(null);
        setEditorMode({ kind: "idle" });
        setStatusText(`Deleted ${roots.length} row${roots.length === 1 ? "" : "s"}.`);
    }, [activeBlockId, recordHistory, scene, sceneId, selectedBlockIds, storyId, storyService, uiService]);

    const indentSelection = useCallback((direction: "in" | "out") => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        const roots = filterOutSelectedDescendants(scene, ids);
        if (roots.length === 0) {
            return;
        }
        let recorded = false;
        const recordOnce = () => {
            if (!recorded) {
                recordHistory();
                recorded = true;
            }
        };
        for (const id of roots) {
            const block = scene.blocks[id];
            if (!block) continue;
            if (direction === "in") {
                const previous = findPreviousSibling(scene, id);
                if (previous && canAcceptChildren(previous)) {
                    recordOnce();
                    storyService.moveBlock(storyId, sceneId, id, { parentId: previous.id });
                }
            } else if (block.parentId) {
                const parent = scene.blocks[block.parentId];
                const grandParentId = parent?.parentId ?? null;
                const parentSiblings = grandParentId ? scene.blocks[grandParentId]?.childrenIds : scene.rootBlockIds;
                const beforeBlockId = parentSiblings?.[parentSiblings.indexOf(block.parentId) + 1] ?? null;
                recordOnce();
                storyService.moveBlock(storyId, sceneId, id, { parentId: grandParentId, beforeBlockId });
            }
        }
    }, [activeBlockId, recordHistory, scene, sceneId, selectedBlockIds, storyId, storyService]);

    const startInsertAfterActive = useCallback(() => {
        startInsertAfter(activeBlockId, true);
    }, [activeBlockId, startInsertAfter]);

    const selectAllRows = useCallback(() => {
        setSelectedBlockIds(new Set(visibleRows.map(row => row.block.id)));
    }, [visibleRows]);

    const moveActiveRowSelection = useCallback((direction: "up" | "down") => {
        const currentIndex = activeBlockId ? rowIndexById.get(activeBlockId) ?? -1 : -1;
        const nextIndex = direction === "down"
            ? Math.min(visibleRows.length - 1, currentIndex + 1)
            : Math.max(0, currentIndex - 1);
        const next = visibleRows[nextIndex];
        if (next) {
            setActiveBlockId(next.block.id);
            setSelectedBlockIds(new Set([next.block.id]));
        }
    }, [activeBlockId, rowIndexById, visibleRows]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (!isStoryEditorFocusActive()) {
            return;
        }
        if (isTextInputActive()) {
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
            plainPasteRequestedRef.current = true;
            return;
        }
    }, [isStoryEditorFocusActive]);

    const moveDraggedBlockAfter = useCallback((draggedBlockId: StoryBlockId | null, targetBlockId: StoryBlockId) => {
        const movingBlockId = draggedBlockId ?? draggingBlockIdRef.current ?? draggingBlockId;
        if (!movingBlockId || movingBlockId === targetBlockId || !storyService || !storyId || !sceneId || !scene) {
            draggingBlockIdRef.current = null;
            setDraggingBlockId(null);
            return;
        }
        try {
            recordHistory();
            storyService.moveBlock(storyId, sceneId, movingBlockId, getMoveTargetAfter(scene, movingBlockId, targetBlockId));
            setActiveBlockId(movingBlockId);
            setSelectedBlockIds(new Set([movingBlockId]));
            setStatusText("Moved row.");
        } catch (error) {
            setStatusText(error instanceof Error ? error.message : "Could not move row.");
        }
        draggingBlockIdRef.current = null;
        setDraggingBlockId(null);
    }, [draggingBlockId, recordHistory, scene, sceneId, storyId, storyService]);

    const moveDraggedBlockToSortablePosition = useCallback((draggedBlockId: StoryBlockId, targetBlockId: StoryBlockId) => {
        if (draggedBlockId === targetBlockId || !storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const fromIndex = rowIndexById.get(draggedBlockId);
        const toIndex = rowIndexById.get(targetBlockId);
        if (fromIndex === undefined || toIndex === undefined || fromIndex === toIndex) {
            return;
        }
        const target = fromIndex < toIndex
            ? getMoveTargetAfter(scene, draggedBlockId, targetBlockId)
            : getMoveTargetBefore(scene, draggedBlockId, targetBlockId);
        try {
            recordHistory();
            storyService.moveBlock(storyId, sceneId, draggedBlockId, target);
            setActiveBlockId(draggedBlockId);
            setSelectedBlockIds(new Set([draggedBlockId]));
            setStatusText("Moved row.");
        } catch (error) {
            setStatusText(error instanceof Error ? error.message : "Could not move row.");
        }
    }, [recordHistory, rowIndexById, scene, sceneId, storyId, storyService]);

    return {
        context, isInitialized, document, scene, loading,
        activeBlockId, selectedBlockIds, collapsedBlockIds, editorMode,
        characters, visibleRows, shouldRenderActiveInsertSlot,
        rootRef, scrollContainerRef, insertInputRef, textInputRef, uuidService,
        focusRoot, focusWorkspace, handleKeyDown, copySelectionToClipboard: handleCopy, handlePaste: handlePasteInEditor,
        deleteSelection, startInsertAfter, selectRow, beginDragSelection,
        extendDragSelection, toggleCollapsed, setEditorMode, updateBlockPayloadFor,
        setDialogueCharacter, commitTextEdit, handleInsertValueChange,
        undoEdit, redoEdit,
        startInsertAfterActive, indentSelection, selectAllRows, moveActiveRowSelection,
        insertDialogueAfterCurrentTextEdit, commitNarrationFromInsert, chooseCommand, chooseCharacterForInsert,
        createActionFromSidebar,
        moveDraggedBlockAfter, moveDraggedBlockToSortablePosition, startDraggingBlock, endDraggingBlock,
    };
}
