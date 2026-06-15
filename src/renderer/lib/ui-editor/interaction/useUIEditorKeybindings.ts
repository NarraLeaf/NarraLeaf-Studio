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
    uiEditorPaste,
    uiEditorSelectAllInSurface,
} from "@/lib/ui-editor/commands/uiEditorCommands";
import { isEditableKeyboardTarget } from "@/lib/workspace/services/ui/keyboardEditable";

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
    requestRenamePrimary: () => void;
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
        requestRenamePrimary,
    } = params;

    const keybindings = useMemo<KeybindingDefinition[]>(() => {
        if (!surfaceId) {
            return [];
        }

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
            uiEditorCutSelection(documentService, localBlueprint, stateService, surfaceId, s);
        };
        const paste = () => {
            if (!documentService || !localBlueprint || !stateService || isTypingInField()) {
                return;
            }
            const sel = stateService.getSelection();
            const data = sel.type === "element" ? sel.data : null;
            const primary =
                data && (data as UIElementSelection).editor === "ui" && (data as UIElementSelection).surfaceId === surfaceId
                    ? ((data as UIElementSelection).primaryId ??
                      (data as UIElementSelection).elementIds[(data as UIElementSelection).elementIds.length - 1] ??
                      null)
                    : null;
            // Do not pass last context-menu hit: it is stale after the menu closes and would paste
            // into the wrong container (hit wins over primary in resolveInsertTargetParent).
            uiEditorPaste(documentService, localBlueprint, stateService, surfaceId, {
                hitElementId: null,
                primaryElementId: primary,
            });
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
        const selectAll = () => {
            if (!documentService || !stateService || isTypingInField()) {
                return;
            }
            uiEditorSelectAllInSurface(documentService, stateService, surfaceId);
        };
        const del = () => {
            if (!documentService || !stateService || isTypingInField()) {
                return;
            }
            const s = getUiSelection(stateService, surfaceId);
            uiEditorDeleteSelection(documentService, stateService, surfaceId, s);
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
            { suffix: "undo", key: "z", handler: undo },
            { suffix: "redo", key: "shift+z", handler: redo },
            { suffix: "copy", key: "c", handler: copy },
            { suffix: "cut", key: "x", handler: cut },
            { suffix: "paste", key: "v", handler: paste },
            { suffix: "dup", key: "d", handler: duplicate },
            { suffix: "group", key: "g", handler: group },
            { suffix: "selall", key: "a", handler: selectAll },
        ]).concat(
            bindMod("meta", [
                { suffix: "undo", key: "z", handler: undo },
                { suffix: "redo", key: "shift+z", handler: redo },
                { suffix: "copy", key: "c", handler: copy },
                { suffix: "cut", key: "x", handler: cut },
                { suffix: "paste", key: "v", handler: paste },
                { suffix: "dup", key: "d", handler: duplicate },
                { suffix: "group", key: "g", handler: group },
                { suffix: "selall", key: "a", handler: selectAll },
            ]),
        );

        return [
            ...modPairs,
            {
                id: "delete",
                key: "delete",
                handler: del,
            },
            {
                id: "backspace",
                key: "backspace",
                handler: del,
            },
            {
                id: "f2",
                key: "f2",
                handler: () => {
                    requestRenamePrimary();
                },
            },
        ];
    }, [
        surfaceId,
        documentService,
        localBlueprint,
        historyService,
        stateService,
        requestRenamePrimary,
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
        stateService.setSelection({ type: null, data: null });
    }, [contextMenuOpen, onCloseContextMenu, stateService, surfaceId]);

    useKeybinding({
        id: `ui-surface-editor-${tabId}-escape`,
        key: "escape",
        description: "Close menu / exit edit / clear selection",
        handler: escapeHandler,
        when: whenEditorFocused(tabId),
        enabled: enabled && Boolean(surfaceId && stateService),
    });

    useKeybindings({
        keybindings,
        enabled: enabled && Boolean(surfaceId && documentService && localBlueprint && historyService && stateService),
        when: and(whenEditorFocused(tabId), fromGetter(() => !isTypingInField())),
        idPrefix: `ui-surface-editor-${tabId}`,
    });
}
