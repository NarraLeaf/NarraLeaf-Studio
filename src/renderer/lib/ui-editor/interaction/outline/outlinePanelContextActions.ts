import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { InputDialog } from "@/lib/components/dialogs";
import type { BuildOutlineContextMenuInput } from "@/lib/ui-editor/context-menu/types";
import { uiEditorArrange } from "@/lib/ui-editor/commands/uiEditorArrange";
import {
    uiEditorCopySelection,
    uiEditorCutSelection,
    uiEditorDeleteSelection,
    uiEditorDuplicateSelection,
    uiEditorGroupIntoLeaderContainer,
    uiEditorPaste,
    uiEditorPasteIntoParent,
    uiEditorSelectAllInSurface,
} from "@/lib/ui-editor/commands/uiEditorCommands";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";

const ROOT_WIDGET_TYPE = "nl.root";

export type OutlinePanelMenuActions = BuildOutlineContextMenuInput["actions"];

async function writeTextToClipboard(text: string): Promise<void> {
    const clipboard = typeof navigator !== "undefined" ? navigator.clipboard : null;
    if (clipboard?.writeText) {
        await clipboard.writeText(text);
        return;
    }

    if (typeof document === "undefined") {
        throw new Error("Clipboard API is not available.");
    }

    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.left = "-9999px";
    textarea.style.top = "0";
    document.body.appendChild(textarea);
    textarea.select();
    try {
        if (!document.execCommand("copy")) {
            throw new Error("Copy command was rejected.");
        }
    } finally {
        textarea.remove();
    }
}

export function createOutlinePanelMenuActions(params: {
    documentService: UIDocumentService;
    stateService: UIEditorStateService;
    uiService?: UIService | null;
    localBlueprint: LocalBlueprintService;
    surfaceId: string;
    hideMenu: () => void;
    inputDialog: InputDialog | null;
    menuSel: UIElementSelection | null;
    doc: UIDocument;
    effectiveRootId: string;
    collectBranchIdsWithChildren: (rootId: string) => string[];
    insertChildInOutline: (type: string) => void;
    /** Row: element.id; blank area: null */
    pasteHitElementId: string | null;
    /** Row: primary ?? last id; blank: primary ?? first id, with single-selection guard in canRenamePrimary */
    pickRenamePrimaryId: (sel: UIElementSelection) => string | undefined;
    canRenamePrimary: (sel: UIElementSelection) => boolean;
}): OutlinePanelMenuActions {
    const {
        documentService,
        stateService,
        uiService,
        localBlueprint,
        surfaceId,
        hideMenu,
        inputDialog,
        menuSel,
        doc,
        effectiveRootId,
        collectBranchIdsWithChildren,
        insertChildInOutline,
        pasteHitElementId,
        pickRenamePrimaryId,
        canRenamePrimary,
    } = params;

    return {
        hideMenu,
        insertType: () => {},
        arrange: op => {
            if (!documentService || !menuSel) {
                return;
            }
            uiEditorArrange(documentService, surfaceId, menuSel, op);
        },
        insertChildInOutline,
        paste: () => {
            const sel = stateService.getSelection();
            const data = sel.type === "element" ? sel.data : null;
            const primary =
                data?.editor === "ui" && data.surfaceId === surfaceId
                    ? (data.primaryId ?? data.elementIds[data.elementIds.length - 1] ?? null)
                    : null;
            uiEditorPaste(documentService, localBlueprint, stateService, surfaceId, {
                hitElementId: pasteHitElementId,
                primaryElementId: primary,
            });
        },
        pasteIntoParent: parentId => {
            uiEditorPasteIntoParent(documentService, localBlueprint, stateService, surfaceId, parentId, null);
        },
        copyElementId: elementId => {
            void writeTextToClipboard(elementId)
                .then(() => {
                    uiService?.showNotification("Element ID copied.", "success");
                })
                .catch(error => {
                    uiService?.showNotification("Failed to copy Element ID.", "error");
                    console.error(error);
                });
        },
        copy: () => uiEditorCopySelection(documentService, localBlueprint, surfaceId, menuSel),
        cut: () => uiEditorCutSelection(documentService, localBlueprint, stateService, surfaceId, menuSel, uiService),
        duplicate: () =>
            uiEditorDuplicateSelection(documentService, localBlueprint, stateService, surfaceId, menuSel),
        delete: () => uiEditorDeleteSelection(documentService, stateService, surfaceId, menuSel, uiService),
        selectAll: () => uiEditorSelectAllInSurface(documentService, stateService, surfaceId, uiService),
        renamePrimary: () => {
            if (!menuSel || !inputDialog || !canRenamePrimary(menuSel)) {
                return;
            }
            const pid = pickRenamePrimaryId(menuSel);
            if (!pid) {
                return;
            }
            const el = doc.elements[pid];
            if (!el || el.type === ROOT_WIDGET_TYPE || isComponentEditorRootElement(el)) {
                return;
            }
            void inputDialog.showRenameDialog(el.name ?? el.type ?? "Layer", "layer").then(name => {
                if (name) {
                    documentService.renameElement(pid, name);
                }
            });
        },
        setSelectedVisible: visible => {
            if (!menuSel) {
                return;
            }
            for (const id of menuSel.elementIds) {
                const el = doc.elements[id];
                if (el && el.type !== ROOT_WIDGET_TYPE && !isComponentEditorRootElement(el)) {
                    documentService.updateElementLayout(id, { visible });
                }
            }
        },
        addSelectionToLeaderGroup: () => {
            uiEditorGroupIntoLeaderContainer(documentService, stateService, surfaceId, menuSel);
        },
        addSelectionToComponentLibrary: () => {
            if (!menuSel || menuSel.elementIds.length === 0) {
                return;
            }
            const primaryId = menuSel.primaryId ?? menuSel.elementIds[0];
            const primary = primaryId ? doc.elements[primaryId] : null;
            const fallbackName =
                menuSel.elementIds.length === 1
                    ? primary?.name ?? primary?.type ?? "Component"
                    : "Component";
            const component = documentService.createComponentFromElements(surfaceId, menuSel.elementIds, fallbackName);
            if (component) {
                uiService?.showNotification(`Added "${component.name}" to Component Library`, "success");
            }
        },
        expandAllBranches: () => {
            for (const id of collectBranchIdsWithChildren(effectiveRootId)) {
                stateService.setOutlineBranchCollapsed(id, false);
            }
        },
        collapseAllBranches: () => {
            for (const id of collectBranchIdsWithChildren(effectiveRootId)) {
                stateService.setOutlineBranchCollapsed(id, true);
            }
        },
    };
}
