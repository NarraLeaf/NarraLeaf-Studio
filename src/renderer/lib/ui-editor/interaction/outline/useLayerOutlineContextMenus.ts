import { useCallback, type MouseEvent } from "react";
import type { UIElement, UISurface } from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import type { InputDialog } from "@/lib/components/dialogs";
import { buildOutlineContextMenu } from "@/lib/ui-editor/context-menu/buildOutlineContextMenu";
import {
  resolveCanvasContextSelection,
  shouldApplyCanvasContextRetarget
} from "@/lib/ui-editor/context-menu/resolveCanvasContextSelection";
import { hasUiEditorClipboard } from "@/lib/ui-editor/commands/uiEditorClipboard";
import {
  canAddRestToLeaderContainer,
  getContainersToUngroup,
  getMoversToGroupIntoLeaderContainer
} from "@/lib/ui-editor/commands/uiEditorSelection";
import {
  defaultLayoutPatchForOutlineInsert,
  resolveNearestInsertParentInSurface
} from "@/lib/ui-editor/tree/resolveInsertTargetParent";
import { listInsertPaletteModules } from "@/lib/ui-editor/widget-modules/insertPalette";
import type { UIDocument } from "@shared/types/ui-editor/document";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import { createOutlinePanelMenuActions } from "@/lib/ui-editor/interaction/outline/outlinePanelContextActions";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { appendDeveloperIdSection, type DeveloperIdEntry } from "@/lib/developer";
import { getSurfaceDisplayLabel } from "@/lib/ui-editor/surfaceDisplayLabel";
import { translate } from "@/lib/i18n";

/**
 * The identifiers an outline menu can offer: the row's element, where there is a row, and the
 * surface the outline is a view of.
 *
 * The surface entry needs the surface itself for its noun (a Page and a Game UI are worded
 * differently), so it is dropped rather than guessed when the lookup misses.
 */
function developerIdEntries(
  elementId: string | null,
  surfaceId: string,
  surface: UISurface | undefined
): DeveloperIdEntry[] {
  const entries: DeveloperIdEntry[] = [{ kind: "element", value: elementId }];
  if (surface) {
    entries.push({
      kind: "surface",
      value: surfaceId,
      label: getSurfaceDisplayLabel(surface, translate)
    });
  }
  return entries;
}

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
    allowAddSelectionToComponentLibrary = true
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
      const menuSel = resolveCanvasContextSelection(
        surfaceId,
        element.id,
        stateService.getSelection()
      );
      const doc = documentService.getDocument();
      const surface = doc.surfaces.find((candidate) => candidate.id === surfaceId);
      const insertParentId = resolveNearestInsertParentInSurface(doc, surfaceId, element.id);
      const canGroup =
        Boolean(menuSel) &&
        canAddRestToLeaderContainer(menuSel!, doc) &&
        getMoversToGroupIntoLeaderContainer(doc, menuSel!).length > 0;
      const canUngroup = getContainersToUngroup(doc, surfaceId, menuSel).length > 0;

      const insertChildInOutline = (type: string) => {
        if (!insertParentId) {
          return;
        }
        const patch = defaultLayoutPatchForOutlineInsert(
          documentService.getDocument(),
          insertParentId
        );
        const created = documentService.createElement(insertParentId, type, patch);
        stateService.setUIElementSelection({
          editor: "ui",
          surfaceId,
          elementIds: [created.id],
          primaryId: created.id
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
        canRenamePrimary: () => true
      });

      const items = buildOutlineContextMenu({
        document: doc,
        surfaceId,
        rowElement: element,
        menuSelection: menuSel,
        hasClipboard: hasUiEditorClipboard(),
        widgetModules: listInsertPaletteModules(surface),
        documentService,
        insertParentIdForRow: insertParentId,
        canAddToGroup: canGroup,
        canUngroup,
        allowAddToComponentLibrary: allowAddSelectionToComponentLibrary,
        actions
      });
      setMenuItems(
        appendDeveloperIdSection(items, developerIdEntries(element.id, surfaceId, surface), {
          hideMenu,
          notify: uiService?.showNotification.bind(uiService)
        })
      );
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
      allowAddSelectionToComponentLibrary
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
      const surface = doc.surfaces.find((candidate) => candidate.id === surfaceId);
      const canGroup =
        Boolean(menuSel) &&
        canAddRestToLeaderContainer(menuSel!, doc) &&
        getMoversToGroupIntoLeaderContainer(doc, menuSel!).length > 0;
      const canUngroup = getContainersToUngroup(doc, surfaceId, menuSel).length > 0;

      const insertOutline = (type: string) => {
        const fresh = documentService.getDocument();
        const parentId = effectiveRootId;
        const patch = defaultLayoutPatchForOutlineInsert(fresh, parentId);
        const created = documentService.createElement(parentId, type, patch);
        stateService.setUIElementSelection({
          editor: "ui",
          surfaceId,
          elementIds: [created.id],
          primaryId: created.id
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
        canRenamePrimary: (sel) => sel.elementIds.length === 1
      });

      const items = buildOutlineContextMenu({
        document: doc,
        surfaceId,
        rowElement: null,
        menuSelection: menuSel,
        hasClipboard: hasUiEditorClipboard(),
        widgetModules: listInsertPaletteModules(surface),
        documentService,
        insertParentIdForRow: null,
        canAddToGroup: canGroup,
        canUngroup,
        allowAddToComponentLibrary: allowAddSelectionToComponentLibrary,
        actions
      });
      setMenuItems(
        appendDeveloperIdSection(items, developerIdEntries(null, surfaceId, surface), {
          hideMenu,
          notify: uiService?.showNotification.bind(uiService)
        })
      );
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
      allowAddSelectionToComponentLibrary
    ]
  );

  return { openRowContextMenu, openBlankContextMenu };
}
