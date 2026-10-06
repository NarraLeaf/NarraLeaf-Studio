import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UiEditorArrangeOp } from "@/lib/ui-editor/commands/uiEditorArrange";
import type { UiEditorAlignOp } from "@/lib/ui-editor/commands/uiEditorAlign";
import type { ComponentRootSwapMenuEntry } from "./componentRootSwapMenu";

/** User-triggered actions; callers wire to uiEditorCommands + UI state. */
export type UiEditorContextMenuActions = {
    hideMenu: () => void;
    /** Z-order / sibling index within parent (`childrenIds`). */
    arrange: (op: UiEditorArrangeOp) => void;
    /** Geometric alignment and distribution, computed in surface space. */
    align: (op: UiEditorAlignOp) => void;
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
    /** Wrap the selection in a new group. */
    groupSelection: () => void;
    /** Dissolve the selected groups; their children take their place. */
    ungroupSelection: () => void;
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
    /** The selection can be wrapped in a new group (see `canGroupSelection`). */
    canGroup: boolean;
    /** At least one selected element is a group that can be dissolved */
    canUngroup: boolean;
    allowAddToComponentLibrary?: boolean;
    /** Why Insert is greyed out (`describeSurfaceInsertRefusal`), or null when the surface takes new elements. */
    insertBlockedReason: string | null;
    /** Set as Root Element or Wrap in Container, in a component's own editor (`resolveComponentRootSwapMenuEntry`). */
    rootSwap?: ComponentRootSwapMenuEntry | null;
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
        pasteIntoParent: (parentId: string) => void;
        expandAllBranches: () => void;
        collapseAllBranches: () => void;
        /** Insert widget under outline-specific parent (row insert parent or blank = surface root). */
        insertChildInOutline: (type: string) => void;
    };
    canGroup: boolean;
    /** At least one selected element is a group that can be dissolved */
    canUngroup: boolean;
    allowAddToComponentLibrary?: boolean;
    /** The row's nearest parent that takes pasted elements, for Paste into Container. */
    insertParentIdForRow: string | null;
    /**
     * Why Insert Child (on a row) or Insert (on the blank area) is greyed out, or null when it is not:
     * the row itself, or the surface's root, takes no new element (`describeInsertRefusal`).
     */
    insertBlockedReason: string | null;
    /** Set as Root Element or Wrap in Container, in a component's own editor (`resolveComponentRootSwapMenuEntry`). */
    rootSwap?: ComponentRootSwapMenuEntry | null;
};

export type BuildOutlineMenuResult = {
    items: ContextMenuDef;
};
