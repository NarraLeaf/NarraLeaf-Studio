import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent } from "react";
import type { StoryBlock, StoryBlockId, StoryDocument } from "@shared/types/story";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import type { StorySceneEditorTabPayload } from "./storySceneEditorTabId";
import { createBlockForCommand, isInspectorFirstCommand, type ActionCommandId } from "./storyActionCommands";
import {
    buildVisibleRows,
    canAcceptChildren,
    describeBlock,
    filterOutSelectedDescendants,
    findPreviousSibling,
    getInsertionTargetAfter,
    getMoveTargetAfter,
    getTextSegment,
    isTextEditableBlock,
    selectRange,
    updateTextPayload,
} from "./storySceneBlockUtils";
import { isInteractiveTarget, isTextInputActive } from "./storySceneDom";
import type { EditorMode } from "./storySceneEditorTypes";
import { useStorySceneClipboardHandlers } from "./useStorySceneClipboardHandlers";

export function useStorySceneEditorController(payload: StorySceneEditorTabPayload | undefined) {
    const { context, isInitialized } = useWorkspace();
    const storyService = useMemo(() => (context && isInitialized ? context.services.get<StoryService>(Services.Story) : null), [context, isInitialized]);
    const uuidService = useMemo(() => (context && isInitialized ? context.services.get<UuidService>(Services.Uuid) : null), [context, isInitialized]);
    const characterService = useMemo(() => (context && isInitialized ? context.services.get<CharacterService>(Services.Character) : null), [context, isInitialized]);

    const storyId = payload?.storyId;
    const sceneId = payload?.sceneId;
    const rootRef = useRef<HTMLDivElement | null>(null);
    const insertInputRef = useRef<HTMLTextAreaElement | null>(null);
    const textInputRef = useRef<HTMLTextAreaElement | null>(null);
    const dragSelectionStartRef = useRef<StoryBlockId | null>(null);
    const draggingBlockIdRef = useRef<StoryBlockId | null>(null);
    const plainPasteRequestedRef = useRef(false);
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

    useEffect(() => {
        const handleMouseUp = () => {
            setDragSelectActive(false);
            dragSelectionStartRef.current = null;
        };
        window.addEventListener("mouseup", handleMouseUp);
        return () => window.removeEventListener("mouseup", handleMouseUp);
    }, []);

    const focusRoot = useCallback(() => rootRef.current?.focus(), []);

    const updateBlockPayloadFor = useCallback((blockId: StoryBlockId, payload: StoryBlock["payload"]) => {
        if (storyService && storyId && sceneId) {
            storyService.updateBlock(storyId, sceneId, blockId, payload);
        }
    }, [sceneId, storyId, storyService]);

    const commitTextEdit = useCallback(() => {
        if (editorMode.kind !== "text" || !storyService || !storyId || !sceneId || !scene) {
            setEditorMode({ kind: "idle" });
            return;
        }
        const block = scene.blocks[editorMode.blockId];
        const payload = block ? updateTextPayload(block, editorMode.value) : null;
        if (payload) {
            storyService.updateBlock(storyId, sceneId, editorMode.blockId, payload);
        }
        setEditorMode({ kind: "idle" });
    }, [editorMode, scene, sceneId, storyId, storyService]);

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

    const insertBlock = useCallback((block: StoryBlock, afterBlockId: StoryBlockId | null, openInspector = false) => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        storyService.insertBlock(storyId, sceneId, block, getInsertionTargetAfter(scene, afterBlockId));
        setActiveBlockId(block.id);
        setSelectedBlockIds(new Set([block.id]));
        setStatusText(`Inserted ${describeBlock(block, characters)}.`);
        setEditorMode(openInspector ? { kind: "inspector", blockId: block.id } : { kind: "idle" });
    }, [characters, scene, sceneId, storyId, storyService]);

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
        dragSelectionStartRef.current = blockId;
        setDragSelectActive(true);
    }, [selectRow]);

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
        setActiveBlockId,
        setSelectedBlockIds,
        setEditorMode,
        setStatusText,
    });

    const deleteSelection = useCallback(() => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        const roots = filterOutSelectedDescendants(scene, ids);
        roots.forEach(id => storyService.deleteBlock(storyId, sceneId, id));
        if (roots.length > 0) {
            setSelectedBlockIds(new Set());
            setActiveBlockId(null);
            setEditorMode({ kind: "idle" });
            setStatusText(`Deleted ${roots.length} row${roots.length === 1 ? "" : "s"}.`);
        }
    }, [activeBlockId, scene, sceneId, selectedBlockIds, storyId, storyService]);

    const indentSelection = useCallback((direction: "in" | "out") => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        for (const id of filterOutSelectedDescendants(scene, ids)) {
            const block = scene.blocks[id];
            if (!block) continue;
            if (direction === "in") {
                const previous = findPreviousSibling(scene, id);
                if (previous && canAcceptChildren(previous)) storyService.moveBlock(storyId, sceneId, id, { parentId: previous.id });
            } else if (block.parentId) {
                const parent = scene.blocks[block.parentId];
                const grandParentId = parent?.parentId ?? null;
                const parentSiblings = grandParentId ? scene.blocks[grandParentId]?.childrenIds : scene.rootBlockIds;
                const beforeBlockId = parentSiblings?.[parentSiblings.indexOf(block.parentId) + 1] ?? null;
                storyService.moveBlock(storyId, sceneId, id, { parentId: grandParentId, beforeBlockId });
            }
        }
    }, [activeBlockId, scene, sceneId, selectedBlockIds, storyId, storyService]);

    const handleKeyDown = useCallback((event: KeyboardEvent<HTMLDivElement>) => {
        if (isTextInputActive()) {
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "v") {
            plainPasteRequestedRef.current = true;
            return;
        }
        if (event.key === "Enter") {
            event.preventDefault();
            startInsertAfter(activeBlockId, true);
            return;
        }
        if (event.key === "Delete" || event.key === "Backspace") {
            event.preventDefault();
            deleteSelection();
            return;
        }
        if (event.key === "Tab") {
            event.preventDefault();
            indentSelection(event.shiftKey ? "out" : "in");
            return;
        }
        if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "a") {
            event.preventDefault();
            setSelectedBlockIds(new Set(visibleRows.map(row => row.block.id)));
            return;
        }
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            const currentIndex = activeBlockId ? rowIndexById.get(activeBlockId) ?? -1 : -1;
            const nextIndex = event.key === "ArrowDown" ? Math.min(visibleRows.length - 1, currentIndex + 1) : Math.max(0, currentIndex - 1);
            const next = visibleRows[nextIndex];
            if (next) {
                setActiveBlockId(next.block.id);
                setSelectedBlockIds(new Set([next.block.id]));
            }
        }
    }, [activeBlockId, deleteSelection, indentSelection, rowIndexById, startInsertAfter, visibleRows]);

    const moveDraggedBlockAfter = useCallback((draggedBlockId: StoryBlockId | null, targetBlockId: StoryBlockId) => {
        const movingBlockId = draggedBlockId ?? draggingBlockIdRef.current ?? draggingBlockId;
        if (!movingBlockId || movingBlockId === targetBlockId || !storyService || !storyId || !sceneId || !scene) {
            draggingBlockIdRef.current = null;
            setDraggingBlockId(null);
            return;
        }
        try {
            storyService.moveBlock(storyId, sceneId, movingBlockId, getMoveTargetAfter(scene, movingBlockId, targetBlockId));
            setActiveBlockId(movingBlockId);
            setSelectedBlockIds(new Set([movingBlockId]));
            setStatusText("Moved row.");
        } catch (error) {
            setStatusText(error instanceof Error ? error.message : "Could not move row.");
        }
        draggingBlockIdRef.current = null;
        setDraggingBlockId(null);
    }, [draggingBlockId, scene, sceneId, storyId, storyService]);

    return {
        context, isInitialized, document, scene, loading,
        activeBlockId, selectedBlockIds, collapsedBlockIds, editorMode,
        characters, visibleRows, shouldRenderActiveInsertSlot,
        rootRef, insertInputRef, textInputRef, uuidService,
        focusRoot, handleKeyDown, copySelectionToClipboard, handlePaste,
        deleteSelection, startInsertAfter, selectRow, beginDragSelection,
        extendDragSelection, toggleCollapsed, setEditorMode, updateBlockPayloadFor,
        setDialogueCharacter, commitTextEdit, handleInsertValueChange,
        commitNarrationFromInsert, chooseCommand, chooseCharacterForInsert,
        moveDraggedBlockAfter, startDraggingBlock, endDraggingBlock,
    };
}
