import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import type { StoryBlock, StoryBlockId, StoryDocument, StoryScene, StorySceneUpdate } from "@shared/types/story";
import { translate } from "@/lib/i18n";
import { useWorkspace } from "../../../context";
import { Services } from "@/lib/workspace/services/services";
import type { CharacterService } from "@/lib/workspace/services/core/CharacterService";
import type { PanelStateService } from "@/lib/workspace/services/core/PanelStateService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import type { UuidService } from "@/lib/workspace/services/core/UuidService";
import type { StoryService } from "@/lib/workspace/services/story/StoryService";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { StorySceneEditorTabPayload } from "./storySceneEditorTabId";
import { createBlockForCommand, isActionCommandId, isInspectorFirstCommand, type ActionCommandId } from "./storyActionCommands";
import type { AssetsService } from "@/lib/workspace/services/core/AssetsService";
import { applyCommandArgs } from "./storyCommandApply";
import { buildStoryCommandContext } from "./storyCommandContext";
import { canCommit, parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine } from "./storyCommandResolution";
import { collectTempSpeakers, promoteTempSpeaker } from "@/lib/workspace/services/story/storyModel";
import { CHARACTERS_PANEL_ID } from "../../characters";
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
import { getStoryEditorViewState, patchStoryEditorViewState } from "./storyEditorSessionStore";
import { cloneSerializedBlock, insertSerializedClone, serializeBlockSubtree } from "./storySceneClipboard";
import { getSelectionUnitRange, richRunsToPlain } from "./richText";
import type { RichTextInputHandle } from "./RichTextInput";
import type { EditorMode, StoryBlockTarget } from "./storySceneEditorTypes";
import { useStorySceneClipboardHandlers } from "./useStorySceneClipboardHandlers";

const STORY_EDITOR_HISTORY_LIMIT = 100;
/** Rows the selection jumps by on PageUp / PageDown. */
const STORY_EDITOR_PAGE_ROWS = 10;
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
    const assetsService = useMemo(() => (context && isInitialized ? context.services.get<AssetsService>(Services.Assets) : null), [context, isInitialized]);
    // Per-project persistent store for the editor's view state (focus/selection/scroll). Available on
    // the first render — the workspace only mounts editors once services (incl. this one) are ready.
    const panelStateService = useMemo(() => (context && isInitialized ? context.services.get<PanelStateService>(Services.PanelState) : null), [context, isInitialized]);

    const storyId = payload?.storyId;
    const sceneId = payload?.sceneId;
    const rootRef = useRef<HTMLDivElement | null>(null);
    const scrollContainerRef = useRef<HTMLDivElement | null>(null);
    const insertInputRef = useRef<HTMLTextAreaElement | null>(null);
    const textInputRef = useRef<RichTextInputHandle | null>(null);
    const dragSelectionStartRef = useRef<StoryBlockId | null>(null);
    // Set while a press that landed on a row's text is still undecided: the browser is painting a
    // native text selection, and the mouseup (or the drag leaving this row) settles what it meant.
    const textSelectRef = useRef<{ blockId: StoryBlockId; textEl: HTMLElement } | null>(null);
    const dragSelectPointerRef = useRef<{ x: number; y: number } | null>(null);
    const dragSelectAutoScrollRef = useRef<number | null>(null);
    const draggingBlockIdRef = useRef<StoryBlockId | null>(null);
    // Anchor row for keyboard range-selection (Shift+Arrow grows the selection from here).
    const selectionAnchorRef = useRef<StoryBlockId | null>(null);
    const plainPasteRequestedRef = useRef(false);
    /**
     * True between discarding an insert slot and the state update landing. Escape's last rung moves
     * focus, which blurs the slot in the same tick — and blur commits prose. Without this the ladder's
     * "leaving an uncommitted slot creates nothing" would be false for every line that reached it.
     */
    const slotDiscardedRef = useRef(false);
    const undoStackRef = useRef<StorySceneHistoryState[]>([]);
    const redoStackRef = useRef<StorySceneHistoryState[]>([]);
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [loading, setLoading] = useState(false);
    // Seed the focused row + selection from the persisted view state so switching tabs/pages (which
    // fully unmounts the editor) — and restarting Studio — keeps the author's place. An explicit
    // `payload.activeBlockId` (e.g. deep-link navigation to a block) wins over the remembered focus.
    const [activeBlockId, setActiveBlockId] = useState<StoryBlockId | null>(() => {
        if (payload?.activeBlockId) {
            return payload.activeBlockId;
        }
        return (panelStateService && sceneId ? getStoryEditorViewState(panelStateService, sceneId)?.activeBlockId : null) ?? null;
    });
    const [selectedBlockIds, setSelectedBlockIds] = useState<Set<StoryBlockId>>(() => {
        if (payload?.activeBlockId) {
            return new Set([payload.activeBlockId]);
        }
        const saved = panelStateService && sceneId ? getStoryEditorViewState(panelStateService, sceneId)?.selectedBlockIds : undefined;
        return new Set(saved ?? []);
    });
    const [collapsedBlockIds, setCollapsedBlockIds] = useState<Set<StoryBlockId>>(() => new Set());
    const [editorMode, setEditorMode] = useState<EditorMode>({ kind: "idle" });
    const [draggingBlockId, setDraggingBlockId] = useState<StoryBlockId | null>(null);
    const [dragSelectActive, setDragSelectActive] = useState(false);
    const [, setStatusText] = useState("Action row editor. Slash and hash only trigger on the first character.");
    const [characterRevision, setCharacterRevision] = useState(0);

    // Persist the focused row + selection so they survive the tab unmounting when the author switches
    // away and a Studio restart (paired with the seed above and the scroll persistence in the tab).
    useEffect(() => {
        if (!sceneId || !panelStateService) {
            return;
        }
        patchStoryEditorViewState(panelStateService, sceneId, { activeBlockId, selectedBlockIds: [...selectedBlockIds] });
    }, [panelStateService, sceneId, activeBlockId, selectedBlockIds]);

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
        return characterService.subscribe(() => {
            setCharacterRevision(revision => revision + 1);
            setStatusText("Character list refreshed.");
        });
    }, [characterService]);

    const scene = useMemo(() => (document && sceneId ? document.scenes[sceneId] ?? null : null), [document, sceneId]);
    /**
     * Temp speakers alive anywhere in this story, offered back as candidates. Derived from the
     * document rather than stored, so one goes away exactly when its last line does — and so a name
     * used earlier in the story is findable later without anyone maintaining a registry.
     */
    const tempSpeakers = useMemo(() => (document ? collectTempSpeakers(document) : []), [document]);
    const characters = useMemo(() => characterService?.listCharacter() ?? [], [characterRevision, characterService]);

    /** What a name typed on the command line may refer to. Rebuilt as the project changes under it. */
    const commandContext = useMemo(
        () => buildStoryCommandContext({ assets: assetsService?.getAssets(), characters, document, scene }),
        [assetsService, characters, document, scene],
    );
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

    /**
     * Let the rows paint a native text selection again. Written straight to the node rather than
     * through state so a drag never re-renders the list mid-gesture — and so this can be called from
     * the teardown paths (mouseup, pointercancel, window blur) that must not be able to leave the
     * editor stuck with unselectable text.
     *
     * Toggles a class rather than an inline `user-select`: the rows carry `.nl-selectable-text`, an
     * explicit value that an inherited one from this root cannot override — see the rule in
     * `styles.css`.
     */
    const setRowTextSelectable = useCallback((selectable: boolean) => {
        rootRef.current?.classList.toggle("nl-text-select-suspended", !selectable);
    }, []);

    /**
     * Mouse released without leaving the row. A real selection opens the row for editing carrying
     * that selection (this is also how double-click-to-edit lands: the word the browser selected on
     * the second press is the selection we hand over). A collapsed one was a plain click, and the row
     * is already selected from the press.
     *
     * Every mouse gesture on a row therefore rests on the browser being *allowed* to select the row's
     * text: the app resets `user-select: none` onto everything, so the rows opt back in with
     * `.nl-selectable-text` (see `renderRowText`). Without that opt-in the selection here is always
     * collapsed, this bails every time, and the row simply never opens — which is exactly how
     * double-click-to-edit was broken while every unit test passed. jsdom implements neither
     * `user-select` nor native selection, so nothing but driving the real app can catch it.
     */
    const finishTextSelectGesture = useCallback((pending: { blockId: StoryBlockId; textEl: HTMLElement }) => {
        const range = getSelectionUnitRange(pending.textEl);
        if (!range || range.start === range.end) {
            return;
        }
        const block = scene?.blocks[pending.blockId];
        if (!block || !isTextEditableBlock(block)) {
            return;
        }
        const segment = getTextSegment(block);
        setEditorMode({ kind: "text", blockId: pending.blockId, value: segment?.value ?? "", rich: segment?.rich, caret: range });
    }, [scene]);

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

    /**
     * The drag that began on a row's text has left that row: the author is selecting rows, not prose.
     * Drop the native selection, stop the browser from painting a new one, and hand the gesture over
     * to the row-range drag as if it had started on the gutter.
     */
    const escalateTextSelectToRowDrag = useCallback((blockId: StoryBlockId, x: number, y: number) => {
        textSelectRef.current = null;
        globalThis.window.getSelection()?.removeAllRanges();
        setRowTextSelectable(false);
        dragSelectPointerRef.current = { x, y };
        dragSelectionStartRef.current = blockId;
        setDragSelectActive(true);
        startDragSelectAutoScroll();
        extendDragSelectionAtPoint(x, y);
    }, [extendDragSelectionAtPoint, setRowTextSelectable, startDragSelectAutoScroll]);

    useEffect(() => {
        const handleMouseMove = (event: globalThis.MouseEvent) => {
            const pending = textSelectRef.current;
            if (pending) {
                const overRow = globalThis.document
                    .elementFromPoint(event.clientX, event.clientY)
                    ?.closest<HTMLElement>("[data-story-row-block-id]");
                if (overRow && overRow.dataset.storyRowBlockId !== pending.blockId) {
                    escalateTextSelectToRowDrag(pending.blockId, event.clientX, event.clientY);
                }
                return;
            }
            if (!dragSelectionStartRef.current) {
                return;
            }
            dragSelectPointerRef.current = { x: event.clientX, y: event.clientY };
            extendDragSelectionAtPoint(event.clientX, event.clientY);
            startDragSelectAutoScroll();
        };
        const handleMouseUp = () => {
            const pending = textSelectRef.current;
            textSelectRef.current = null;
            if (pending) {
                finishTextSelectGesture(pending);
            }
            setRowTextSelectable(true);
            stopDragSelection();
        };
        // Backstops for a gesture that never gets its mouseup — the pointer taken away by the OS, or
        // the window losing focus mid-drag. They abandon the gesture rather than complete it (losing
        // focus is not a decision to open a row), but they must still hand text selection back, or
        // the rows stay permanently unselectable.
        const cancelGesture = () => {
            textSelectRef.current = null;
            setRowTextSelectable(true);
            stopDragSelection();
        };
        window.addEventListener("mousemove", handleMouseMove);
        window.addEventListener("mouseup", handleMouseUp);
        window.addEventListener("pointercancel", cancelGesture);
        window.addEventListener("blur", cancelGesture);
        return () => {
            window.removeEventListener("mousemove", handleMouseMove);
            window.removeEventListener("mouseup", handleMouseUp);
            window.removeEventListener("pointercancel", cancelGesture);
            window.removeEventListener("blur", cancelGesture);
            setRowTextSelectable(true);
            if (dragSelectAutoScrollRef.current !== null) {
                window.cancelAnimationFrame(dragSelectAutoScrollRef.current);
                dragSelectAutoScrollRef.current = null;
            }
        };
    }, [escalateTextSelectToRowDrag, extendDragSelectionAtPoint, finishTextSelectGesture, setRowTextSelectable, startDragSelectAutoScroll, stopDragSelection]);

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

    const focusRoot = useCallback((event?: MouseEvent<HTMLElement>) => {
        focusWorkspace();
        if (event && isInteractiveTarget(event.target)) {
            return;
        }
        if (uiService?.dialogs.getActive()) {
            return;
        }
        rootRef.current?.focus();
    }, [focusWorkspace, uiService]);

    // Make a block the active/selected row (used by deep-link navigation). Scrolling the row into
    // view and moving DOM focus is handled by the tab, which owns the rendered row elements.
    const revealBlock = useCallback((blockId: StoryBlockId): boolean => {
        if (!scene?.blocks[blockId]) {
            return false;
        }
        setActiveBlockId(blockId);
        setSelectedBlockIds(new Set([blockId]));
        selectionAnchorRef.current = blockId;
        return true;
    }, [scene]);

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
        uiService?.editor.update(tabId, { title: state.scene.name });
        setActiveBlockId(state.activeBlockId);
        setSelectedBlockIds(new Set(state.selectedBlockIds));
        setCollapsedBlockIds(new Set(state.collapsedBlockIds));
        setEditorMode({ kind: "idle" });
        setStatusText(label);
    }, [sceneId, storyId, storyService, tabId, uiService]);

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

    const updateSceneMetadata = useCallback((patch: StorySceneUpdate): boolean => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return false;
        }

        const nextName = patch.name !== undefined ? patch.name.trim() || scene.name || translate("story.sceneEditor.defaultSceneName") : scene.name;
        const nextDescription = patch.description !== undefined ? patch.description.trim() : scene.description ?? "";
        const nextBackgroundAssetId = patch.defaultBackgroundAssetId !== undefined
            ? patch.defaultBackgroundAssetId?.trim() || undefined
            : scene.defaultBackgroundAssetId;

        const hasNameChange = patch.name !== undefined && nextName !== scene.name;
        const hasDescriptionChange = patch.description !== undefined && nextDescription !== (scene.description ?? "");
        const hasBackgroundChange = patch.defaultBackgroundAssetId !== undefined && nextBackgroundAssetId !== (scene.defaultBackgroundAssetId ?? undefined);
        if (!hasNameChange && !hasDescriptionChange && !hasBackgroundChange) {
            return false;
        }

        recordHistory();
        const changed = storyService.updateScene(storyId, sceneId, {
            ...patch,
            name: patch.name !== undefined ? nextName : undefined,
            description: patch.description !== undefined ? nextDescription : undefined,
            defaultBackgroundAssetId: patch.defaultBackgroundAssetId !== undefined ? nextBackgroundAssetId ?? null : undefined,
        });
        if (changed) {
            if (hasNameChange) {
                uiService?.editor.update(tabId, { title: nextName });
            }
            setStatusText("Updated scene details.");
        }
        return changed;
    }, [recordHistory, scene, sceneId, storyId, storyService, tabId, uiService]);

    const commitTextEdit = useCallback(() => {
        if (editorMode.kind !== "text" || !storyService || !storyId || !sceneId || !scene) {
            setEditorMode({ kind: "idle" });
            return;
        }
        const block = scene.blocks[editorMode.blockId];
        // Prefer the live editor DOM so a popover edit (e.g. binding an inline blueprint) that hasn't
        // flushed into the draft is still committed — otherwise it is lost when we navigate away.
        const liveRuns = textInputRef.current?.getRuns();
        const value = liveRuns ? richRunsToPlain(liveRuns) : editorMode.value;
        const rich = liveRuns ?? editorMode.rich;
        const payload = block ? updateTextPayload(block, value, rich) : null;
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

    const insertBlock = useCallback((block: StoryBlock, afterBlockId: StoryBlockId | null, openInspector = false, options?: { recordHistory?: boolean; target?: StoryBlockTarget }) => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        if (options?.recordHistory !== false) {
            recordHistory();
        }
        // An explicit target ("add inside a container") overrides the default sibling-after placement.
        storyService.insertBlock(storyId, sceneId, block, options?.target ?? getInsertionTargetAfter(scene, afterBlockId));
        setActiveBlockId(block.id);
        setSelectedBlockIds(new Set([block.id]));
        setStatusText(`Inserted ${describeBlock(block, characters, scene, document?.scenes)}.`);
        setEditorMode(openInspector ? { kind: "inspector", blockId: block.id } : { kind: "idle" });
    }, [characters, document, recordHistory, scene, sceneId, storyId, storyService]);

    // Insert a `layer` create block immediately before `beforeBlockId` at the same nesting level and
    // return its id, without stealing focus from the currently-open inspector. Used by the Layer
    // picker's "Create new layer" action so an image/text can bind to a fresh layer inline.
    const createLayerBeforeBlock = useCallback((beforeBlockId: StoryBlockId): StoryBlockId | null => {
        if (!storyService || !storyId || !sceneId || !scene || !uuidService) {
            return null;
        }
        const target = scene.blocks[beforeBlockId];
        if (!target) {
            return null;
        }
        const block = createBlockForCommand("layerCreate", () => uuidService.generate());
        if (block.kind === "action" && block.payload.action === "layer") {
            block.payload.objectName = nextLayerName(scene);
        }
        recordHistory();
        storyService.insertBlock(storyId, sceneId, block, { parentId: target.parentId, beforeBlockId });
        return block.id;
    }, [recordHistory, scene, sceneId, storyId, storyService, uuidService]);

    const startInsertAfter = useCallback((afterBlockId: StoryBlockId | null, focus = true) => {
        slotDiscardedRef.current = false;
        setEditorMode({ kind: "insert", slot: { afterBlockId, focusToken: Date.now() }, value: "", chooser: "none" });
        if (afterBlockId) {
            setActiveBlockId(afterBlockId);
        }
        if (focus) {
            window.requestAnimationFrame(() => insertInputRef.current?.focus());
        }
    }, []);

    /** Expand a collapsed container so a just-added child / insert slot is actually visible. */
    const ensureExpanded = useCallback((blockId: StoryBlockId) => {
        setCollapsedBlockIds(prev => {
            if (!prev.has(blockId)) {
                return prev;
            }
            const next = new Set(prev);
            next.delete(blockId);
            return next;
        });
    }, []);

    // Open an insert slot that parents the new block at the END of `parentId` (the "add action inside a
    // container" affordance). The slot renders after the container's last visible child (or, when empty,
    // right under the container header), and commits into `parentId` via the slot target.
    const startInsertInside = useCallback((parentId: StoryBlockId) => {
        if (!scene) {
            return;
        }
        const parent = scene.blocks[parentId];
        if (!parent) {
            return;
        }
        ensureExpanded(parentId);
        const lastChildId = parent.childrenIds[parent.childrenIds.length - 1] ?? null;
        // Every path that opens a slot must clear this, or a discard earlier in the session would go on
        // silently swallowing this slot's blur-commit.
        slotDiscardedRef.current = false;
        setEditorMode({
            kind: "insert",
            slot: { afterBlockId: lastChildId ?? parentId, focusToken: Date.now(), target: { parentId, beforeBlockId: null } },
            value: "",
            chooser: "none",
        });
        setActiveBlockId(parentId);
        window.requestAnimationFrame(() => insertInputRef.current?.focus());
    }, [ensureExpanded, scene]);

    // Append a menu option to a choice container and open it for text entry.
    const addMenuOption = useCallback((choiceId: StoryBlockId) => {
        if (!scene) {
            return;
        }
        const parent = scene.blocks[choiceId];
        if (!parent) {
            return;
        }
        const block = createBlock("choiceOption");
        if (!block) {
            return;
        }
        ensureExpanded(choiceId);
        insertBlock(block, null, false, { target: { parentId: choiceId, beforeBlockId: null } });
        setEditorMode({ kind: "text", blockId: block.id, value: "" });
    }, [createBlock, ensureExpanded, insertBlock, scene]);

    // Append an if / else-if / else branch to a condition container. "else" is unique and always last;
    // "else if" is inserted before an existing else (or at the end).
    const addConditionBranch = useCallback((conditionId: StoryBlockId, branch: "if" | "elseIf" | "else") => {
        if (!scene) {
            return;
        }
        const parent = scene.blocks[conditionId];
        if (!parent) {
            return;
        }
        const branchBlocks = parent.childrenIds
            .map(id => scene.blocks[id])
            .filter((child): child is Extract<StoryBlock, { kind: "control" }> =>
                child?.kind === "control" && child.payload.control === "conditionBranch");
        const elseBranch = branchBlocks.find(child =>
            child.payload.control === "conditionBranch" && child.payload.branch === "else");
        if (branch === "else" && elseBranch) {
            return;
        }
        const block = createBlock("conditionBranch");
        if (!block || block.kind !== "control" || block.payload.control !== "conditionBranch") {
            return;
        }
        block.payload.branch = branch;
        const beforeBlockId = branch === "else" ? null : elseBranch?.id ?? null;
        ensureExpanded(conditionId);
        insertBlock(block, null, false, { target: { parentId: conditionId, beforeBlockId } });
    }, [createBlock, ensureExpanded, insertBlock, scene]);

    // Dispatch the container header "+ Add" affordance: a menu adds an option directly; anything else
    // opens an insert slot inside so the author picks the action.
    const addInsideContainer = useCallback((parentId: StoryBlockId) => {
        const block = scene?.blocks[parentId];
        if (block?.kind === "nodeAction" && block.payload.action === "choice") {
            addMenuOption(parentId);
            return;
        }
        startInsertInside(parentId);
    }, [addMenuOption, scene, startInsertInside]);

    // Seed a freshly-created container with its default child so the author gets a usable structure in
    // one step (Condition → an `if` branch; Menu → one option), inside the same undo entry as the parent.
    const scaffoldContainer = useCallback((block: StoryBlock) => {
        if (!storyService || !storyId || !sceneId || !uuidService) {
            return;
        }
        if (block.kind === "control" && block.payload.control === "condition") {
            const branch = createBlockForCommand("conditionBranch", () => uuidService.generate());
            storyService.insertBlock(storyId, sceneId, branch, { parentId: block.id, beforeBlockId: null });
        } else if (block.kind === "nodeAction" && block.payload.action === "choice") {
            const option = createBlockForCommand("choiceOption", () => uuidService.generate());
            storyService.insertBlock(storyId, sceneId, option, { parentId: block.id, beforeBlockId: null });
        }
    }, [sceneId, storyId, storyService, uuidService]);

    // Enter while editing a text row: commit and open a new row that continues the same kind — narration
    // begets narration, a dialogue keeps its speaker, a menu option adds a sibling option. Kinds without a
    // natural successor (e.g. a choice prompt) fall back to the generic "/"-and-"#" insert slot.
    const insertContinuationAfterCurrentTextEdit = useCallback(() => {
        if (editorMode.kind !== "text" || !storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const currentBlock = scene.blocks[editorMode.blockId];
        if (!currentBlock) {
            return;
        }
        const continuation = continuationCommandFor(currentBlock);
        if (!continuation) {
            commitTextEdit();
            startInsertAfter(editorMode.blockId, true);
            return;
        }
        recordHistory();
        // Persist the current line from the live editor DOM (captures marks/chips not yet flushed to draft).
        const liveRuns = textInputRef.current?.getRuns();
        const value = liveRuns ? richRunsToPlain(liveRuns) : editorMode.value;
        const rich = liveRuns ?? editorMode.rich;
        const updatedPayload = updateTextPayload(currentBlock, value, rich);
        if (updatedPayload) {
            storyService.updateBlock(storyId, sceneId, currentBlock.id, updatedPayload);
        }
        const characterId = currentBlock.kind === "nodeAction" && currentBlock.payload.action === "dialogue"
            ? currentBlock.payload.characterId
            : undefined;
        const block = createBlock(continuation, "", characterId);
        if (!block) {
            return;
        }
        insertBlock(block, currentBlock.id, false, { recordHistory: false });
        setEditorMode({ kind: "text", blockId: block.id, value: "", caret: "end" });
    }, [commitTextEdit, createBlock, editorMode, insertBlock, recordHistory, scene, sceneId, startInsertAfter, storyId, storyService]);

    // Arrow navigation across the row boundary while editing text. The current line is committed first;
    // landing on a text row re-opens it for editing (caret at the near edge), landing on an action row
    // just selects it and hands focus back to the keyboard so plain arrows keep walking the list.
    const navigateFromTextEdit = useCallback((direction: "up" | "down" | "left" | "right") => {
        if (editorMode.kind !== "text") {
            return;
        }
        const currentId = editorMode.blockId;
        const currentIndex = rowIndexById.get(currentId);
        commitTextEdit();
        if (currentIndex === undefined) {
            return;
        }
        const goingBack = direction === "up" || direction === "left";
        const target = visibleRows[goingBack ? currentIndex - 1 : currentIndex + 1];
        if (!target) {
            if (!goingBack) {
                // Past the last row — drop into a fresh insert slot so the author can keep writing downward.
                startInsertAfter(currentId, true);
            } else {
                setActiveBlockId(currentId);
                setSelectedBlockIds(new Set([currentId]));
                selectionAnchorRef.current = currentId;
                focusRoot();
            }
            return;
        }
        const targetBlock = target.block;
        setActiveBlockId(targetBlock.id);
        setSelectedBlockIds(new Set([targetBlock.id]));
        selectionAnchorRef.current = targetBlock.id;
        if (isTextEditableBlock(targetBlock)) {
            const segment = getTextSegment(targetBlock);
            setEditorMode({ kind: "text", blockId: targetBlock.id, value: segment?.value ?? "", rich: segment?.rich, caret: goingBack ? "end" : "start" });
        } else {
            setEditorMode({ kind: "idle" });
            focusRoot();
        }
    }, [commitTextEdit, editorMode, focusRoot, rowIndexById, startInsertAfter, visibleRows]);

    // Backspace on an empty line. An empty dialogue drops a rung to a blank insert slot in the same spot —
    // a completely empty line that can become anything (type narration, "/" for an action, "#" for another
    // speaker) rather than a committed narration row. Any other empty text row is deleted and focus steps
    // back to the line above.
    const handleBackspaceAtEmptyStart = useCallback(() => {
        if (editorMode.kind !== "text" || !storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const id = editorMode.blockId;
        const block = scene.blocks[id];
        if (!block) {
            return;
        }
        if (block.kind === "nodeAction" && block.payload.action === "dialogue") {
            // Anchor the fresh slot to the previous sibling so it reappears at the dialogue's own level and
            // position (the continuation flow that creates these always has one). A dialogue that opens its
            // container has no sibling to anchor to — fall through to the plain delete-and-step-back.
            const previousSibling = findPreviousSibling(scene, id);
            if (previousSibling) {
                recordHistory();
                storyService.deleteBlock(storyId, sceneId, id);
                startInsertAfter(previousSibling.id, true);
                return;
            }
        }
        // Don't silently delete a container row that still holds children (e.g. an empty menu option).
        if (block.childrenIds.length > 0) {
            return;
        }
        const currentIndex = rowIndexById.get(id);
        const previous = currentIndex !== undefined ? visibleRows[currentIndex - 1] : undefined;
        recordHistory();
        storyService.deleteBlock(storyId, sceneId, id);
        if (previous) {
            setActiveBlockId(previous.block.id);
            setSelectedBlockIds(new Set([previous.block.id]));
            selectionAnchorRef.current = previous.block.id;
            if (isTextEditableBlock(previous.block)) {
                const segment = getTextSegment(previous.block);
                setEditorMode({ kind: "text", blockId: previous.block.id, value: segment?.value ?? "", rich: segment?.rich, caret: "end" });
            } else {
                setEditorMode({ kind: "idle" });
                focusRoot();
            }
        } else {
            setActiveBlockId(null);
            setSelectedBlockIds(new Set());
            setEditorMode({ kind: "idle" });
            focusRoot();
        }
    }, [editorMode, focusRoot, recordHistory, rowIndexById, scene, sceneId, startInsertAfter, storyId, storyService, visibleRows]);

    // Enter on a selected-but-not-editing row: text rows open for editing (caret at the end); action rows
    // open their inspector; with nothing selected it falls back to a fresh insert slot.
    const enterEditOrInspectorForActive = useCallback(() => {
        if (!scene || !activeBlockId) {
            startInsertAfter(null, true);
            return;
        }
        const block = scene.blocks[activeBlockId];
        if (!block) {
            startInsertAfter(null, true);
            return;
        }
        if (isTextEditableBlock(block)) {
            const segment = getTextSegment(block);
            setEditorMode({ kind: "text", blockId: activeBlockId, value: segment?.value ?? "", rich: segment?.rich, caret: "end" });
        } else {
            setEditorMode({ kind: "inspector", blockId: activeBlockId });
        }
    }, [activeBlockId, scene, startInsertAfter]);

    const commitNarrationFromInsert = useCallback((focusNext: boolean) => {
        if (editorMode.kind !== "insert" || slotDiscardedRef.current) {
            return;
        }
        if (!editorMode.value.trim()) {
            setEditorMode({ kind: "idle" });
            return;
        }
        // A `/` or `#` line is never prose — it resolves to a command, or it becomes an invalid row.
        // This is reached on blur, which is the one caller that does not already know what the line is;
        // without the guard, clicking away from a half-typed `/set` lands it as narration, which is the
        // exact bug the Escape ladder was fixed to stop producing.
        if (editorMode.value.startsWith("/") || editorMode.value.startsWith("#")) {
            return;
        }
        const block = createBlock("narration", editorMode.value);
        if (!block) {
            return;
        }
        insertBlock(block, editorMode.slot.afterBlockId, false, { target: editorMode.slot.target });
        if (focusNext) {
            startInsertAfter(block.id, true);
        }
    }, [createBlock, editorMode, insertBlock, startInsertAfter]);

    const handleInsertValueChange = useCallback((value: string) => {
        setEditorMode(current => {
            if (current.kind !== "insert") {
                return current;
            }
            // Once dismissed, the chooser stays gone for the life of this slot. Without this the menu
            // would spring back on the very next keystroke, since `chooser` is derived from the prefix.
            if (current.chooserDismissed) {
                return { ...current, value, chooser: "none" };
            }
            return { ...current, value, chooser: value.startsWith("/") ? "action" : value.startsWith("#") ? "character" : "none" };
        });
    }, []);

    /** Escape, first press: drop the candidates but keep the line and the caret. */
    const dismissInsertChooser = useCallback(() => {
        setEditorMode(current => current.kind !== "insert" ? current : { ...current, chooser: "none", chooserDismissed: true });
    }, []);

    /** Escape, last press: an uncommitted slot never existed, so leaving it must not create anything. */
    const discardInsertSlot = useCallback(() => {
        // Set before anything else: `focusRoot` blurs the slot synchronously, and the blur handler's job
        // is to commit prose. The `setEditorMode` below has not flushed by then, so that commit would
        // still see the slot and land the very line this is discarding. A ref is what the blur can read
        // in the same tick; state cannot.
        slotDiscardedRef.current = true;
        setEditorMode({ kind: "idle" });
        focusRoot();
    }, [focusRoot]);

    /**
     * Commit the line as an invalid row: it did not resolve to anything, and the author's text is too
     * expensive to throw away and too wrong to quietly turn into prose. The build refuses these, so
     * nothing here can ship by accident.
     */
    const commitInvalidFromInsert = useCallback(() => {
        if (editorMode.kind !== "insert" || !uuidService) {
            return;
        }
        const source = editorMode.value;
        if (!source.trim()) {
            setEditorMode({ kind: "idle" });
            return;
        }
        const block: StoryBlock = {
            id: uuidService.generate(),
            kind: "invalid",
            parentId: null,
            childrenIds: [],
            payload: { source },
        };
        insertBlock(block, editorMode.slot.afterBlockId, false, { target: editorMode.slot.target });
        startInsertAfter(block.id, true);
    }, [editorMode, insertBlock, startInsertAfter, uuidService]);


    // Backspace on an empty insert slot: dismiss the blank line and step back onto the row above it —
    // re-entering it for editing when it holds text — so the demote ladder keeps walking upward.
    const handleInsertBackspaceEmpty = useCallback(() => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const afterId = editorMode.slot.afterBlockId;
        const afterBlock = afterId ? scene?.blocks[afterId] : null;
        if (afterId && afterBlock && isTextEditableBlock(afterBlock)) {
            const segment = getTextSegment(afterBlock);
            setActiveBlockId(afterId);
            setSelectedBlockIds(new Set([afterId]));
            selectionAnchorRef.current = afterId;
            setEditorMode({ kind: "text", blockId: afterId, value: segment?.value ?? "", rich: segment?.rich, caret: "end" });
            return;
        }
        if (afterId) {
            setActiveBlockId(afterId);
            setSelectedBlockIds(new Set([afterId]));
            selectionAnchorRef.current = afterId;
        }
        setEditorMode({ kind: "idle" });
        focusRoot();
    }, [editorMode, focusRoot, scene]);

    /**
     * Build a block from a plugin-registered story action. The registration's
     * createBlock output is normalized defensively (fresh tree linkage) so a
     * misbehaving plugin cannot corrupt the scene's block graph.
     */
    const createPluginActionBlock = useCallback((actionId: string, initialText?: string): StoryBlock | null => {
        if (!storyService || !uuidService) {
            return null;
        }
        const registration = storyService.getPluginAction(actionId);
        if (!registration) {
            uiService?.notifications.warning(`Story action is not available: ${actionId}`);
            return null;
        }
        try {
            const block = registration.createBlock({
                generateId: () => uuidService.generate(),
                ...(initialText?.trim() ? { initialText } : {}),
            });
            if (!block || typeof block !== "object" || typeof block.id !== "string" || !block.id.trim() || typeof block.kind !== "string") {
                throw new Error("createBlock must return a story block");
            }
            return {
                ...block,
                parentId: null,
                childrenIds: Array.isArray(block.childrenIds) ? block.childrenIds : [],
            };
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            uiService?.notifications.error(`Story action failed: ${registration.label} (${message})`);
            return null;
        }
    }, [storyService, uiService, uuidService]);

    const chooseCommand = useCallback((commandId: string) => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const target = editorMode.slot.target;
        const initialText = editorMode.value.replace(/^\/\S*\s?/, "");
        if (!isActionCommandId(commandId)) {
            const block = createPluginActionBlock(commandId, initialText);
            if (block) {
                insertBlock(block, editorMode.slot.afterBlockId, true, { target });
            }
            return;
        }
        const block = createBlock(commandId, initialText);
        if (!block) {
            return;
        }
        insertBlock(block, editorMode.slot.afterBlockId, isInspectorFirstCommand(commandId), { target });
        scaffoldContainer(block);
        if (!isInspectorFirstCommand(commandId) && isTextEditableBlock(block)) {
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
        }
    }, [createBlock, createPluginActionBlock, editorMode, insertBlock, scaffoldContainer]);

    const chooseCharacterForInsert = useCallback((characterId: string) => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const target = editorMode.slot.target;
        // Empty, not the typed text: everything after `#` was the speaker query (see `chooserQuery`),
        // so reusing it as the body would put the speaker's own name in their first line.
        const block = createBlock("dialogue", "", characterId);
        if (block) {
            insertBlock(block, editorMode.slot.afterBlockId, false, { target });
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
        }
    }, [createBlock, editorMode, insertBlock]);

    /**
     * Enter on a `/…` line: parse it, resolve every name it mentions, and commit the action it
     * describes — arguments and all.
     *
     * Returns false when the line does not stand on its own (unknown command, a name that resolves to
     * nothing, a value the variable cannot hold), so the caller lands an invalid row and the author's
     * text survives verbatim. Nothing half-written is ever committed as an action.
     */
    const commitCommandFromInsert = useCallback((value: string): boolean => {
        if (editorMode.kind !== "insert") {
            return false;
        }
        const line = parseCommandLine(value);
        if (line.kind !== "command" || !line.def) {
            return false;
        }
        // A command P0 gave no grammar to takes no args: it keeps the menu's behaviour, including
        // inspector-first and treating the rest of the line as initial text (`/note some words`).
        // Parsing it as arguments would only invent errors it never had.
        if (line.def.params.length === 0) {
            chooseCommand(line.def.commandId);
            return true;
        }
        if (!canCommit(line)) {
            return false;
        }
        const { args, issues } = resolveCommandLine(line, commandContext);
        if (issues.length > 0) {
            return false;
        }
        const commandId = line.def.commandId;
        const base = createBlock(commandId);
        if (!base) {
            return false;
        }
        const block = applyCommandArgs(base, commandId, args);
        insertBlock(block, editorMode.slot.afterBlockId, false, { target: editorMode.slot.target });
        scaffoldContainer(block);
        // A speaker with no line yet (`/say Alice`) lands the caret in the body, exactly as picking a
        // speaker after `#` does. A line that already carries its text moves on to the next row —
        // the command line never routes to the inspector, or it would stop the author mid-flow.
        if (isTextEditableBlock(block) && !args.text) {
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
            return true;
        }
        startInsertAfter(block.id, true);
        return true;
    }, [chooseCommand, commandContext, createBlock, editorMode, insertBlock, scaffoldContainer, startInsertAfter]);

    /**
     * Enter / Shift+Enter with no candidate to take — the chooser was dismissed, or never opened.
     * The line has to stand on its own now: prose commits, a resolvable command commits, and anything
     * still wearing a `/` or `#` becomes an invalid row rather than silently becoming prose.
     */
    const resolveInsertLine = useCallback(() => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const value = editorMode.value;
        if (!value.trim()) {
            setEditorMode({ kind: "idle" });
            return;
        }
        if (value.startsWith("/")) {
            if (!commitCommandFromInsert(value)) {
                commitInvalidFromInsert();
            }
            return;
        }
        if (value.startsWith("#")) {
            // A `#` line only becomes dialogue by picking a speaker; there is nothing else to resolve.
            commitInvalidFromInsert();
            return;
        }
        commitNarrationFromInsert(true);
    }, [commitCommandFromInsert, commitInvalidFromInsert, commitNarrationFromInsert, editorMode]);

    /**
     * Pick a speaker that no Studio character backs. Valid, not a fallback: NLR's dialogue box only
     * displays the name its Character carries (see `speakerName`). Offering the typed name back as a
     * candidate is what removes "nothing matched" as a state the editor needs an answer for.
     */
    const chooseTempSpeakerForInsert = useCallback((speakerName: string) => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const name = speakerName.trim();
        if (!name) {
            return;
        }
        const target = editorMode.slot.target;
        // Empty for the same reason as `chooseCharacterForInsert`: the post-`#` text was the name.
        const block = createBlock("dialogue", "");
        if (!block || block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
            return;
        }
        block.payload = { ...block.payload, speakerName: name, characterId: undefined };
        insertBlock(block, editorMode.slot.afterBlockId, false, { target });
        setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
    }, [createBlock, editorMode, insertBlock]);

    const createActionFromSidebar = useCallback((commandId: string) => {
        if (!isActionCommandId(commandId)) {
            const block = createPluginActionBlock(commandId);
            if (block) {
                insertBlock(block, activeBlockId, true);
            }
            return;
        }
        const block = createBlock(commandId, "");
        if (!block) {
            return;
        }
        insertBlock(block, activeBlockId, isInspectorFirstCommand(commandId));
        if (!isInspectorFirstCommand(commandId) && isTextEditableBlock(block)) {
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
        }
    }, [activeBlockId, createBlock, createPluginActionBlock, insertBlock]);

    /**
     * Point a dialogue row at a speaker: a real character, a bare name, or nobody.
     *
     * The two are mutually exclusive on purpose — a leftover `speakerName` under a real `characterId`
     * would silently win back if that character were ever deleted (see the payload's docs).
     */
    const setDialogueSpeaker = useCallback((block: StoryBlock, speaker: { characterId: string } | { speakerName: string } | null) => {
        if (block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
            return;
        }
        const { characterId: _id, speakerName: _name, ...rest } = block.payload;
        if (!speaker) {
            updateBlockPayloadFor(block.id, rest);
            return;
        }
        updateBlockPayloadFor(block.id, "characterId" in speaker
            ? { ...rest, characterId: speaker.characterId }
            : { ...rest, speakerName: speaker.speakerName });
    }, [updateBlockPayloadFor]);

    /**
     * Promote the name on a dialogue row to a real character: create it, rebind every line that used
     * the bare name, and reveal the character manager so the author can give it a face — but leave the
     * caret in the line they were writing. The manager is the destination for later, not for now.
     */
    const createCharacterFromSpeaker = useCallback((block: StoryBlock, name: string) => {
        const trimmed = name.trim();
        if (!characterService || !trimmed || block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
            return;
        }
        const created = characterService.createCharacter(trimmed);
        const characterId = created.profile.getId();
        if (document) {
            // Every other line already speaking as this name comes along; leaving them behind would
            // fork one speaker into two that merely look alike.
            promoteTempSpeaker(document, trimmed, characterId);
        }
        setDialogueSpeaker(block, { characterId });
        uiService?.panels.show(CHARACTERS_PANEL_ID);
        setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "", caret: "end" });
    }, [characterService, document, setDialogueSpeaker, uiService]);

    const selectRow = useCallback((blockId: StoryBlockId, event?: MouseEvent) => {
        setActiveBlockId(blockId);
        if (event?.shiftKey && activeBlockId) {
            setSelectedBlockIds(selectRange(visibleRows, activeBlockId, blockId));
            return;
        }
        if (event?.ctrlKey || event?.metaKey) {
            selectionAnchorRef.current = blockId;
            setSelectedBlockIds(previous => {
                const next = new Set(previous);
                next.has(blockId) ? next.delete(blockId) : next.add(blockId);
                return next.size > 0 ? next : new Set([blockId]);
            });
            return;
        }
        selectionAnchorRef.current = blockId;
        setSelectedBlockIds(new Set([blockId]));
    }, [activeBlockId, visibleRows]);

    const beginDragSelection = useCallback((blockId: StoryBlockId, event: MouseEvent) => {
        if (event.button !== 0 || isInteractiveTarget(event.target)) {
            return;
        }
        selectRow(blockId, event);
        // Pressing on a row's own text starts a *text* selection, not a row-range drag: let the
        // browser select natively and read the author's intent off the mouseup (a plain click leaves
        // the row selected; a real selection opens the row for editing with that selection intact).
        // A modified click is unambiguously a row-selection intent, so it skips this.
        const plainPress = !event.shiftKey && !event.ctrlKey && !event.metaKey && !event.altKey;
        const textEl = plainPress
            ? (event.target instanceof HTMLElement ? event.target.closest<HTMLElement>("[data-story-row-text]") : null)
            : null;
        if (textEl) {
            textSelectRef.current = { blockId, textEl };
            return;
        }
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
        scenes: document?.scenes,
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

    /**
     * The one deletion path for rows, whatever pointed at them (keyboard selection,
     * a row's hover action, …): dedupes descendants of deleted containers, records
     * one history entry, and resets selection/edit state.
     */
    const deleteRows = useCallback(async (ids: string[], options?: { confirmMultiple?: boolean }) => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        if (ids.length === 0) {
            return;
        }
        if (options?.confirmMultiple && ids.length > 1) {
            if (!uiService) {
                setStatusText("Could not confirm row deletion.");
                return;
            }
            const confirmed = await uiService.showConfirm(
                translate("story.bulkDelete.confirm", { count: ids.length }),
                translate("story.bulkDelete.detail"),
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
    }, [recordHistory, scene, sceneId, storyId, storyService, uiService]);

    const deleteSelection = useCallback(async (options?: { confirmMultiple?: boolean }) => {
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        await deleteRows(ids, options);
    }, [activeBlockId, deleteRows, selectedBlockIds]);

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

    /**
     * Shift+Enter's anchor: the last selected row in document order, not the active one. The active
     * row is the selection's head, which sits *above* its tail after Shift+ArrowUp — anchoring there
     * would drop the new row into the middle of the selection.
     */
    const startInsertAfterSelection = useCallback(() => {
        let last: StoryBlockId | null = null;
        for (const row of visibleRows) {
            if (selectedBlockIds.has(row.block.id)) {
                last = row.block.id;
            }
        }
        startInsertAfter(last ?? activeBlockId, true);
    }, [activeBlockId, selectedBlockIds, startInsertAfter, visibleRows]);

    const selectAllRows = useCallback(() => {
        setSelectedBlockIds(new Set(visibleRows.map(row => row.block.id)));
    }, [visibleRows]);

    const selectSingleRow = useCallback((blockId: StoryBlockId) => {
        setActiveBlockId(blockId);
        setSelectedBlockIds(new Set([blockId]));
        selectionAnchorRef.current = blockId;
    }, []);

    const moveActiveRowSelection = useCallback((direction: "up" | "down") => {
        if (visibleRows.length === 0) {
            return;
        }
        const currentIndex = activeBlockId ? rowIndexById.get(activeBlockId) ?? -1 : -1;
        const nextIndex = currentIndex === -1
            ? (direction === "down" ? 0 : visibleRows.length - 1)
            : direction === "down"
                ? Math.min(visibleRows.length - 1, currentIndex + 1)
                : Math.max(0, currentIndex - 1);
        const next = visibleRows[nextIndex];
        if (next) {
            selectSingleRow(next.block.id);
        }
    }, [activeBlockId, rowIndexById, selectSingleRow, visibleRows]);

    // Shift+Arrow — grow (or shrink) the selection between the anchor row and the moving head.
    const extendRowSelection = useCallback((direction: "up" | "down") => {
        if (visibleRows.length === 0) {
            return;
        }
        const anchorId = selectionAnchorRef.current ?? activeBlockId;
        const headIndex = activeBlockId ? rowIndexById.get(activeBlockId) ?? -1 : -1;
        if (!anchorId || headIndex === -1) {
            moveActiveRowSelection(direction);
            return;
        }
        selectionAnchorRef.current = anchorId;
        const nextIndex = direction === "down"
            ? Math.min(visibleRows.length - 1, headIndex + 1)
            : Math.max(0, headIndex - 1);
        const head = visibleRows[nextIndex];
        if (!head) {
            return;
        }
        setSelectedBlockIds(selectRange(visibleRows, anchorId, head.block.id));
        setActiveBlockId(head.block.id);
    }, [activeBlockId, moveActiveRowSelection, rowIndexById, visibleRows]);

    const jumpRowSelection = useCallback((edge: "first" | "last") => {
        const row = edge === "first" ? visibleRows[0] : visibleRows[visibleRows.length - 1];
        if (row) {
            selectSingleRow(row.block.id);
        }
    }, [selectSingleRow, visibleRows]);

    const pageRowSelection = useCallback((direction: "up" | "down") => {
        if (visibleRows.length === 0) {
            return;
        }
        const currentIndex = activeBlockId ? rowIndexById.get(activeBlockId) ?? -1 : -1;
        const base = currentIndex === -1 ? (direction === "down" ? -1 : visibleRows.length) : currentIndex;
        const nextIndex = direction === "down"
            ? Math.min(visibleRows.length - 1, base + STORY_EDITOR_PAGE_ROWS)
            : Math.max(0, base - STORY_EDITOR_PAGE_ROWS);
        const row = visibleRows[nextIndex];
        if (row) {
            selectSingleRow(row.block.id);
        }
    }, [activeBlockId, rowIndexById, selectSingleRow, visibleRows]);

    // Alt+Arrow — reorder the selected row among its siblings (keyboard equivalent of drag-to-reorder).
    // Deliberately single-row for predictability; multi-row keyboard moves are surprising in outliners.
    const moveSelectedRows = useCallback((direction: "up" | "down") => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        const roots = filterOutSelectedDescendants(scene, ids);
        if (roots.length !== 1) {
            return;
        }
        const id = roots[0];
        const block = scene.blocks[id];
        if (!block) {
            return;
        }
        const siblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds : scene.rootBlockIds;
        if (!siblings) {
            return;
        }
        const siblingIndex = siblings.indexOf(id);
        if (direction === "up") {
            const previousId = siblings[siblingIndex - 1];
            if (!previousId) {
                return;
            }
            recordHistory();
            storyService.moveBlock(storyId, sceneId, id, getMoveTargetBefore(scene, id, previousId));
        } else {
            const nextId = siblings[siblingIndex + 1];
            if (!nextId) {
                return;
            }
            recordHistory();
            storyService.moveBlock(storyId, sceneId, id, getMoveTargetAfter(scene, id, nextId));
        }
        selectSingleRow(id);
        setStatusText("Moved row.");
    }, [activeBlockId, recordHistory, scene, sceneId, selectSingleRow, selectedBlockIds, storyId, storyService]);

    // Cmd/Ctrl+D — duplicate the selected rows (with their subtrees, new ids) directly below the block.
    const duplicateSelection = useCallback(() => {
        if (!storyService || !uuidService || !storyId || !sceneId || !scene) {
            return;
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        const roots = filterOutSelectedDescendants(scene, ids);
        if (roots.length === 0) {
            return;
        }
        const rootSet = new Set(roots);
        const orderedRoots = visibleRows.map(row => row.block.id).filter(blockId => rootSet.has(blockId));
        const anchorId = orderedRoots[orderedRoots.length - 1] ?? roots[roots.length - 1];
        recordHistory();
        const target = getInsertionTargetAfter(scene, anchorId);
        const insertedIds: StoryBlockId[] = [];
        for (const rootId of orderedRoots) {
            const cloned = cloneSerializedBlock(serializeBlockSubtree(scene, rootId), () => uuidService.generate());
            insertSerializedClone(storyService, storyId, sceneId, cloned, target);
            insertedIds.push(cloned.block.id);
        }
        if (insertedIds[0]) {
            setActiveBlockId(insertedIds[0]);
            setSelectedBlockIds(new Set(insertedIds));
            selectionAnchorRef.current = insertedIds[0];
        }
        setEditorMode({ kind: "idle" });
        setStatusText(`Duplicated ${insertedIds.length} row${insertedIds.length === 1 ? "" : "s"}.`);
    }, [activeBlockId, recordHistory, scene, sceneId, selectedBlockIds, storyId, storyService, uuidService, visibleRows]);

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
        characters, commandContext, visibleRows, shouldRenderActiveInsertSlot,
        rootRef, scrollContainerRef, insertInputRef, textInputRef, uuidService,
        focusRoot, focusWorkspace, revealBlock, handleKeyDown, copySelectionToClipboard: handleCopy, handlePaste: handlePasteInEditor,
        deleteRows, deleteSelection, startInsertAfter, selectRow, beginDragSelection,
        extendDragSelection, toggleCollapsed, setEditorMode, updateBlockPayloadFor, updateSceneMetadata,
        setDialogueSpeaker, createCharacterFromSpeaker, commitTextEdit, handleInsertValueChange,
        undoEdit, redoEdit,
        startInsertAfterSelection, indentSelection, selectAllRows, moveActiveRowSelection,
        insertContinuationAfterCurrentTextEdit, commitNarrationFromInsert, handleInsertBackspaceEmpty, chooseCommand, chooseCharacterForInsert,
        dismissInsertChooser, discardInsertSlot, resolveInsertLine, commitInvalidFromInsert, chooseTempSpeakerForInsert, tempSpeakers,
        createActionFromSidebar, addInsideContainer, addConditionBranch,
        navigateFromTextEdit, handleBackspaceAtEmptyStart, enterEditOrInspectorForActive,
        extendRowSelection, moveSelectedRows, duplicateSelection, jumpRowSelection, pageRowSelection,
        moveDraggedBlockAfter, moveDraggedBlockToSortablePosition, startDraggingBlock, endDraggingBlock,
        createLayerBeforeBlock,
    };
}

/**
 * The action command a text row's Enter continues with — a same-kind successor. Kinds with no natural
 * successor (a choice prompt) return null so the caller falls back to the generic insert slot.
 */
function continuationCommandFor(block: StoryBlock): ActionCommandId | null {
    if (block.kind === "note") {
        return "note";
    }
    if (block.kind === "nodeAction") {
        if (block.payload.action === "narration") return "narration";
        if (block.payload.action === "dialogue") return "dialogue";
        if (block.payload.action === "choiceOption") return "choiceOption";
    }
    return null;
}

/** Pick a unique default name ("Layer 1", "Layer 2", …) for a freshly-created layer in a scene. */
function nextLayerName(scene: StoryScene): string {
    const existing = new Set<string>();
    for (const block of Object.values(scene.blocks)) {
        if (block.kind === "action" && block.payload.action === "layer" && block.payload.operation === "create") {
            existing.add(block.payload.objectName.trim().toLowerCase());
        }
    }
    let index = 1;
    while (existing.has(`layer ${index}`)) {
        index += 1;
    }
    return `Layer ${index}`;
}
