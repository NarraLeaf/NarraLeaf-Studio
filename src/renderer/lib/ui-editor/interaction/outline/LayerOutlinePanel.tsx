import {
  startTransition,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent
} from "react";
import { createPortal } from "react-dom";
import type {
  Collision,
  CollisionDetection,
  DragEndEvent,
  DragMoveEvent,
  DragStartEvent
} from "@dnd-kit/core";
import {
  DndContext,
  MeasuringStrategy,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import type { UIElement } from "@shared/types/ui-editor/document";
import { isUIElementSelection } from "@services/ui/UIStore";
import {
  ContextMenu,
  type ContextMenuDef,
  useContextMenu
} from "@/lib/components/elements/ContextMenu";
import type { InputDialog } from "@/lib/components/dialogs";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIEditorStateService } from "@services/ui-editor/UIEditorStateService";
import {
  moveLogReason,
  resolveBeforeChildIdForOutlineGap
} from "@/lib/ui-editor/interaction/outline/outlineDropGeometry";
import {
  isOutlineGapDropData,
  OUTLINE_ROOT_WIDGET_TYPE,
  OutlineDragPreview,
  OutlineSubtree
} from "@/lib/ui-editor/interaction/outline/LayerOutlineRows";
import { computeOutlineSignature } from "@/lib/ui-editor/interaction/outline/outlineSignature";
import { useLayerOutlineContextMenus } from "@/lib/ui-editor/interaction/outline/useLayerOutlineContextMenus";
import { selectSurfaceForProperties } from "@/lib/ui-editor/commands/uiEditorSelection";
import type { UIService } from "@/lib/workspace/services/core/UIService";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import { useTranslation } from "@/lib/i18n";
import {
  isSurfaceGestureEnabled,
  UI_EDITOR_WRITABLE,
  type UIEditorReadOnly
} from "@/lib/ui-editor/interaction/readOnlyInteraction";
// The freeze guard's menu walker, reused rather than re-implemented: these rows are assembled by
// `buildOutlineContextMenu` and extended by widget modules at runtime, so there is nothing to spread
// `menuRow()` onto. Same import direction as `useUIEditorKeybindings`, which reaches for the
// workspace's keybinding hooks.
import { freezeContextMenuRows } from "@/apps/workspace/components/ui/freezeGuard";
import { DEVELOPER_MENU_ROW_IDS } from "@/lib/developer";

export type UILayersPanelProps = {
  surfaceId: string;
  stateService: UIEditorStateService;
  documentService: UIDocumentService;
  uiService?: UIService | null;
  localBlueprint: LocalBlueprintService;
  inputDialog: InputDialog | null;
  allowAddSelectionToComponentLibrary?: boolean;
  /** Reorder, rename, visibility and every editing menu row go inert. Selection stays. */
  readOnly?: UIEditorReadOnly;
};

/**
 * The outline menu rows a read-only surface keeps: the ones that only read.
 *
 * Copy fills the clipboard, the developer section copies identifiers into it, Select All / Expand All
 * / Collapse All move selection and editor state. Everything else - insert, paste, cut, duplicate,
 * rename, delete, visibility, group, add-to-library, and whatever a widget module contributes under
 * `sep-widget` - edits the document, so it is not named here and is therefore disabled.
 */
const READ_ONLY_OUTLINE_MENU_IDS: ReadonlySet<string> = new Set([
  "copy",
  ...DEVELOPER_MENU_ROW_IDS,
  "select-all",
  "expand-all",
  "collapse-all"
]);

function collisionHasOutlineGapData(collision: Collision): boolean {
  return isOutlineGapDropData(collision.data?.droppableContainer.data.current);
}

const OUTLINE_DND_MEASURING = {
  droppable: {
    strategy: MeasuringStrategy.Always
  }
};

function getOutlineGapCollisionAtPointer(
  args: Parameters<CollisionDetection>[0]
): Collision[] | null {
  const { pointerCoordinates } = args;
  const doc = globalThis.document;
  if (!pointerCoordinates || typeof doc?.elementsFromPoint !== "function") {
    return null;
  }

  const elements = doc.elementsFromPoint(pointerCoordinates.x, pointerCoordinates.y);
  for (const element of elements) {
    const gapElement = element.closest("[data-outline-gap-id]") as HTMLElement | null;
    const gapId = gapElement?.dataset.outlineGapId;
    if (!gapId) {
      continue;
    }
    const droppableContainer = args.droppableContainers.find(
      (container) => String(container.id) === gapId
    );
    if (!droppableContainer || !isOutlineGapDropData(droppableContainer.data.current)) {
      continue;
    }
    return [
      {
        id: droppableContainer.id,
        data: {
          droppableContainer,
          value: 0
        }
      }
    ];
  }
  return [];
}

function getActivatorClientPoint(event: Event | null): { x: number; y: number } | null {
  if (!event) {
    return null;
  }
  const eventRecord = event as unknown as Record<string, unknown>;
  const clientX = eventRecord.clientX;
  const clientY = eventRecord.clientY;
  if (typeof clientX === "number" && typeof clientY === "number") {
    return { x: clientX, y: clientY };
  }

  const touches = eventRecord.touches;
  const firstTouch = getFirstTouchPoint(touches);
  if (firstTouch) {
    return firstTouch;
  }

  const changedTouches = eventRecord.changedTouches;
  return getFirstTouchPoint(changedTouches);
}

function getFirstTouchPoint(value: unknown): { x: number; y: number } | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const touchList = value as { length?: unknown; item?: (index: number) => unknown; 0?: unknown };
  const length = typeof touchList.length === "number" ? touchList.length : 0;
  if (length <= 0) {
    return null;
  }
  const first = typeof touchList.item === "function" ? touchList.item(0) : touchList[0];
  if (!first || typeof first !== "object") {
    return null;
  }
  const touch = first as Record<string, unknown>;
  return typeof touch.clientX === "number" && typeof touch.clientY === "number"
    ? { x: touch.clientX, y: touch.clientY }
    : null;
}

export function UILayersPanel({
  surfaceId,
  stateService,
  documentService,
  uiService,
  localBlueprint,
  inputDialog,
  allowAddSelectionToComponentLibrary = true,
  readOnly = UI_EDITOR_WRITABLE
}: UILayersPanelProps) {
  const { t } = useTranslation();
  const [docVersion, setDocVersion] = useState(0);
  const [selection, setSelection] = useState(stateService.getSelection());
  const [outlineRev, setOutlineRev] = useState(0);
  const [activeDragId, setActiveDragId] = useState<string | null>(null);
  const [activeDragPoint, setActiveDragPoint] = useState<{ x: number; y: number } | null>(null);
  const initialDragPointRef = useRef<{ x: number; y: number } | null>(null);
  const { menuState, showMenu, hideMenu } = useContextMenu();
  const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);

  // Redraw for the changes the outline can show, and ignore the rest. See `computeOutlineSignature`
  // for why: a row is not a cheap `<li>`, it is a dnd-kit draggable, and there are one per layer.
  const outlineSignatureRef = useRef<string | null>(null);
  useEffect(() => {
    outlineSignatureRef.current = computeOutlineSignature(documentService.getDocument(), surfaceId);
    return documentService.onDocumentChanged(() => {
      const next = computeOutlineSignature(documentService.getDocument(), surfaceId);
      if (next === outlineSignatureRef.current) {
        return;
      }
      outlineSignatureRef.current = next;
      startTransition(() => {
        setDocVersion((v) => v + 1);
      });
    });
  }, [documentService, surfaceId]);

  useEffect(() => {
    return stateService.on("selectionChanged", (selectionNext) => {
      startTransition(() => {
        setSelection(selectionNext);
      });
    });
  }, [stateService]);

  useEffect(() => {
    return stateService.on("outlineExpansionChanged", () => {
      setOutlineRev((v) => v + 1);
    });
  }, [stateService]);

  void docVersion;

  const document = documentService.getDocument();
  const surface = document.surfaces.find((surf) => surf.id === surfaceId);
  const effectiveRootId = surface ? resolveSurfaceRootElementId(document, surfaceId) : null;
  const root = effectiveRootId ? document.elements[effectiveRootId] : undefined;
  const outlineRoot = useMemo(() => {
    if (!root) {
      return undefined;
    }
    if (root.type === OUTLINE_ROOT_WIDGET_TYPE && root.childrenIds.length === 1) {
      const child = document.elements[root.childrenIds[0]];
      if (isComponentEditorRootElement(child)) {
        return child;
      }
    }
    return root;
  }, [document.elements, root]);
  const outlineEffectiveRootId = outlineRoot?.id ?? effectiveRootId;

  const isLinkedTree =
    surface != null && effectiveRootId != null && effectiveRootId !== surface.rootElementId;

  const selectionData = isUIElementSelection(selection) ? selection.data : null;
  const selectedIds = useMemo(() => new Set(selectionData?.elementIds ?? []), [selectionData]);
  const primaryId =
    selectionData?.primaryId ?? selectionData?.elementIds?.[selectionData.elementIds.length - 1];

  const handleSelect = useCallback(
    (id: string, event: MouseEvent<HTMLElement>) => {
      let nextIds: string[] = [];

      // Align with canvas: Shift adds to selection; Ctrl/Meta toggles membership.
      if (event.shiftKey && selectionData?.surfaceId === surfaceId) {
        if (selectedIds.has(id)) {
          nextIds = Array.from(selectedIds);
        } else {
          nextIds = [...selectedIds, id];
        }
      } else if (event.metaKey || event.ctrlKey) {
        if (selectedIds.has(id)) {
          nextIds = Array.from(selectedIds).filter((existing) => existing !== id);
        } else {
          nextIds = [...selectedIds, id];
        }
        if (nextIds.length === 0) {
          selectSurfaceForProperties(stateService, surfaceId, uiService);
          return;
        }
      } else {
        nextIds = [id];
      }

      stateService.setUIElementSelection({
        editor: "ui",
        surfaceId,
        elementIds: nextIds,
        primaryId: id
      });
    },
    [selectedIds, selectionData?.surfaceId, stateService, surfaceId]
  );

  const isCollapsed = useCallback(
    (elementId: string) => {
      void outlineRev;
      return stateService.isOutlineBranchCollapsed(elementId);
    },
    [outlineRev, stateService]
  );

  const toggleCollapsed = useCallback(
    (elementId: string) => {
      const next = !stateService.isOutlineBranchCollapsed(elementId);
      stateService.setOutlineBranchCollapsed(elementId, next);
    },
    [stateService]
  );

  const onToggleVisible = useCallback(
    (element: UIElement, event: MouseEvent) => {
      event.stopPropagation();
      if (!isSurfaceGestureEnabled("outlineVisibility", readOnly)) {
        return;
      }
      if (element.type === OUTLINE_ROOT_WIDGET_TYPE || isComponentEditorRootElement(element)) {
        return;
      }
      const isHidden = element.layout.visible === false;
      documentService.updateElementLayout(element.id, { visible: isHidden ? true : false });
    },
    [documentService, readOnly]
  );

  const onStartRename = useCallback(
    (element: UIElement) => {
      if (!isSurfaceGestureEnabled("outlineRename", readOnly)) {
        return;
      }
      if (
        !inputDialog ||
        element.type === OUTLINE_ROOT_WIDGET_TYPE ||
        isComponentEditorRootElement(element)
      ) {
        return;
      }
      void inputDialog
        .showRenameDialog(element.name ?? element.type ?? t("widgetChrome.outline.layer"), "layer")
        .then((name) => {
          if (name) {
            documentService.renameElement(element.id, name);
          }
        });
    },
    [documentService, inputDialog, readOnly, t]
  );

  const collectBranchIdsWithChildren = useCallback(
    (rootId: string) => {
      const ids: string[] = [];
      const walk = (eid: string) => {
        const el = document.elements[eid];
        if (!el) {
          return;
        }
        if (el.childrenIds.length > 0) {
          ids.push(eid);
          el.childrenIds.forEach(walk);
        }
      };
      walk(rootId);
      return ids;
    },
    [document.elements]
  );

  const setReadOnlyAwareMenuItems = useCallback(
    (items: ContextMenuDef) => {
      setMenuItems(
        freezeContextMenuRows(items, readOnly.active, READ_ONLY_OUTLINE_MENU_IDS, readOnly.reason)
      );
    },
    [readOnly.active, readOnly.reason]
  );

  const { openRowContextMenu, openBlankContextMenu } = useLayerOutlineContextMenus({
    surfaceId,
    documentService,
    stateService,
    uiService,
    localBlueprint,
    inputDialog,
    effectiveRootId: outlineEffectiveRootId,
    document,
    collectBranchIdsWithChildren,
    showMenu,
    hideMenu,
    setMenuItems: setReadOnlyAwareMenuItems,
    allowAddSelectionToComponentLibrary
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 4 }
    })
  );

  const collisionDetection = useCallback<CollisionDetection>((args) => {
    const gapCollision = getOutlineGapCollisionAtPointer(args);
    if (gapCollision) {
      if (gapCollision.length > 0) {
        return gapCollision;
      }
      return pointerWithin(args).filter((collision) => !collisionHasOutlineGapData(collision));
    }

    const collisions = pointerWithin(args);
    const gapCollisions = collisions.filter(collisionHasOutlineGapData);

    if (gapCollisions.length > 0) {
      return gapCollisions;
    }

    return collisions;
  }, []);

  const handleDragStart = useCallback((event: DragStartEvent) => {
    const point = getActivatorClientPoint(event.activatorEvent);
    initialDragPointRef.current = point;
    setActiveDragPoint(point);
    setActiveDragId(String(event.active.id));
  }, []);

  const handleDragMove = useCallback((event: DragMoveEvent) => {
    const initialPoint = initialDragPointRef.current;
    if (!initialPoint) {
      return;
    }
    setActiveDragPoint({
      x: initialPoint.x + event.delta.x,
      y: initialPoint.y + event.delta.y
    });
  }, []);

  const handleDragCancel = useCallback(() => {
    initialDragPointRef.current = null;
    setActiveDragPoint(null);
    setActiveDragId(null);
  }, []);

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      initialDragPointRef.current = null;
      setActiveDragPoint(null);
      setActiveDragId(null);
      if (!surface || !isSurfaceGestureEnabled("outlineReorder", readOnly)) {
        return;
      }
      const { active, over } = event;
      if (!over) {
        return;
      }
      const activeId = String(active.id);
      const overId = String(over.id);
      if (activeId === overId) {
        return;
      }

      const moversRaw = selectedIds.has(activeId) ? Array.from(selectedIds) : [activeId];

      const gapData = isOutlineGapDropData(over.data.current) ? over.data.current : null;
      if (gapData) {
        const beforeChildId = resolveBeforeChildIdForOutlineGap(
          document,
          gapData.parentId,
          moversRaw,
          gapData.visualIndex
        );
        if (beforeChildId === undefined) {
          return;
        }
        const result = documentService.moveElementsInSurface(
          surfaceId,
          moversRaw,
          gapData.parentId,
          beforeChildId
        );
        moveLogReason(result);
        return;
      }
    },
    [document, documentService, readOnly, selectedIds, surface, surfaceId]
  );

  const rowBase = useMemo(
    () => ({
      document,
      surfaceId,
      selectedIds,
      primaryId,
      onSelect: handleSelect,
      isCollapsed,
      toggleCollapsed,
      onRowContextMenu: openRowContextMenu,
      onToggleVisible,
      onStartRename,
      readOnly
    }),
    [
      document,
      surfaceId,
      selectedIds,
      primaryId,
      handleSelect,
      isCollapsed,
      toggleCollapsed,
      openRowContextMenu,
      onToggleVisible,
      onStartRename,
      readOnly
    ]
  );

  if (!surface || !root || !outlineRoot || !outlineEffectiveRootId) {
    return <div className="p-4 text-xs text-fg-subtle">{t("widgetChrome.outline.noSurface")}</div>;
  }

  const activeDragElement = activeDragId ? document.elements[activeDragId] : undefined;
  const dragPreview =
    activeDragElement && activeDragPoint && globalThis.document?.body
      ? createPortal(
          <div
            className="pointer-events-none fixed z-[10000]"
            style={{
              left: activeDragPoint.x,
              top: activeDragPoint.y,
              transform: "translate(12px, 12px)"
            }}
          >
            <OutlineDragPreview element={activeDragElement} />
          </div>,
          globalThis.document.body
        )
      : null;

  return (
    <div className="space-y-2 px-2 py-2" onContextMenu={openBlankContextMenu}>
      <div className="text-xs tracking-wide text-fg-muted">{t("widgetChrome.outline.title")}</div>
      {isLinkedTree ? (
        <div className="text-2xs leading-snug text-warning px-0.5">
          {t("widgetChrome.outline.linkedSurfaceHint")}
        </div>
      ) : null}
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        measuring={OUTLINE_DND_MEASURING}
        onDragStart={handleDragStart}
        onDragMove={handleDragMove}
        onDragCancel={handleDragCancel}
        onDragEnd={handleDragEnd}
      >
        <OutlineSubtree parentId={outlineRoot.id} depth={0} {...rowBase} />
      </DndContext>
      {dragPreview}
      <ContextMenu
        items={menuItems}
        position={menuState.position}
        visible={menuState.visible}
        onClose={hideMenu}
      />
    </div>
  );
}
