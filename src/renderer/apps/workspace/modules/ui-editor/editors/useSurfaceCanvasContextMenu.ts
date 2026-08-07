import { useCallback, useRef, useState } from "react";
import { SELECTABLE_TARGET } from "@/lib/ui-editor/interaction/constants";
import type { ContextMenuDef } from "@/lib/components/elements/ContextMenu";
import { buildCanvasContextMenu } from "@/lib/ui-editor/context-menu/buildCanvasContextMenu";
import {
    resolveCanvasContextSelection,
    shouldApplyCanvasContextRetarget,
} from "@/lib/ui-editor/context-menu/resolveCanvasContextSelection";
import { hasUiEditorClipboard } from "@/lib/ui-editor/commands/uiEditorClipboard";
import { uiEditorArrange } from "@/lib/ui-editor/commands/uiEditorArrange";
import { uiEditorAlign } from "@/lib/ui-editor/commands/uiEditorAlign";
import {
    uiEditorCopySelection,
    uiEditorCutSelection,
    uiEditorDeleteSelection,
    uiEditorDuplicateSelection,
    uiEditorGroupIntoLeaderContainer,
    uiEditorPaste,
    uiEditorSelectAllInSurface,
    uiEditorUngroupSelection,
} from "@/lib/ui-editor/commands/uiEditorCommands";
import {
    canAddRestToLeaderContainer,
    getContainersToUngroup,
    getMoversToGroupIntoLeaderContainer,
} from "@/lib/ui-editor/commands/uiEditorSelection";
import type { InputDialog } from "@/lib/components/dialogs";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import type { UISurface } from "@shared/types/ui-editor/document";
import type {
    EditorDocumentService,
    EditorStateService,
    EditorUIService,
} from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import { selectSurfaceForProperties } from "@/lib/ui-editor/commands/uiEditorSelection";
import { freezeContextMenuRows, useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { appendDeveloperIdSection, DEVELOPER_MENU_ROW_IDS } from "@/lib/developer";
import { getSurfaceDisplayLabel } from "@/lib/ui-editor/surfaceDisplayLabel";
import { translate } from "@/lib/i18n";

/**
 * The canvas menu rows a frozen project keeps: the ones that only read the document.
 *
 * Named as an exemption rather than as a list of writes because widget modules push their own rows in
 * at runtime (`buildCanvasContextMenu`, the `sep-widget` group) - an opt-out list would leave every
 * plugin-contributed row live. Copy fills the clipboard, Select All changes the selection, and the
 * developer section only reads identifiers; none of them touches the interface document.
 */
const FREEZE_READ_ONLY_CANVAS_MENU_IDS: ReadonlySet<string> = new Set([
    "copy",
    "select-all",
    ...DEVELOPER_MENU_ROW_IDS,
]);

export function useSurfaceCanvasContextMenu(params: {
    surface: UISurface | null | undefined;
    documentService: EditorDocumentService;
    stateService: EditorStateService;
    uiService: EditorUIService;
    localBlueprint: LocalBlueprintService | null;
    widgetModules: UIWidgetModule[];
    inputDialog: InputDialog | null;
    createElementAtClientPoint: (type: string, point: { x: number; y: number }) => void;
    allowAddSelectionToComponentLibrary?: boolean;
    showMenu: (event: React.MouseEvent<HTMLElement>) => void;
    hideMenu: () => void;
}) {
    const {
        surface,
        documentService,
        stateService,
        uiService,
        localBlueprint,
        widgetModules,
        inputDialog,
        createElementAtClientPoint,
        allowAddSelectionToComponentLibrary = true,
        showMenu,
        hideMenu,
    } = params;

    const freeze = useFreezeGuard();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const lastContextPoint = useRef<{ x: number; y: number } | null>(null);
    const lastContextHitElementId = useRef<string | null>(null);

    const handleCanvasContextMenu = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!surface || !documentService || !stateService || !localBlueprint || widgetModules.length === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            lastContextPoint.current = { x: event.clientX, y: event.clientY };
            const hit = (event.target as HTMLElement | null)?.closest(SELECTABLE_TARGET) as HTMLElement | null;
            const hitElementId = hit?.dataset.uiElementId ?? null;
            const hitElement = hitElementId ? documentService.getDocument().elements[hitElementId] : null;
            if (isComponentEditorRootElement(hitElement)) {
                selectSurfaceForProperties(stateService, surface.id, uiService);
            }
            lastContextHitElementId.current =
                hitElement && !isComponentEditorRootElement(hitElement) ? hitElementId : null;

            const curSel = stateService.getSelection();
            if (shouldApplyCanvasContextRetarget(surface.id, lastContextHitElementId.current, curSel)) {
                const nextSel = resolveCanvasContextSelection(surface.id, lastContextHitElementId.current, curSel);
                if (nextSel) {
                    stateService.setUIElementSelection(nextSel);
                }
            }

            const menuSel = resolveCanvasContextSelection(
                surface.id,
                lastContextHitElementId.current,
                stateService.getSelection(),
            );
            const doc = documentService.getDocument();
            const canGroup =
                Boolean(menuSel) &&
                canAddRestToLeaderContainer(menuSel!, doc) &&
                getMoversToGroupIntoLeaderContainer(doc, menuSel!).length > 0;
            const canUngroup = getContainersToUngroup(doc, surface.id, menuSel).length > 0;

            const items = buildCanvasContextMenu({
                document: doc,
                surfaceId: surface.id,
                menuSelection: menuSel,
                hasClipboard: hasUiEditorClipboard(),
                widgetModules,
                documentService,
                canAddToGroup: canGroup,
                canUngroup,
                allowAddToComponentLibrary: allowAddSelectionToComponentLibrary,
                actions: {
                    hideMenu,
                    insertType: type => {
                        const point = lastContextPoint.current;
                        if (point) {
                            createElementAtClientPoint(type, point);
                        }
                    },
                    paste: () => {
                        const sel = stateService.getSelection();
                        const data = sel.type === "element" ? sel.data : null;
                        const primary =
                            data?.editor === "ui" && data.surfaceId === surface.id
                                ? (data.primaryId ?? data.elementIds[data.elementIds.length - 1] ?? null)
                                : null;
                        uiEditorPaste(documentService, localBlueprint, stateService, surface.id, {
                            hitElementId: lastContextHitElementId.current,
                            primaryElementId: primary,
                        });
                    },
                    copy: () => {
                        uiEditorCopySelection(documentService, localBlueprint, surface.id, menuSel);
                    },
                    cut: () => {
                        uiEditorCutSelection(documentService, localBlueprint, stateService, surface.id, menuSel, uiService);
                    },
                    duplicate: () => {
                        uiEditorDuplicateSelection(documentService, localBlueprint, stateService, surface.id, menuSel);
                    },
                    delete: () => {
                        uiEditorDeleteSelection(documentService, stateService, surface.id, menuSel, uiService);
                    },
                    selectAll: () => {
                        uiEditorSelectAllInSurface(documentService, stateService, surface.id, uiService);
                    },
                    renamePrimary: () => {
                        if (!menuSel || menuSel.elementIds.length !== 1 || !inputDialog) {
                            return;
                        }
                        const pid = menuSel.primaryId ?? menuSel.elementIds[0];
                        const el = doc.elements[pid];
                        if (!el || el.type === "nl.root" || isComponentEditorRootElement(el)) {
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
                            if (el && el.type !== "nl.root" && !isComponentEditorRootElement(el)) {
                                documentService.updateElementLayout(id, { visible });
                            }
                        }
                    },
                    addSelectionToLeaderGroup: () => {
                        uiEditorGroupIntoLeaderContainer(documentService, stateService, surface.id, menuSel);
                    },
                    ungroupSelection: () => {
                        uiEditorUngroupSelection(documentService, stateService, surface.id, menuSel, uiService);
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
                        const component = documentService.createComponentFromElements(
                            surface.id,
                            menuSel.elementIds,
                            fallbackName,
                        );
                        if (component) {
                            uiService?.showNotification(`Added "${component.name}" to Component Library`, "success");
                        }
                    },
                    arrange: op => {
                        uiEditorArrange(documentService, surface.id, menuSel, op);
                    },
                    align: op => {
                        uiEditorAlign(documentService, surface.id, menuSel, op);
                    },
                },
            });
            // The identifiers this menu can offer: the one element it is pointed at, and the surface
            // it is drawn on. A multi-selection has no single element to name, so only the surface
            // row survives - the section drops entries whose value is absent.
            const developerElementId =
                menuSel && menuSel.elementIds.length === 1
                    ? (menuSel.primaryId ?? menuSel.elementIds[0])
                    : null;
            const withDeveloperRows = appendDeveloperIdSection(
                items,
                [
                    { kind: "element", value: developerElementId },
                    { kind: "surface", value: surface.id, label: getSurfaceDisplayLabel(surface, translate) },
                ],
                { hideMenu, notify: uiService?.showNotification.bind(uiService) },
            );
            setMenuItems(
                freezeContextMenuRows(withDeveloperRows, freeze.frozen, FREEZE_READ_ONLY_CANVAS_MENU_IDS, freeze.reason),
            );
            showMenu(event);
        },
        [
            freeze,
            surface,
            documentService,
            stateService,
            localBlueprint,
            uiService,
            widgetModules,
            showMenu,
            hideMenu,
            createElementAtClientPoint,
            allowAddSelectionToComponentLibrary,
            inputDialog,
        ]
    );

    return {
        menuItems,
        handleCanvasContextMenu,
    } as const;
}
