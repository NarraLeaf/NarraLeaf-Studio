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

const ROOT_WIDGET_TYPE = "nl.root";

export type OutlinePanelMenuActions = BuildOutlineContextMenuInput["actions"];

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
            if (!el || el.type === ROOT_WIDGET_TYPE) {
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
                if (el && el.type !== ROOT_WIDGET_TYPE) {
                    documentService.updateElementLayout(id, { visible });
                }
            }
        },
        addSelectionToLeaderGroup: () => {
            uiEditorGroupIntoLeaderContainer(documentService, stateService, surfaceId, menuSel);
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
