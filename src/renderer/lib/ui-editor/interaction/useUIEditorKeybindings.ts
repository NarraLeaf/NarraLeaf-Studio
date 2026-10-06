import { useCallback, useMemo } from "react";
import {
    useKeybinding,
    useKeybindings,
    type KeybindingDefinition,
    whenEditorFocused,
    and,
    fromGetter,
} from "@/apps/workspace/hooks";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorHistoryService } from "@/lib/workspace/services/ui-editor/UIEditorHistoryService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import {
    uiEditorCopySelection,
    uiEditorCutSelection,
    uiEditorDeleteSelection,
    uiEditorDuplicateSelection,
    uiEditorGroupSelection,
    uiEditorPasteAfterSelection,
    uiEditorSelectAllInSurface,
    uiEditorUngroupSelection,
} from "@/lib/ui-editor/commands/uiEditorCommands";
import { selectSurfaceForProperties } from "@/lib/ui-editor/commands/uiEditorSelection";
import { uiEditorAlign, type UiEditorAlignOp } from "@/lib/ui-editor/commands/uiEditorAlign";
import {
    UI_EDITOR_NUDGE_LARGE_STEP,
    UI_EDITOR_NUDGE_STEP,
    uiEditorNudge,
} from "@/lib/ui-editor/commands/uiEditorNudge";
import { uiEditorSnapSelectionToGrid } from "@/lib/ui-editor/commands/uiEditorGridSnap";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import { openFloatingLayerCount } from "@/lib/components/layout/floatingLayer";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { UI_EDITOR_WRITABLE, type UIEditorReadOnly } from "./readOnlyInteraction";

function isTypingInField(): boolean {
    return isEditableKeyboardTarget(document.activeElement);
}

/**
 * Whether the bare arrow keys are free for the canvas.
 *
 * Not while a field has focus (a number box steps its own value, a text field moves its caret), and
 * not while any popover, menu or dialog is open: the arrows walk its list, and the canvas behind it
 * is not what the author is pointing them at.
 */
function areArrowKeysFreeForCanvas(): boolean {
    return !isTypingInField() && openFloatingLayerCount(document) === 0;
}

function getUiSelection(stateService: UIEditorStateService, surfaceId: string): UIElementSelection | null {
    const sel = stateService.getSelection();
    if (!isUIElementSelection(sel)) {
        return null;
    }
    const data = sel.data;
    return data.surfaceId === surfaceId ? data : null;
}

export type UseUIEditorKeybindingsParams = {
    tabId: string;
    surfaceId: string | undefined;
    enabled: boolean;
    contextMenuOpen: boolean;
    onCloseContextMenu: () => void;
    documentService: UIDocumentService | null;
    localBlueprint: LocalBlueprintService | null;
    historyService: UIEditorHistoryService | null;
    stateService: UIEditorStateService | null;
    uiService: UIService | null;
    requestRenamePrimary: () => void;
    /**
     * While active, the keybindings that edit do nothing.
     *
     * A keybinding has nothing to grey out, so this is the `run` shape of the freeze guard: every
     * binding stays registered - so the shortcut catalogue is unchanged and Escape / Ctrl+C / Ctrl+A
     * still work - and the handlers that would write return early. Unregistering them instead would
     * hand Ctrl+Z back to whatever binding sits behind it, which is another editor's undo.
     */
    readOnly?: UIEditorReadOnly;
    /**
     * Somewhere else that owns undo and redo right now, or undefined for this editor's own stacks.
     *
     * **What a live session passes.** The stacks this editor keeps are whole-Surface snapshots of a
     * document only this author ever had, so applying one inside a shared session would put the
     * screen back the way it was before anybody else joined - deleting every element they have added
     * since, with nothing on either machine reporting it. Inside a session undo is sending the
     * inverse of one's own last operation instead.
     *
     * Injected rather than reached for, because this module is bundled into the game runtime and the
     * live session is Studio's: the caller is in the workspace and can see both.
     */
    undoOverride?: { undo(): void; redo(): void } | null;
};

export function useUIEditorKeybindings(params: UseUIEditorKeybindingsParams): void {
    const {
        tabId,
        surfaceId,
        enabled,
        contextMenuOpen,
        onCloseContextMenu,
        documentService,
        localBlueprint,
        historyService,
        stateService,
        uiService,
        requestRenamePrimary,
        readOnly = UI_EDITOR_WRITABLE,
        undoOverride = null,
    } = params;
    const readOnlyActive = readOnly.active;

    const keybindings = useMemo<KeybindingDefinition[]>(() => {
        if (!surfaceId) {
            return [];
        }

        /** Wraps a handler that edits the document. Copy and Select All are deliberately not wrapped. */
        const whenWritable = (handler: () => void) => () => {
            if (readOnlyActive) {
                return;
            }
            handler();
        };

        const bindMod = (mod: "ctrl" | "meta", defs: Array<{ suffix: string; key: string; handler: () => void }>) =>
            defs.map(d => ({
                id: `${d.suffix}-${mod}`,
                key: `${mod}+${d.key}`,
                handler: d.handler,
            }));

        const copy = () => {
            if (!documentService || !localBlueprint || !stateService || isTypingInField()) {
                return;
            }
            const s = getUiSelection(stateService, surfaceId);
            uiEditorCopySelection(documentService, localBlueprint, surfaceId, s);
        };
        const cut = () => {
            if (!documentService || !localBlueprint || !stateService || isTypingInField()) {
                return;
            }
            const s = getUiSelection(stateService, surfaceId);
            uiEditorCutSelection(documentService, localBlueprint, stateService, surfaceId, s, uiService);
        };
        const paste = () => {
            if (!documentService || !localBlueprint || !stateService || isTypingInField()) {
                return;
            }
            const s = getUiSelection(stateService, surfaceId);
            void uiEditorPasteAfterSelection(documentService, localBlueprint, stateService, surfaceId, s);
        };
        const duplicate = () => {
            if (!documentService || !localBlueprint || !stateService || isTypingInField()) {
                return;
            }
            const s = getUiSelection(stateService, surfaceId);
            uiEditorDuplicateSelection(documentService, localBlueprint, stateService, surfaceId, s);
        };
        const group = () => {
            if (!documentService || !stateService || isTypingInField()) {
                return;
            }
            const s = getUiSelection(stateService, surfaceId);
            uiEditorGroupSelection(documentService, stateService, surfaceId, s);
        };
        const ungroup = () => {
            if (!documentService || !stateService || isTypingInField()) {
                return;
            }
            const s = getUiSelection(stateService, surfaceId);
            uiEditorUngroupSelection(documentService, stateService, surfaceId, s, uiService);
        };
        const selectAll = () => {
            if (!documentService || !stateService || isTypingInField()) {
                return;
            }
            uiEditorSelectAllInSurface(documentService, stateService, surfaceId, uiService);
        };
        const del = () => {
            if (!documentService || !stateService || isTypingInField()) {
                return;
            }
            const s = getUiSelection(stateService, surfaceId);
            uiEditorDeleteSelection(documentService, stateService, surfaceId, s, uiService);
        };
        const align = (op: UiEditorAlignOp) => () => {
            if (!documentService || !stateService || isTypingInField()) {
                return;
            }
            uiEditorAlign(documentService, surfaceId, getUiSelection(stateService, surfaceId), op);
        };
        const undo = () => {
            if (isTypingInField()) {
                return;
            }
            if (undoOverride) {
                // A live session. See {@link UseUIEditorKeybindingsParams.undoOverride}: this
                // editor's own stack holds snapshots of a document nobody else has agreed to.
                undoOverride.undo();
                return;
            }
            if (!historyService) {
                return;
            }
            historyService.undo(surfaceId);
        };
        const redo = () => {
            if (isTypingInField()) {
                return;
            }
            if (undoOverride) {
                undoOverride.redo();
                return;
            }
            if (!historyService) {
                return;
            }
            historyService.redo(surfaceId);
        };

        const modPairs = bindMod("ctrl", [
            { suffix: "undo", key: "z", handler: whenWritable(undo) },
            { suffix: "redo", key: "shift+z", handler: whenWritable(redo) },
            { suffix: "copy", key: "c", handler: copy },
            { suffix: "cut", key: "x", handler: whenWritable(cut) },
            { suffix: "paste", key: "v", handler: whenWritable(paste) },
            { suffix: "dup", key: "d", handler: whenWritable(duplicate) },
            { suffix: "group", key: "g", handler: whenWritable(group) },
            { suffix: "ungroup", key: "shift+g", handler: whenWritable(ungroup) },
            { suffix: "selall", key: "a", handler: selectAll },
        ]).concat(
            bindMod("meta", [
                { suffix: "undo", key: "z", handler: whenWritable(undo) },
                { suffix: "redo", key: "shift+z", handler: whenWritable(redo) },
                { suffix: "copy", key: "c", handler: copy },
                { suffix: "cut", key: "x", handler: whenWritable(cut) },
                { suffix: "paste", key: "v", handler: whenWritable(paste) },
                { suffix: "dup", key: "d", handler: whenWritable(duplicate) },
                { suffix: "group", key: "g", handler: whenWritable(group) },
                { suffix: "ungroup", key: "shift+g", handler: whenWritable(ungroup) },
                { suffix: "selall", key: "a", handler: selectAll },
            ]),
        );

        return [
            ...modPairs,
            {
                id: "delete",
                key: "delete",
                handler: whenWritable(del),
            },
            {
                id: "backspace",
                key: "backspace",
                handler: whenWritable(del),
            },
            {
                id: "f2",
                key: "f2",
                handler: whenWritable(() => {
                    requestRenamePrimary();
                }),
            },
            // Spelled out rather than generated from the op list: `keybindingCatalog.test.ts` reads
            // these from source, and a computed `id` is invisible to it - which is how six story
            // motion bindings once shipped unrebindable.
            {
                id: "align-left",
                key: "alt+a",
                handler: whenWritable(align("left")),
            },
            {
                id: "align-horizontal-center",
                key: "alt+h",
                handler: whenWritable(align("horizontalCenter")),
            },
            {
                id: "align-right",
                key: "alt+d",
                handler: whenWritable(align("right")),
            },
            {
                id: "align-top",
                key: "alt+w",
                handler: whenWritable(align("top")),
            },
            {
                id: "align-vertical-center",
                key: "alt+v",
                handler: whenWritable(align("verticalCenter")),
            },
            {
                id: "align-bottom",
                key: "alt+s",
                handler: whenWritable(align("bottom")),
            },
            {
                id: "distribute-horizontal",
                key: "alt+shift+h",
                handler: whenWritable(align("distributeHorizontal")),
            },
            {
                id: "distribute-vertical",
                key: "alt+shift+v",
                handler: whenWritable(align("distributeVertical")),
            },
        ];
    }, [
        surfaceId,
        documentService,
        localBlueprint,
        historyService,
        stateService,
        uiService,
        requestRenamePrimary,
        readOnlyActive,
        undoOverride,
    ]);

    // The keys that move the selection without a modifier: the arrows, one design pixel a press and
    // ten with Shift, and R, which puts each selected element's top-left on the nearest grid point. A
    // set of their own because they are live under a narrower condition than the rest (see
    // `areArrowKeysFreeForCanvas`): a bare letter or arrow belongs to a field or an open menu first.
    const nudgeKeybindings = useMemo<KeybindingDefinition[]>(() => {
        if (!surfaceId) {
            return [];
        }
        const canMoveSelection = (): boolean => {
            if (readOnlyActive || !documentService || !stateService) {
                return false;
            }
            // An image being cropped, or text being edited in place, on this canvas has the keys; the
            // element's frame stays where it is until that ends.
            return stateService.getInteractionOverride()?.surfaceId !== surfaceId;
        };
        const nudge = (dx: number, dy: number) => () => {
            if (!canMoveSelection() || !documentService || !stateService) {
                return;
            }
            uiEditorNudge(documentService, surfaceId, getUiSelection(stateService, surfaceId), dx, dy);
        };
        // The project's spacing whether or not grid snapping is switched on: the key is how a layout
        // made without the grid is brought onto it.
        const snapToGrid = () => {
            if (!canMoveSelection() || !documentService || !stateService) {
                return;
            }
            uiEditorSnapSelectionToGrid(
                documentService,
                surfaceId,
                getUiSelection(stateService, surfaceId),
                stateService.getGridSpacing(),
            );
        };
        const step = UI_EDITOR_NUDGE_STEP;
        const large = UI_EDITOR_NUDGE_LARGE_STEP;
        // Literal ids and keys, for the reason the align bindings above spell theirs out.
        return [
            { id: "nudge-left", key: "arrowleft", handler: nudge(-step, 0) },
            { id: "nudge-right", key: "arrowright", handler: nudge(step, 0) },
            { id: "nudge-up", key: "arrowup", handler: nudge(0, -step) },
            { id: "nudge-down", key: "arrowdown", handler: nudge(0, step) },
            { id: "nudge-left-large", key: "shift+arrowleft", handler: nudge(-large, 0) },
            { id: "nudge-right-large", key: "shift+arrowright", handler: nudge(large, 0) },
            { id: "nudge-up-large", key: "shift+arrowup", handler: nudge(0, -large) },
            { id: "nudge-down-large", key: "shift+arrowdown", handler: nudge(0, large) },
            { id: "snap-to-grid", key: "r", handler: snapToGrid },
        ];
    }, [surfaceId, documentService, stateService, readOnlyActive]);

    const escapeHandler = useCallback(() => {
        if (!stateService || !surfaceId) {
            return;
        }
        if (contextMenuOpen) {
            onCloseContextMenu();
            return;
        }
        const ov = stateService.getInteractionOverride();
        if (ov && ov.surfaceId === surfaceId) {
            stateService.setInteractionOverride(null);
            return;
        }
        selectSurfaceForProperties(stateService, surfaceId, uiService);
    }, [contextMenuOpen, onCloseContextMenu, stateService, surfaceId, uiService]);

    useKeybinding({
        id: `ui-surface-editor-${tabId}-escape`,
        key: "escape",
        description: "Close menu / exit edit / clear selection",
        catalogId: "ui-editor.escape",
        handler: escapeHandler,
        when: whenEditorFocused(tabId),
        enabled: enabled && Boolean(surfaceId && stateService),
    });

    useKeybindings({
        keybindings,
        enabled: enabled && Boolean(surfaceId && documentService && localBlueprint && historyService && stateService),
        when: and(whenEditorFocused(tabId), fromGetter(() => !isTypingInField())),
        idPrefix: `ui-surface-editor-${tabId}`,
        catalogPrefix: "ui-editor.",
    });

    useKeybindings({
        keybindings: nudgeKeybindings,
        enabled: enabled && Boolean(surfaceId && documentService && stateService),
        when: and(whenEditorFocused(tabId), fromGetter(areArrowKeysFreeForCanvas)),
        idPrefix: `ui-surface-editor-${tabId}`,
        catalogPrefix: "ui-editor.",
    });
}
