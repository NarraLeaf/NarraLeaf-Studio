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
    uiEditorGroupIntoLeaderContainer,
    uiEditorPasteAfterSelection,
    uiEditorSelectAllInSurface,
    uiEditorUngroupSelection,
} from "@/lib/ui-editor/commands/uiEditorCommands";
import { selectSurfaceForProperties } from "@/lib/ui-editor/commands/uiEditorSelection";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { UI_EDITOR_WRITABLE, type UIEditorReadOnly } from "./readOnlyInteraction";

function isTypingInField(): boolean {
    return isEditableKeyboardTarget(document.activeElement);
}

function getUiSelection(stateService: UIEditorStateService, surfaceId: string): UIElementSelection | null {
    const sel = stateService.getSelection();
    if (!isUIElementSelection(sel)) {
        return null;
    }
    const data = sel.data as UIElementSelection;
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
            uiEditorPasteAfterSelection(documentService, localBlueprint, stateService, surfaceId, s);
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
            uiEditorGroupIntoLeaderContainer(documentService, stateService, surfaceId, s);
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
        const undo = () => {
            if (!historyService || isTypingInField()) {
                return;
            }
            historyService.undo(surfaceId);
        };
        const redo = () => {
            if (!historyService || isTypingInField()) {
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
    ]);

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
}
