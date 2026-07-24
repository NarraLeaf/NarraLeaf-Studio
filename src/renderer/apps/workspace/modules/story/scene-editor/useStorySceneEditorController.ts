import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import type {
    StoryBlock,
    StoryBlockId,
    StoryDocument,
    StoryExpression,
    StoryLiteralValue,
    StoryScene,
    StorySceneUpdate,
    StoryVariableScope,
    StoryVariableValueType,
} from "@shared/types/story";
import { describeDeclaration } from "@shared/types/story";
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
import { buildStoryCommandContext } from "./storyCommandContext";
import { canCommit, parseCommandLine } from "./storyCommandParser";
import { resolveCommandLine, type StoryCommandResolvedArgs } from "./storyCommandResolution";
import { getCommandSpec } from "./commands/registry";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";

import { collectTempSpeakers, promoteTempSpeaker } from "@/lib/workspace/services/story/storyModel";
import { CHARACTERS_PANEL_ID } from "../../characters";
import {
    annotateDialogueGroups,
    buildDialogueAppearances,
    buildVisibleRows,
    canAcceptChildren,
    isNarrativeRow,
    filterOutSelectedDescendants,
    findPreviousSibling,
    nextSelectionAfterDelete,
    getInsertionTargetAfter,
    getMoveTargetBefore,
    getMoveTargetAfter,
    getTextSegment,
    hasInspector,
    isTextEditableBlock,
    selectRange,
    updateTextPayload,
} from "./storySceneBlockUtils";
import { isInteractiveTarget, isTextInputActive } from "./storySceneDom";
import { getStoryEditorViewPrefs, getStoryEditorViewState, patchStoryEditorViewPrefs, patchStoryEditorViewState, type StoryEditorDensity } from "./storyEditorSessionStore";
import { cloneSerializedBlock, insertSerializedClone, serializeBlockSubtree } from "./storySceneClipboard";
import { getSelectionUnitRange, richRunsToPlain } from "./richText";
import type { RichTextInputHandle } from "./RichTextInput";
import type { EditorMode, StoryBlockTarget, StoryCaretTarget, StoryStagePlacement } from "./storySceneEditorTypes";
import { useStorySceneClipboardHandlers } from "./useStorySceneClipboardHandlers";
import { useSlashAtAlias } from "@/apps/workspace/hooks/useSlashAtAlias";
import { isActionCommandLine, toCanonicalCommandLine } from "./commandTrigger";

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
    // the first render - the workspace only mounts editors once services (incl. this one) are ready.
    const panelStateService = useMemo(() => (context && isInitialized ? context.services.get<PanelStateService>(Services.PanelState) : null), [context, isInitialized]);
    /** Owner of the persistent-variable declarations the story's `persistent` scope points at. */
    const blueprintService = useMemo(() => (context && isInitialized ? context.services.get<LocalBlueprintService>(Services.LocalBlueprint) : null), [context, isInitialized]);
    // When on, a leading "@" in an insert slot is rewritten to "/" so it opens the action creator -
    // the escape hatch for a Simplified-Chinese IME, which types "、" for the "/" key. Defaults on for
    // a Simplified-Chinese device; the user can override it in Settings (Editor).
    const slashAtAlias = useSlashAtAlias();

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
    /**
     * The x the caret is trying to hold while walking rows vertically. Seeded from the caret as it
     * leaves the first row and kept until something states a new column - a horizontal arrow, a
     * click, an edit - so ArrowDown-then-ArrowUp returns the author to where they started rather
     * than to a line edge. A ref, not state: reading it must never re-render the list mid-keypress.
     */
    const goalColumnRef = useRef<number | null>(null);
    // Anchor row for keyboard range-selection (Shift+Arrow grows the selection from here).
    const selectionAnchorRef = useRef<StoryBlockId | null>(null);
    const plainPasteRequestedRef = useRef(false);
    /**
     * True between discarding an insert slot and the state update landing. Escape's last rung moves
     * focus, which blurs the slot in the same tick - and blur commits prose. Without this the ladder's
     * "leaving an uncommitted slot creates nothing" would be false for every line that reached it.
     */
    const slotDiscardedRef = useRef(false);
    const undoStackRef = useRef<StorySceneHistoryState[]>([]);
    const redoStackRef = useRef<StorySceneHistoryState[]>([]);
    const [document, setDocument] = useState<StoryDocument | null>(null);
    const [loading, setLoading] = useState(false);
    // Seed the focused row + selection from the persisted view state so switching tabs/pages (which
    // fully unmounts the editor) - and restarting Studio - keeps the author's place. An explicit
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
    // Editor-wide view preferences (WI-6). PanelStateService loads from disk before the editor renders,
    // so the synchronous read below sees the persisted value; the setters write it back.
    const [narrativeOnly, setNarrativeOnlyState] = useState<boolean>(() => (panelStateService ? getStoryEditorViewPrefs(panelStateService).narrativeOnly : false));
    const [density, setDensityState] = useState<StoryEditorDensity>(() => (panelStateService ? getStoryEditorViewPrefs(panelStateService).density : "compact"));
    const setNarrativeOnly = useCallback((value: boolean) => {
        setNarrativeOnlyState(value);
        if (panelStateService) {
            patchStoryEditorViewPrefs(panelStateService, { narrativeOnly: value });
        }
    }, [panelStateService]);
    const setDensity = useCallback((value: StoryEditorDensity) => {
        setDensityState(value);
        if (panelStateService) {
            patchStoryEditorViewPrefs(panelStateService, { density: value });
        }
    }, [panelStateService]);
    const [editorMode, setEditorMode] = useState<EditorMode>({ kind: "idle" });
    /**
     * The keyboard cursor is on the "add a row" line that sits just past the last row, reached by
     * arrowing Down off the bottom. It is a position with no row behind it (activeBlockId is null
     * while it holds focus), so Enter there opens a fresh insert slot — the same as clicking it.
     */
    const [addRowFocused, setAddRowFocused] = useState(false);
    const [draggingBlockId, setDraggingBlockId] = useState<StoryBlockId | null>(null);
    const [dragSelectActive, setDragSelectActive] = useState(false);
    const [characterRevision, setCharacterRevision] = useState(0);
    /**
     * Bumped when the blueprint document changes, because that is where persistent (game-level)
     * variables are declared - a `/persis` line, or one declared over in the blueprint editor, has to
     * show up in this editor's candidates without a reload.
     */
    const [blueprintRevision, setBlueprintRevision] = useState(0);

    // Persist the focused row + selection so they survive the tab unmounting when the author switches
    // away and a Studio restart (paired with the seed above and the scroll persistence in the tab).
    useEffect(() => {
        if (!sceneId || !panelStateService) {
            return;
        }
        patchStoryEditorViewState(panelStateService, sceneId, { activeBlockId, selectedBlockIds: [...selectedBlockIds] });
    }, [panelStateService, sceneId, activeBlockId, selectedBlockIds]);

    // The add-row line has no row behind it: any real active row must clear its focus, or a row and
    // the add-row line would both read as focused. Runs after the render that set activeBlockId, so
    // focusAddRow (which sets activeBlockId to null) is left alone.
    useEffect(() => {
        if (activeBlockId !== null) {
            setAddRowFocused(false);
        }
    }, [activeBlockId]);

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
        });
    }, [characterService]);

    useEffect(() => {
        if (!blueprintService) {
            return;
        }
        return blueprintService.onBlueprintHistoryChanged(() => {
            setBlueprintRevision(revision => revision + 1);
        });
    }, [blueprintService]);

    const scene = useMemo(() => (document && sceneId ? document.scenes[sceneId] ?? null : null), [document, sceneId]);
    /**
     * Temp speakers alive anywhere in this story, offered back as candidates. Derived from the
     * document rather than stored, so one goes away exactly when its last line does - and so a name
     * used earlier in the story is findable later without anyone maintaining a registry.
     */
    const tempSpeakers = useMemo(() => (document ? collectTempSpeakers(document) : []), [document]);
    const characters = useMemo(() => characterService?.listCharacter() ?? [], [characterRevision, characterService]);

    /** What a name typed on the command line may refer to. Rebuilt as the project changes under it. */
    const commandContext = useMemo(
        () => buildStoryCommandContext({
            assets: assetsService?.getAssets(),
            characters,
            document,
            sceneId,
            scene,
            persistentVariables: blueprintService?.listPersistentVariables() ?? [],
        }),
        [assetsService, blueprintService, blueprintRevision, characters, document, sceneId, scene],
    );
    // Each dialogue speaker's accumulated appearance (WI-3), so a dialogue row's avatar can follow the
    // most recent enter/expression. Keyed on the scene's content, not on collapse.
    const dialogueAppearances = useMemo(() => (scene ? buildDialogueAppearances(scene) : null), [document, scene]);
    const visibleRows = useMemo(() => {
        if (!scene) {
            return [];
        }
        let rows = buildVisibleRows(scene, collapsedBlockIds);
        // "Narrative only" (WI-6) drops staging rows but leaves each survivor's line number as-is —
        // filtering after buildVisibleRows (which assigns them) is what keeps the numbers un-renumbered.
        if (narrativeOnly) {
            rows = rows.filter(row => isNarrativeRow(row.block));
        }
        if (dialogueAppearances) {
            rows = rows.map(row => {
                const appearance = dialogueAppearances.get(row.block.id);
                return appearance ? { ...row, appearance } : row;
            });
        }
        // Grouping runs last, over the exact rows that will render (WI-5).
        return annotateDialogueGroups(rows);
    }, [collapsedBlockIds, dialogueAppearances, narrativeOnly, scene]);
    const rowIndexById = useMemo(() => {
        const result = new Map<StoryBlockId, number>();
        visibleRows.forEach((row, index) => result.set(row.block.id, index));
        return result;
    }, [visibleRows]);
    // While the "narrative only" filter is on, keep the selection and active row inside the visible set.
    // Enabling the filter (or editing under it) can leave selected staging rows hidden, and a Delete
    // must never act on a row the author cannot see — so drop any selected id that is no longer visible.
    // Off-filter editing is untouched; navigation that needs a hidden row turns the filter off first
    // (see revealBlock).
    useEffect(() => {
        if (!narrativeOnly) {
            return;
        }
        setSelectedBlockIds(prev => {
            if (prev.size === 0) {
                return prev;
            }
            let changed = false;
            const next = new Set<StoryBlockId>();
            for (const id of prev) {
                if (rowIndexById.has(id)) {
                    next.add(id);
                } else {
                    changed = true;
                }
            }
            return changed ? next : prev;
        });
        setActiveBlockId(prev => (prev && !rowIndexById.has(prev) ? null : prev));
    }, [narrativeOnly, rowIndexById]);
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
     * through state so a drag never re-renders the list mid-gesture - and so this can be called from
     * the teardown paths (mouseup, pointercancel, window blur) that must not be able to leave the
     * editor stuck with unselectable text.
     *
     * Toggles a class rather than an inline `user-select`: the rows carry `.nl-selectable-text`, an
     * explicit value that an inherited one from this root cannot override - see the rule in
     * `styles.css`.
     */
    const setRowTextSelectable = useCallback((selectable: boolean) => {
        rootRef.current?.classList.toggle("nl-text-select-suspended", !selectable);
    }, []);

    /**
     * Mouse released without leaving the row: open the row for editing, VS Code style. The browser's
     * own selection at mouseup carries straight in as the caret - a plain click lands a collapsed caret
     * exactly where the pointer was (clicking past the text end lands it at the line end, since the
     * browser clamps to the nearest character), and a drag / double-click hands over the range it
     * selected. Selecting a row *without* editing is still available from the gutter, a modified click,
     * or Escape out of the edit.
     *
     * The whole gesture rests on the browser being *allowed* to select the row's text: the app resets
     * `user-select: none` onto everything, so the rows opt back in with `.nl-selectable-text` (see
     * `renderRowText`). Without that opt-in `getSelectionUnitRange` is always null and the row would
     * only ever open at its end - jsdom implements neither `user-select` nor native selection, so
     * nothing but driving the real app can catch a regression here.
     */
    const finishTextSelectGesture = useCallback((pending: { blockId: StoryBlockId; textEl: HTMLElement }) => {
        const block = scene?.blocks[pending.blockId];
        if (!block || !isTextEditableBlock(block)) {
            return;
        }
        const range = getSelectionUnitRange(pending.textEl);
        const segment = getTextSegment(block);
        const caret: StoryCaretTarget = range ? { start: range.start, end: range.end } : "end";
        setEditorMode({ kind: "text", blockId: pending.blockId, value: segment?.value ?? "", rich: segment?.rich, caret });
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
        // Backstops for a gesture that never gets its mouseup - the pointer taken away by the OS, or
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
        const block = scene?.blocks[blockId];
        if (!block) {
            return false;
        }
        // Jump wins over the filter: navigating (reveal / search) to a staging row that the "narrative
        // only" filter would hide turns the filter off, so the target is actually visible and selected
        // rather than an invisible selection on a hidden row.
        if (narrativeOnly && !isNarrativeRow(block)) {
            setNarrativeOnly(false);
        }
        setActiveBlockId(blockId);
        setSelectedBlockIds(new Set([blockId]));
        selectionAnchorRef.current = blockId;
        return true;
    }, [narrativeOnly, scene, setNarrativeOnly]);

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

    const restoreHistoryState = useCallback((state: StorySceneHistoryState) => {
        if (!storyService || !storyId || !sceneId) {
            return;
        }
        storyService.replaceScene(storyId, sceneId, state.scene);
        uiService?.editor.update(tabId, { title: state.scene.name });
        setActiveBlockId(state.activeBlockId);
        setSelectedBlockIds(new Set(state.selectedBlockIds));
        setCollapsedBlockIds(new Set(state.collapsedBlockIds));
        setEditorMode({ kind: "idle" });
    }, [sceneId, storyId, storyService, tabId, uiService]);

    const undoEdit = useCallback(() => {
        const previous = undoStackRef.current.pop();
        if (!previous) {
            return;
        }
        const current = captureHistoryState();
        if (current) {
            redoStackRef.current.push(current);
        }
        restoreHistoryState(previous);
    }, [captureHistoryState, restoreHistoryState]);

    const redoEdit = useCallback(() => {
        const next = redoStackRef.current.pop();
        if (!next) {
            return;
        }
        const current = captureHistoryState();
        if (current) {
            undoStackRef.current.push(current);
        }
        restoreHistoryState(next);
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
        // flushed into the draft is still committed - otherwise it is lost when we navigate away.
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

    const insertBlock = useCallback((block: StoryBlock, afterBlockId: StoryBlockId | null, openInspector = false, options?: { recordHistory?: boolean; target?: StoryBlockTarget; replaceBlockId?: StoryBlockId }) => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        if (options?.recordHistory !== false) {
            recordHistory();
        }
        // An explicit target ("add inside a container") overrides the default sibling-after placement.
        storyService.insertBlock(storyId, sceneId, block, options?.target ?? getInsertionTargetAfter(scene, afterBlockId));
        // Rewriting a row rather than adding one: the replacement is in place, so the original goes.
        // Done here, after the insert, so a failed insert cannot leave the author with neither.
        if (options?.replaceBlockId) {
            storyService.deleteBlock(storyId, sceneId, options.replaceBlockId);
        }
        setActiveBlockId(block.id);
        setSelectedBlockIds(new Set([block.id]));
        setEditorMode(openInspector ? { kind: "inspector", blockId: block.id } : { kind: "idle" });
    }, [recordHistory, scene, sceneId, storyId, storyService]);

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

    // `confirmation` is the just-declared line's ghost receipt (bible §3.5): the slot that opens after a
    // declaration commits carries it so `✓ Var gold: number = 0` greets the caret, then the next edit
    // strips it. Every other caller opens a clean slot (no argument), so the receipt is scoped to exactly
    // the one slot that earned it — no separate state, and nothing to clear when the author moves on.
    const startInsertAfter = useCallback((afterBlockId: StoryBlockId | null, focus = true, confirmation?: string) => {
        slotDiscardedRef.current = false;
        setEditorMode({ kind: "insert", slot: { afterBlockId, focusToken: Date.now() }, value: "", confirmation });
        if (afterBlockId) {
            setActiveBlockId(afterBlockId);
        }
        if (focus) {
            window.requestAnimationFrame(() => insertInputRef.current?.focus());
        }
    }, []);

    /**
     * Open an insert slot directly *above* a row, at that row's own depth. Modelled on `startLineEdit`'s
     * before-target (parent + `beforeBlockId`) but without `replaceBlockId`, so the row stays and the new
     * line lands in front of it — the "insert above" context-menu action. The tab renders it against the
     * `beforeBlockId` target, which is why it works uniformly whether or not the row has a previous sibling.
     */
    const startInsertBefore = useCallback((blockId: StoryBlockId, focus = true) => {
        const block = scene?.blocks[blockId];
        if (!block) {
            return;
        }
        slotDiscardedRef.current = false;
        setEditorMode({
            kind: "insert",
            slot: { afterBlockId: null, focusToken: Date.now(), target: { parentId: block.parentId, beforeBlockId: blockId } },
            value: "",
        });
        setActiveBlockId(blockId);
        if (focus) {
            window.requestAnimationFrame(() => insertInputRef.current?.focus());
        }
    }, [scene]);

    /**
     * Re-open a row as an editable line, seeded with its source.
     *
     * The slot lands *where the row is* (after its previous sibling, inside its parent) and carries
     * `replaceBlockId`, so committing swaps the row in place and Escape leaves it exactly as it was.
     * Only invalid rows use this today: they are the one kind whose whole content is raw text the
     * author still needs to fix.
     */
    const startLineEdit = useCallback((block: StoryBlock) => {
        if (!scene) {
            return;
        }
        const siblings = block.parentId ? scene.blocks[block.parentId]?.childrenIds ?? [] : scene.rootBlockIds;
        const index = siblings.indexOf(block.id);
        slotDiscardedRef.current = false;
        setEditorMode({
            kind: "insert",
            slot: {
                afterBlockId: index > 0 ? siblings[index - 1] : null,
                focusToken: Date.now(),
                target: { parentId: block.parentId, beforeBlockId: block.id },
                replaceBlockId: block.id,
            },
            value: block.kind === "invalid" ? block.payload.source : getTextSegment(block)?.value ?? "",
            // Reopening a draft row lands with its completion menu open (bible M3): the author is here
            // to fix the line, so the candidates it needs are what should greet them - not the suppressed
            // slot the old `chooserDismissed: true` left, which gave a returned-to line no menu at all.
        });
        setActiveBlockId(block.id);
        window.requestAnimationFrame(() => insertInputRef.current?.focus());
    }, [scene]);

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
    const scaffoldContainer = useCallback((block: StoryBlock, condition?: StoryExpression) => {
        if (!storyService || !storyId || !sceneId || !uuidService) {
            return;
        }
        if (block.kind === "control" && block.payload.control === "condition") {
            const branch = createBlockForCommand("conditionBranch", () => uuidService.generate());
            // `/if gold >= 100` builds the container here and its first branch below, so the condition
            // the author typed lands on the branch - the container has nowhere to hold one. Picking
            // Condition from the palette passes nothing and gets the same empty branch as before.
            const seeded = condition && branch.kind === "control" && branch.payload.control === "conditionBranch"
                ? { ...branch, payload: { ...branch.payload, condition: { kind: "expression" as const, expression: condition } } }
                : branch;
            storyService.insertBlock(storyId, sceneId, seeded, { parentId: block.id, beforeBlockId: null });
        } else if (block.kind === "nodeAction" && block.payload.action === "choice") {
            const option = createBlockForCommand("choiceOption", () => uuidService.generate());
            storyService.insertBlock(storyId, sceneId, option, { parentId: block.id, beforeBlockId: null });
        }
    }, [sceneId, storyId, storyService, uuidService]);

    // Enter while editing a text row: commit and open a new row that continues the same kind - narration
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
    const navigateFromTextEdit = useCallback((direction: "up" | "down" | "left" | "right", caretX?: number | null) => {
        if (editorMode.kind !== "text") {
            return;
        }
        const vertical = direction === "up" || direction === "down";
        // A horizontal arrow is the author stating a new column; a vertical one keeps the column it
        // already had, and only seeds it if this is the move that started the run.
        if (!vertical) {
            goalColumnRef.current = null;
        } else if (goalColumnRef.current === null && typeof caretX === "number") {
            goalColumnRef.current = caretX;
        }
        const goalX = vertical ? goalColumnRef.current : null;
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
                // Past the last row - drop into a fresh insert slot so the author can keep writing downward.
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
            const caret: StoryCaretTarget = goalX === null
                ? (goingBack ? "end" : "start")
                : { goalX, line: goingBack ? "last" : "first" };
            setEditorMode({ kind: "text", blockId: targetBlock.id, value: segment?.value ?? "", rich: segment?.rich, caret });
        } else {
            setEditorMode({ kind: "idle" });
            focusRoot();
        }
    }, [commitTextEdit, editorMode, focusRoot, rowIndexById, startInsertAfter, visibleRows]);

    // Backspace on an empty line. An empty dialogue drops a rung to a blank insert slot in the same spot -
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
            // container has no sibling to anchor to - fall through to the plain delete-and-step-back.
            // The anchor must be *visible*: under the "narrative only" filter the previous sibling can be a
            // hidden staging row, and a slot anchored to a hidden row opens where the author cannot see it —
            // so when that sibling is filtered out, don't demote and fall through to delete-and-step-back.
            const previousSibling = findPreviousSibling(scene, id);
            if (previousSibling && rowIndexById.has(previousSibling.id)) {
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

    /**
     * A selected non-text row was activated (Enter, double-click). A block with a real inspector opens
     * it; a card-less one (see {@link hasInspector}) runs its own operation instead. A condition branch
     * - where Enter into a placeholder card would be a dead end - adds a line inside its body, the
     * common next step when building an if/else; the condition container, which only manages branches,
     * folds. (Collapse is inlined rather than calling `toggleCollapsed`, which is declared later.)
     */
    const activateBlockForInspectorOrOp = useCallback((blockId: StoryBlockId) => {
        const block = scene?.blocks[blockId];
        if (!block) {
            return;
        }
        // An invalid row is the author's own text, kept verbatim because it did not resolve. Its only
        // sensible edit is to that text, so it re-opens the line editor seeded with the source rather
        // than a property inspector — a card of fields for a row that has no fields yet is a dead end,
        // and it was the first thing anyone hit after mistyping a command.
        if (block.kind === "invalid") {
            startLineEdit(block);
            return;
        }
        if (hasInspector(block)) {
            setEditorMode({ kind: "inspector", blockId });
            return;
        }
        if (block.kind === "control" && block.payload.control === "condition") {
            setCollapsedBlockIds(previous => {
                const next = new Set(previous);
                next.has(blockId) ? next.delete(blockId) : next.add(blockId);
                return next;
            });
            return;
        }
        // Any other card-less container (a condition branch, incl. else) adds a line in its body.
        if (canAcceptChildren(block)) {
            startInsertInside(blockId);
        }
    }, [scene, startInsertInside]);

    /** Escape's inspector rung: close the property editor, keeping the row selected. */
    const closeInspector = useCallback(() => {
        setEditorMode(current => (current.kind === "inspector" ? { kind: "idle" } : current));
    }, []);

    // Enter on a selected-but-not-editing row: text rows open for editing (caret at the end); action rows
    // open their inspector (or their card-less operation); with nothing selected it falls back to a slot.
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
            return;
        }
        activateBlockForInspectorOrOp(activeBlockId);
    }, [activeBlockId, activateBlockForInspectorOrOp, scene, startInsertAfter]);

    const commitNarrationFromInsert = useCallback((focusNext: boolean) => {
        if (editorMode.kind !== "insert" || slotDiscardedRef.current) {
            return;
        }
        if (!editorMode.value.trim()) {
            setEditorMode({ kind: "idle" });
            return;
        }
        // A command (`/`, or `@` when the alias is on) or `#` line is never prose - it resolves to a
        // command, or it becomes an invalid row. This is reached on blur, which is the one caller that
        // does not already know what the line is; without the guard, clicking away from a half-typed
        // `/set` lands it as narration, which is the exact bug the Escape ladder was fixed to stop.
        if (isActionCommandLine(editorMode.value, slashAtAlias) || editorMode.value.startsWith("#")) {
            return;
        }
        const block = createBlock("narration", editorMode.value);
        if (!block) {
            return;
        }
        insertBlock(block, editorMode.slot.afterBlockId, false, { target: editorMode.slot.target, replaceBlockId: editorMode.slot.replaceBlockId });
        if (focusNext) {
            startInsertAfter(block.id, true);
        }
    }, [createBlock, editorMode, insertBlock, slashAtAlias, startInsertAfter]);

    const handleInsertValueChange = useCallback((value: string) => {
        setEditorMode(current => {
            if (current.kind !== "insert") {
                return current;
            }
            // Dismissal is one-shot: Escape keeps the menu shut only while the text stands still
            // (caret moves, clicks). The next actual edit clears the flag, and the chooser re-derives
            // from the value (see `insertChooserType`) - which is what lets a re-opened draft row have
            // its autocomplete back the moment the author starts fixing it, instead of never (the old
            // flag was one-way for the slot's whole life, so a returned-to line got no candidates).
            if (current.chooserDismissed && value === current.value) {
                return current;
            }
            // The stored value keeps the trigger the author typed ("@" or "/") - only parsing and
            // committing fold "@" onto "/" - so the slot shows the "@" they pressed. The menu the value
            // asks for is derived at render, so nothing here has to recompute it. The declaration receipt
            // (bible §3.5) is one-shot the same way `chooserDismissed` is: the first real edit clears it.
            return { ...current, value, chooserDismissed: undefined, confirmation: undefined };
        });
    }, []);

    /** Escape, first press: drop the candidates but keep the line and the caret. */
    const dismissInsertChooser = useCallback(() => {
        setEditorMode(current => current.kind !== "insert" ? current : { ...current, chooserDismissed: true });
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

    // An open insert slot is anchored to a row (insert after it, above it, or in place of it). If that
    // row leaves the visible set while the slot is open — the author toggled the "narrative only" filter
    // or collapsed the anchor's container — the slot has nowhere on screen to render and the editor is
    // stranded in an invisible insert state. Close it so the surface is never stuck where the author
    // cannot see it (WI-0 #3). A replace slot (a re-opened draft row) renders in place of `replaceBlockId`,
    // so that row is its anchor and must be checked directly — its draft row is invalid, so the narrative
    // filter hides it while the slot is open (WI-0 M3.1). A top-of-scene slot (no anchor row) is left alone.
    useEffect(() => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const anchorId = editorMode.slot.replaceBlockId ?? editorMode.slot.target?.beforeBlockId ?? editorMode.slot.afterBlockId;
        if (anchorId && !rowIndexById.has(anchorId)) {
            discardInsertSlot();
        }
    }, [editorMode, rowIndexById, discardInsertSlot]);

    /**
     * Commit the line as an invalid row: it did not resolve to anything, and the author's text is too
     * expensive to throw away and too wrong to quietly turn into prose. The build refuses these, so
     * nothing here can ship by accident.
     */
    const commitInvalidFromInsert = useCallback(() => {
        if (editorMode.kind !== "insert" || !uuidService) {
            return;
        }
        // Canonicalize before it lands: an "@" trigger is a per-user input convenience, so the persisted
        // source keeps the "/" form every reader (and the build) understands, whatever this author's
        // alias setting is.
        const source = toCanonicalCommandLine(editorMode.value, slashAtAlias);
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
        insertBlock(block, editorMode.slot.afterBlockId, false, { target: editorMode.slot.target, replaceBlockId: editorMode.slot.replaceBlockId });
        startInsertAfter(block.id, true);
    }, [editorMode, insertBlock, slashAtAlias, startInsertAfter, uuidService]);


    // Backspace on an empty insert slot: dismiss the blank line and step back onto the row above it -
    // re-entering it for editing when it holds text - so the demote ladder keeps walking upward.
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

    const chooseCharacterForInsert = useCallback((characterId: string) => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const target = editorMode.slot.target;
        const replaceBlockId = editorMode.slot.replaceBlockId;
        // Empty, not the typed text: everything after `#` was the speaker query (see `chooserQuery`),
        // so reusing it as the body would put the speaker's own name in their first line.
        const block = createBlock("dialogue", "", characterId);
        if (block) {
            insertBlock(block, editorMode.slot.afterBlockId, false, { target, replaceBlockId });
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
        }
    }, [createBlock, editorMode, insertBlock]);

    const commitCommandFromInsert = useCallback((value: string): boolean => {
        if (editorMode.kind !== "insert") {
            return false;
        }
        const line = parseCommandLine(value);
        if (line.kind !== "command" || !line.def) {
            return false;
        }
        // One gate, one path: parser issues and an unfilled required core block here (bible B9), and
        // every command - paramless containers included - commits through its spec. The old paramless
        // fall-through to the menu path is gone with the dual behaviour it carried.
        if (!canCommit(line)) {
            return false;
        }
        const { args, issues } = resolveCommandLine(line, commandContext);
        if (issues.length > 0) {
            return false;
        }
        const spec = getCommandSpec(line.def.commandId);
        if (!spec) {
            return false;
        }
        // v6: a declaration builds a ROW like everything else - the row is the variable, so Enter's
        // visible result is the line itself, and the ordinary insert path (undo included) covers it.
        if (!spec.build || !uuidService) {
            return false;
        }
        const block = spec.build(args, { generateId: () => uuidService.generate(), context: commandContext });
        insertBlock(block, editorMode.slot.afterBlockId, spec.inspectorAfterCommit === true, { target: editorMode.slot.target, replaceBlockId: editorMode.slot.replaceBlockId });
        scaffoldContainer(block, args.test?.kind === "expression" ? args.test.expression : undefined);
        if (spec.inspectorAfterCommit) {
            return true;
        }
        // A speaker with no line yet (`/say Alice`) lands the caret in the body, exactly as picking a
        // speaker after `#` does. A line that already carries its text moves on to the next row -
        // the command line never routes to the inspector, or it would stop the author mid-flow.
        if (isTextEditableBlock(block) && !args.text) {
            setEditorMode({ kind: "text", blockId: block.id, value: getTextSegment(block)?.value ?? "" });
            return true;
        }
        // A declaration's row IS its result, but the caret has already moved on to the fresh slot below,
        // so the receipt travels with that slot: `✓ Var gold: number = 0`, scope word off the same badge
        // label the row shows, fading on the next keystroke (bible §3.5). No toast — the ghost zone is the
        // quietest place to say "it worked" without stealing the line the author is about to type.
        const confirmation = block.kind === "declaration"
            ? `✓ ${translate(`story.badge.declare.${block.payload.scope}` as Parameters<typeof translate>[0])} ${describeDeclaration(block)}`
            : undefined;
        startInsertAfter(block.id, true, confirmation);
        return true;
    }, [commandContext, editorMode, insertBlock, scaffoldContainer, sceneId, startInsertAfter, storyId, storyService, uuidService]);

    /**
     * A pick from the slash menu. A spec command routes through the same commit path a typed line
     * takes - a paramless container (`/parallel`) lands in one keystroke, and one with a required
     * core never gets here (the menu completes its token instead, so the author fills the core).
     * Plugin actions keep their registration path.
     */
    const chooseCommand = useCallback((commandId: string) => {
        if (editorMode.kind !== "insert") {
            return;
        }
        const spec = getCommandSpec(commandId);
        if (spec) {
            commitCommandFromInsert(`/${spec.token}`);
            return;
        }
        // Strip the "/command " (or "@command ") prefix off the canonical line to keep the trailing text.
        const initialText = toCanonicalCommandLine(editorMode.value, slashAtAlias).replace(/^\/\S*\s?/, "");
        const block = createPluginActionBlock(commandId, initialText);
        if (block) {
            insertBlock(block, editorMode.slot.afterBlockId, true, { target: editorMode.slot.target, replaceBlockId: editorMode.slot.replaceBlockId });
        }
    }, [commitCommandFromInsert, createPluginActionBlock, editorMode, insertBlock, slashAtAlias]);

    /**
     * Enter / Shift+Enter with no candidate to take - the chooser was dismissed, or never opened.
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
        if (isActionCommandLine(value, slashAtAlias)) {
            // Parse and commit against the canonical "/" line; an "@" the author typed is only display.
            if (!commitCommandFromInsert(toCanonicalCommandLine(value, slashAtAlias))) {
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
    }, [commitCommandFromInsert, commitInvalidFromInsert, commitNarrationFromInsert, editorMode, slashAtAlias]);

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
        const replaceBlockId = editorMode.slot.replaceBlockId;
        // Empty for the same reason as `chooseCharacterForInsert`: the post-`#` text was the name.
        const block = createBlock("dialogue", "");
        if (!block || block.kind !== "nodeAction" || block.payload.action !== "dialogue") {
            return;
        }
        block.payload = { ...block.payload, speakerName: name, characterId: undefined };
        insertBlock(block, editorMode.slot.afterBlockId, false, { target, replaceBlockId });
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
     * The two are mutually exclusive on purpose - a leftover `speakerName` under a real `characterId`
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
     * Set where a dialogue group's speaker stands (WI-3, M3.1). The document always stays command lines
     * (P3): the dropdown is a declarative shell over `/show … at=` and `/move … at=`. Reading is the
     * appearance scan's job (`buildDialogueAppearances` tracks the placement + the block that set it);
     * writing rewrites that block's `at=` in place, or — when the character has no enter/move to edit —
     * authors a `/move <character> at=<pos>` above the group head. Both go through history like any edit.
     */
    const setDialogueGroupPosition = useCallback((head: StoryBlock, position: StoryStagePlacement, positionSourceId: StoryBlockId | null) => {
        if (!storyService || !storyId || !sceneId || !scene || !uuidService) {
            return;
        }
        if (head.kind !== "nodeAction" || head.payload.action !== "dialogue" || !head.payload.characterId) {
            return;
        }
        const characterId = head.payload.characterId;
        const source = positionSourceId ? scene.blocks[positionSourceId] : undefined;
        if (source && source.kind === "action" && source.payload.action === "character") {
            // Rewrite the enter/move in place; updateBlockPayloadFor no-ops when the placement is unchanged.
            updateBlockPayloadFor(source.id, {
                ...source.payload,
                transform: { ...(source.payload.transform ?? {}), preset: position },
            });
            return;
        }
        const move = createBlockForCommand("characterMove", () => uuidService.generate());
        if (move.kind === "action" && move.payload.action === "character") {
            move.payload.characterId = characterId;
            move.payload.transform = { ...(move.payload.transform ?? {}), preset: position };
        }
        insertBlock(move, null, false, { target: { parentId: head.parentId, beforeBlockId: head.id } });
    }, [insertBlock, scene, sceneId, storyId, storyService, updateBlockPayloadFor, uuidService]);

    /**
     * Promote the name on a dialogue row to a real character: create it, rebind every line that used
     * the bare name, and reveal the character manager so the author can give it a face - but leave the
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
        // Pointing at a column states it: whatever vertical run was in flight is over.
        goalColumnRef.current = null;
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

    /** Editing the text moves the caret by intent, which ends any vertical run. See {@link goalColumnRef}. */
    const resetGoalColumn = useCallback(() => {
        goalColumnRef.current = null;
    }, []);

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
        // Which row to land on, computed against the tree *before* it changes.
        const focusTargetId = nextSelectionAfterDelete(scene, visibleRows, roots);
        recordHistory();
        roots.forEach(id => storyService.deleteBlock(storyId, sceneId, id));
        setEditorMode({ kind: "idle" });
        if (focusTargetId) {
            // Select it (not edit it): a delete is a row operation, so staying in row-selection keeps
            // the arrows walking the list. Refocus the root or the keybindings have nothing to fire on.
            setActiveBlockId(focusTargetId);
            setSelectedBlockIds(new Set([focusTargetId]));
            selectionAnchorRef.current = focusTargetId;
            focusRoot();
        } else {
            setSelectedBlockIds(new Set());
            setActiveBlockId(null);
        }
    }, [focusRoot, recordHistory, scene, sceneId, storyId, storyService, uiService, visibleRows]);

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
     * row is the selection's head, which sits *above* its tail after Shift+ArrowUp - anchoring there
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

    /**
     * Move the keyboard cursor onto the "add a row" line past the last row. No row stays active, so
     * Enter falls through to opening a blank insert slot (see {@link enterEditOrInspectorForActive}),
     * matching a click on the affordance.
     */
    const focusAddRow = useCallback(() => {
        setActiveBlockId(null);
        setSelectedBlockIds(new Set());
        selectionAnchorRef.current = null;
        goalColumnRef.current = null;
        setAddRowFocused(true);
    }, []);

    const moveActiveRowSelection = useCallback((direction: "up" | "down") => {
        // The add-row line sits one step past the last row in the keyboard order: Down off the bottom
        // lands on it, Up steps back onto the last row (nothing below it to reach with Down).
        if (addRowFocused) {
            if (direction === "up") {
                const last = visibleRows[visibleRows.length - 1];
                last ? selectSingleRow(last.block.id) : setAddRowFocused(false);
            }
            return;
        }
        if (visibleRows.length === 0) {
            // An empty scene has nothing but the add-row line to move onto.
            if (direction === "down") {
                focusAddRow();
            }
            return;
        }
        const currentIndex = activeBlockId ? rowIndexById.get(activeBlockId) ?? -1 : -1;
        if (direction === "down" && currentIndex === visibleRows.length - 1) {
            focusAddRow();
            return;
        }
        const nextIndex = currentIndex === -1
            ? (direction === "down" ? 0 : visibleRows.length - 1)
            : direction === "down"
                ? Math.min(visibleRows.length - 1, currentIndex + 1)
                : Math.max(0, currentIndex - 1);
        const next = visibleRows[nextIndex];
        if (next) {
            selectSingleRow(next.block.id);
        }
    }, [activeBlockId, addRowFocused, focusAddRow, rowIndexById, selectSingleRow, visibleRows]);

    // Shift+Arrow - grow (or shrink) the selection between the anchor row and the moving head.
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

    // Alt+Arrow - reorder the selected row among its siblings (keyboard equivalent of drag-to-reorder).
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
    }, [activeBlockId, recordHistory, scene, sceneId, selectSingleRow, selectedBlockIds, storyId, storyService]);

    // Cmd/Ctrl+D - duplicate the selected rows (with their subtrees, new ids) directly below the block.
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
    }, [activeBlockId, recordHistory, scene, sceneId, selectedBlockIds, storyId, storyService, uuidService, visibleRows]);

    /**
     * The block ids a row operation acts on: the selection (deduped to roots so a container carries its
     * subtree), else the single active row. The one place the context-menu actions and the disable
     * toggle agree on "the rows this applies to".
     */
    const selectionRootIds = useCallback((): StoryBlockId[] => {
        if (!scene) {
            return [];
        }
        const ids = selectedBlockIds.size > 0 ? [...selectedBlockIds] : activeBlockId ? [activeBlockId] : [];
        return filterOutSelectedDescendants(scene, ids);
    }, [activeBlockId, scene, selectedBlockIds]);

    /**
     * Toggle the compiled-out flag across the selection (schema v7). When every targeted root is already
     * disabled it enables them, so the one menu action reads "Enable"; otherwise it disables. Undoable.
     */
    const toggleDisableSelection = useCallback(() => {
        if (!storyService || !storyId || !sceneId || !scene) {
            return;
        }
        const roots = selectionRootIds();
        if (roots.length === 0) {
            return;
        }
        const nextDisabled = !roots.every(id => scene.blocks[id]?.disabled);
        recordHistory();
        roots.forEach(id => storyService.setBlockDisabled(storyId, sceneId, id, nextDisabled));
    }, [recordHistory, scene, sceneId, selectionRootIds, storyId, storyService]);

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
        } catch {
            /* move failed; nothing to surface */
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
        } catch {
            /* move failed; nothing to surface */
        }
    }, [recordHistory, rowIndexById, scene, sceneId, storyId, storyService]);

    return {
        context, isInitialized, document, scene, loading,
        activeBlockId, selectedBlockIds, collapsedBlockIds, editorMode, addRowFocused,
        characters, commandContext, visibleRows, shouldRenderActiveInsertSlot,
        density, setDensity, narrativeOnly, setNarrativeOnly,
        rootRef, scrollContainerRef, insertInputRef, textInputRef, uuidService,
        focusRoot, focusWorkspace, revealBlock, handleKeyDown, copySelectionToClipboard: handleCopy, handlePaste: handlePasteInEditor,
        deleteRows, deleteSelection, startInsertAfter, startInsertBefore, selectRow, beginDragSelection,
        selectionRootIds, toggleDisableSelection,
        extendDragSelection, toggleCollapsed, setEditorMode, updateBlockPayloadFor, updateSceneMetadata,
        setDialogueSpeaker, setDialogueGroupPosition, createCharacterFromSpeaker, commitTextEdit, handleInsertValueChange,
        undoEdit, redoEdit,
        startInsertAfterSelection, indentSelection, selectAllRows, moveActiveRowSelection,
        insertContinuationAfterCurrentTextEdit, commitNarrationFromInsert, handleInsertBackspaceEmpty, chooseCommand, chooseCharacterForInsert,
        dismissInsertChooser, discardInsertSlot, resolveInsertLine, commitInvalidFromInsert, chooseTempSpeakerForInsert, tempSpeakers,
        createActionFromSidebar, addInsideContainer, addConditionBranch,
        navigateFromTextEdit, resetGoalColumn, handleBackspaceAtEmptyStart, enterEditOrInspectorForActive,
        activateBlockForInspectorOrOp, closeInspector,
        extendRowSelection, moveSelectedRows, duplicateSelection, jumpRowSelection, pageRowSelection,
        moveDraggedBlockAfter, moveDraggedBlockToSortablePosition, startDraggingBlock, endDraggingBlock,
        createLayerBeforeBlock, slashAtAlias,
    };
}

/**
 * The action command a text row's Enter continues with - a same-kind successor. Kinds with no natural
 * successor (a choice prompt) return null so the caller falls back to the generic insert slot.
 *
 * Narration is deliberately absent: a committed narration row cannot begin with `/`, so "narration
 * begets narration" would trap the author in prose with no keyboard path to an action. Its Enter
 * falls through to the insert slot instead - the one surface where the next line can stay narration,
 * become an action (`/`), or a line of dialogue (`#`). Dialogue keeps its successor: continuing a
 * speaker is what a back-and-forth wants, and an empty dialogue still demotes to the slot on
 * Backspace, so it is not a trap.
 */
function continuationCommandFor(block: StoryBlock): ActionCommandId | null {
    if (block.kind === "note") {
        return "note";
    }
    if (block.kind === "nodeAction") {
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
