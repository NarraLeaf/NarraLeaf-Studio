import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UiEditorArrangeOp } from "@/lib/ui-editor/commands/uiEditorArrange";

/** User-triggered actions; callers wire to uiEditorCommands + UI state. */
export type UiEditorContextMenuActions = {
    hideMenu: () => void;
    /** Z-order / sibling index within parent (`childrenIds`). */
    arrange: (op: UiEditorArrangeOp) => void;
    insertType: (type: string) => void;
    paste: () => void;
    copy: () => void;
    cut: () => void;
    duplicate: () => void;
    delete: () => void;
    selectAll: () => void;
    renamePrimary: () => void;
    /** Multi or single: set layout.visible */
    setSelectedVisible: (visible: boolean) => void;
    addSelectionToLeaderGroup: () => void;
    addSelectionToComponentLibrary: () => void;
};

export type BuildCanvasContextMenuInput = {
    document: UIDocument;
    surfaceId: string;
    /** After resolveCanvasContextSelection + optional state sync */
    menuSelection: UIElementSelection | null;
    hasClipboard: boolean;
    widgetModules: UIWidgetModule[];
    documentService: UIDocumentService;
    actions: UiEditorContextMenuActions;
    /** Leader is first id and is nl.container, multi-select */
    canAddToGroup: boolean;
    allowAddToComponentLibrary?: boolean;
};

export type BuildOutlineContextMenuInput = {
    document: UIDocument;
    surfaceId: string;
    /** Row right-click: element under cursor; blank: null */
    rowElement: import("@shared/types/ui-editor/document").UIElement | null;
    /** Effective selection for bulk ops (same as canvas: retarget when row not in set) */
    menuSelection: UIElementSelection | null;
    hasClipboard: boolean;
    widgetModules: UIWidgetModule[];
    documentService: UIDocumentService;
    actions: UiEditorContextMenuActions & {
        copyElementId: (elementId: string) => void;
        pasteIntoParent: (parentId: string) => void;
        expandAllBranches: () => void;
        collapseAllBranches: () => void;
        /** Insert widget under outline-specific parent (row insert parent or blank = surface root). */
        insertChildInOutline: (type: string) => void;
    };
    canAddToGroup: boolean;
    allowAddToComponentLibrary?: boolean;
    /** For insert-child submenu on a row */
    insertParentIdForRow: string | null;
};

export type BuildOutlineMenuResult = {
    items: ContextMenuDef;
};
