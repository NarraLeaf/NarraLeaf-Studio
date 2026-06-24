import { useCallback, type MouseEvent } from "react";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { InputDialog } from "@/lib/components/dialogs";
import { buildOutlineContextMenu } from "@/lib/ui-editor/context-menu/buildOutlineContextMenu";
import {
    resolveCanvasContextSelection,
    shouldApplyCanvasContextRetarget,
} from "@/lib/ui-editor/context-menu/resolveCanvasContextSelection";
import { hasUiEditorClipboard } from "@/lib/ui-editor/commands/uiEditorClipboard";
import {
    canAddRestToLeaderContainer,
    getMoversToGroupIntoLeaderContainer,
} from "@/lib/ui-editor/commands/uiEditorSelection";
import {
    defaultLayoutPatchForOutlineInsert,
    resolveNearestInsertParentInSurface,
} from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { listInsertPaletteModules } from "@/lib/ui-editor/widget-modules/insertPalette";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { createOutlinePanelMenuActions } from "@/lib/ui-editor/interaction/outline/outlinePanelContextActions";
import type { UIService } from "@/lib/workspace/services/core/UIService";

export function useLayerOutlineContextMenus(params: {
    surfaceId: string;
    documentService: UIDocumentService;
    stateService: UIEditorStateService;
    uiService?: UIService | null;
    localBlueprint: LocalBlueprintService;
    inputDialog: InputDialog | null;
    effectiveRootId: string | null;
    document: UIDocument;
    collectBranchIdsWithChildren: (rootId: string) => string[];
    showMenu: (event: MouseEvent<HTMLElement>) => void;
    hideMenu: () => void;
    setMenuItems: (items: ContextMenuDef) => void;
    allowAddSelectionToComponentLibrary?: boolean;
}) {
    const {
        surfaceId,
        documentService,
        stateService,
        uiService,
        localBlueprint,
        inputDialog,
        effectiveRootId,
        document,
        collectBranchIdsWithChildren,
        showMenu,
        hideMenu,
        setMenuItems,
        allowAddSelectionToComponentLibrary = true,
    } = params;

    const openRowContextMenu = useCallback(
        (element: UIElement, event: MouseEvent<HTMLElement>) => {
            event.preventDefault();
            event.stopPropagation();
            if (!effectiveRootId) {
                return;
            }
            const curSel = stateService.getSelection();
            if (shouldApplyCanvasContextRetarget(surfaceId, element.id, curSel)) {
                const nextSel = resolveCanvasContextSelection(surfaceId, element.id, curSel);
                if (nextSel) {
                    stateService.setUIElementSelection(nextSel);
                }
            }
            const menuSel = resolveCanvasContextSelection(surfaceId, element.id, stateService.getSelection());
            const doc = documentService.getDocument();
            const surfaceKind = doc.surfaces.find(surface => surface.id === surfaceId)?.kind;
            const insertParentId = resolveNearestInsertParentInSurface(doc, surfaceId, element.id);
            const canGroup =
                Boolean(menuSel) &&
                canAddRestToLeaderContainer(menuSel!, doc) &&
                getMoversToGroupIntoLeaderContainer(doc, menuSel!).length > 0;

            const insertChildInOutline = (type: string) => {
                if (!insertParentId) {
                    return;
                }
                const patch = defaultLayoutPatchForOutlineInsert(documentService.getDocument(), insertParentId);
                const created = documentService.createElement(insertParentId, type, patch);
                stateService.setUIElementSelection({
                    editor: "ui",
                    surfaceId,
                    elementIds: [created.id],
                    primaryId: created.id,
                });
                stateService.setTool({ kind: "select" });
            };

            const actions = createOutlinePanelMenuActions({
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
                pasteHitElementId: element.id,
                pickRenamePrimaryId: (sel: UIElementSelection) =>
                    sel.primaryId ?? sel.elementIds[sel.elementIds.length - 1],
                canRenamePrimary: () => true,
            });

            const items = buildOutlineContextMenu({
                document: doc,
                surfaceId,
                rowElement: element,
                menuSelection: menuSel,
                hasClipboard: hasUiEditorClipboard(),
                widgetModules: listInsertPaletteModules(surfaceKind),
                documentService,
                insertParentIdForRow: insertParentId,
                canAddToGroup: canGroup,
                allowAddToComponentLibrary: allowAddSelectionToComponentLibrary,
                actions,
            });
            setMenuItems(items);
            showMenu(event);
        },
        [
            collectBranchIdsWithChildren,
            document,
            documentService,
            effectiveRootId,
            hideMenu,
            inputDialog,
            localBlueprint,
            uiService,
            showMenu,
            setMenuItems,
            stateService,
            surfaceId,
            allowAddSelectionToComponentLibrary,
        ]
    );

    const openBlankContextMenu = useCallback(
        (event: MouseEvent<HTMLDivElement>) => {
            if (!effectiveRootId) {
                return;
            }
            event.preventDefault();
            const t = event.target as HTMLElement | null;
            if (t?.closest?.("[data-outline-row]")) {
                return;
            }
            const menuSel = resolveCanvasContextSelection(surfaceId, null, stateService.getSelection());
            const doc = documentService.getDocument();
            const surfaceKind = doc.surfaces.find(surface => surface.id === surfaceId)?.kind;
            const canGroup =
                Boolean(menuSel) &&
                canAddRestToLeaderContainer(menuSel!, doc) &&
                getMoversToGroupIntoLeaderContainer(doc, menuSel!).length > 0;

            const insertOutline = (type: string) => {
                const fresh = documentService.getDocument();
                const parentId = effectiveRootId;
                const patch = defaultLayoutPatchForOutlineInsert(fresh, parentId);
                const created = documentService.createElement(parentId, type, patch);
                stateService.setUIElementSelection({
                    editor: "ui",
                    surfaceId,
                    elementIds: [created.id],
                    primaryId: created.id,
                });
                stateService.setTool({ kind: "select" });
            };

            const actions = createOutlinePanelMenuActions({
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
                insertChildInOutline: insertOutline,
                pasteHitElementId: null,
                pickRenamePrimaryId: (sel: UIElementSelection) => sel.primaryId ?? sel.elementIds[0],
                canRenamePrimary: sel => sel.elementIds.length === 1,
            });

            const items = buildOutlineContextMenu({
                document: doc,
                surfaceId,
                rowElement: null,
                menuSelection: menuSel,
                hasClipboard: hasUiEditorClipboard(),
                widgetModules: listInsertPaletteModules(surfaceKind),
                documentService,
                insertParentIdForRow: null,
                canAddToGroup: canGroup,
                allowAddToComponentLibrary: allowAddSelectionToComponentLibrary,
                actions,
            });
            setMenuItems(items);
            showMenu(event);
        },
        [
            collectBranchIdsWithChildren,
            documentService,
            effectiveRootId,
            hideMenu,
            inputDialog,
            localBlueprint,
            uiService,
            showMenu,
            setMenuItems,
            stateService,
            surfaceId,
            allowAddSelectionToComponentLibrary,
        ]
    );

    return { openRowContextMenu, openBlankContextMenu };
}
