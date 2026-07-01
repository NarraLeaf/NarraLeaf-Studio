import { useCallback, useEffect, useMemo, useState } from "react";
import type { MouseEvent } from "react";
import { PanelComponentProps } from "../types";
import { useWorkspace } from "../../context";
import { Services } from "@/lib/workspace/services/services";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import {
    UIStageSurfaceMount,
    UISurface,
    UISurfaceKind,
    UISurfaceDesignSize,
    UIComponentDefinition,
    UIStageSlotId,
    UIStageSurface,
} from "@shared/types/ui-editor/document";
import { useRegistry } from "../../registry";
import { UISurfaceEditorTab } from "./editors/UISurfaceEditorTab";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { PanelsTopLeft } from "lucide-react";
import { createInputDialog } from "@/lib/components/dialogs";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { DEFAULT_APP_SURFACE_NAME, DEFAULT_UI_SURFACE_SIZE, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { SurfaceActions } from "./panel/SurfaceActions";
import { SurfaceFilters } from "./panel/SurfaceFilters";
import { SurfaceList, type SurfaceListGlobalBlueprintCard } from "./panel/SurfaceList";
import { ComponentLibraryPanel } from "./panel/ComponentLibraryPanel";
import { getComponentTabId } from "./editors/componentEditorAdapter";
import { createBlueprintEntryEditorTab } from "../blueprint-lite/openBlueprintEditorTab";
import type { BlueprintEntryTabPayload } from "../blueprint-lite/blueprintEntryTabId";
import { useBlueprintDocumentRevision } from "../blueprint-lite/hooks/useBlueprintDocumentRevision";
import type { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import type { BlueprintNodeCatalogService } from "@/lib/workspace/services/ui-editor/BlueprintNodeCatalogService";
import { GLOBAL_MAIN_OWNER_KEY } from "@/lib/workspace/services/ui-editor/blueprint/ownerKeys";
import {
    BlueprintLayerPreview,
    resolveFirstBlueprintLayerPreview,
} from "@/lib/ui-editor/widget-modules/shared/blueprint/BlueprintLayerPreview";
import { getOwnerLabel } from "@shared/types/ui-editor/ownerLabels";
import {
    CreateSurfaceDialogContent,
    CreateSurfaceDialogValue,
} from "./panel/dialogs/CreateSurfaceDialogContent";
import { DEFAULT_STAGE_SLOT_ID, GAME_UI_SLOT_OPTIONS, STAGE_SLOT_LABELS, SURFACE_KIND_OPTIONS } from "./panel/constants";
import type { EditorLayout, EditorTabDefinition } from "../../registry/types";
import { getEditorSurfaceAreaBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";

const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const BLUEPRINT_ENTRY_TAB_PREFIX = "blueprint-entry:";
const getSurfaceTabId = (surfaceId: string) => `${SURFACE_TAB_PREFIX}${surfaceId}`;
const globalOwnerLabel = getOwnerLabel("globalMain");

function findEditorGroupIdByTabId(layout: EditorLayout, tabId: string): string | null {
    if ("tabs" in layout) {
        return layout.tabs.some(tab => tab.id === tabId) ? layout.id : null;
    }
    return findEditorGroupIdByTabId(layout.first, tabId) ?? findEditorGroupIdByTabId(layout.second, tabId);
}

function isSurfaceBoundBlueprintTab(tab: EditorTabDefinition, surfaceId: string): boolean {
    if (!tab.id.startsWith(BLUEPRINT_ENTRY_TAB_PREFIX)) {
        return false;
    }
    const payload = tab.payload as Partial<BlueprintEntryTabPayload> | undefined;
    return payload?.surfaceId === surfaceId && (
        payload.ownerKind === "surfaceMain" ||
        payload.ownerKind === "widgetMain" ||
        payload.ownerKind === "widgetValue"
    );
}

function collectSurfaceOwnedEditorTabs(layout: EditorLayout, surfaceId: string): { groupId: string; tabIds: string[] }[] {
    const surfaceTabId = getSurfaceTabId(surfaceId);
    const result: { groupId: string; tabIds: string[] }[] = [];

    const visit = (node: EditorLayout) => {
        if ("tabs" in node) {
            const tabIds = node.tabs
                .filter(tab => tab.id === surfaceTabId || isSurfaceBoundBlueprintTab(tab, surfaceId))
                .map(tab => tab.id);
            if (tabIds.length > 0) {
                result.push({ groupId: node.id, tabIds: [...new Set(tabIds)] });
            }
            return;
        }
        visit(node.first);
        visit(node.second);
    };

    visit(layout);
    return result;
}

function getSurfaceIdentityLabel(surface: UISurface): string {
    if (surface.id === MAIN_APP_SURFACE_ID) {
        return DEFAULT_APP_SURFACE_NAME;
    }
    return surface.kind === "appSurface" ? "Page" : "Game UI";
}

function createSurfaceEditorTab(surface: UISurface) {
    return {
        id: getSurfaceTabId(surface.id),
        title: surface.name,
        icon: <PanelsTopLeft className="w-4 h-4" />,
        component: UISurfaceEditorTab,
        payload: { surfaceId: surface.id },
        closable: true,
        modified: false,
    };
}

export function UISurfacesPanel({ panelId }: PanelComponentProps) {
    const { context } = useWorkspace();
    const { editorLayout, openEditorTab, closeEditorTabs } = useRegistry();
    const [surfaces, setSurfaces] = useState<UISurface[]>([]);
    const [kind, setKind] = useState<UISurfaceKind>("appSurface");
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const [hasEnsuredAppSurface, setHasEnsuredAppSurface] = useState(false);
    const blueprintRevision = useBlueprintDocumentRevision();

    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context) return null;
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context]);
    const uiService = useMemo<UIService | null>(() => {
        if (!context) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context]);
    const runtimeBridge = useMemo<UIRuntimeBridgeService | null>(() => {
        if (!context) return null;
        return context.services.get<UIRuntimeBridgeService>(Services.RuntimeBridge);
    }, [context]);
    const localBlueprintService = useMemo<LocalBlueprintService | null>(() => {
        if (!context) return null;
        return context.services.get<LocalBlueprintService>(Services.LocalBlueprint);
    }, [context]);
    const nodeCatalog = useMemo<BlueprintNodeCatalogService | null>(() => {
        if (!context) return null;
        return context.services.get<BlueprintNodeCatalogService>(Services.BlueprintNodeCatalog);
    }, [context]);
    const inputDialog = useMemo(() => (uiService ? createInputDialog(uiService) : null), [uiService]);

    useEffect(() => {
        if (!documentService) return;

        const refresh = () => {
            const doc = documentService.getDocument();
            setSurfaces([...doc.surfaces]);
        };

        refresh();

        const unsubscribe = documentService.onDocumentChanged?.(refresh);
        return () => {
            unsubscribe?.();
        };
    }, [documentService]);

    const filteredSurfaces = useMemo(() => {
        return surfaces.filter(surface => surface.kind === kind);
    }, [surfaces, kind]);
    const currentKindOption = useMemo(() => SURFACE_KIND_OPTIONS.find(option => option.kind === kind), [kind]);
    const occupiedStageSlotIds = useMemo(() => {
        return new Set(
            surfaces
                .filter((surface): surface is UIStageSurface => surface.kind === "stageSurface")
                .map(surface => surface.mount.slotId),
        );
    }, [surfaces]);
    const disabledStageSlotIds = useMemo<UIStageSlotId[]>(
        () => [...occupiedStageSlotIds],
        [occupiedStageSlotIds],
    );
    const defaultStageSlotId = useMemo<UIStageSlotId>(() => {
        return GAME_UI_SLOT_OPTIONS.find(option => !occupiedStageSlotIds.has(option.value))?.value ?? DEFAULT_STAGE_SLOT_ID;
    }, [occupiedStageSlotIds]);
    const defaultDesignSize = useMemo<UISurfaceDesignSize>(() => {
        return surfaces[0]?.designSize ?? DEFAULT_UI_SURFACE_SIZE;
    }, [surfaces]);
    const globalBlueprintId = useMemo(() => {
        const blueprintDocument = localBlueprintService?.getBlueprintDocument();
        return blueprintDocument?.ownerRecords[GLOBAL_MAIN_OWNER_KEY]?.activeBlueprintId;
    }, [blueprintRevision, localBlueprintService]);
    const globalBlueprintPreviewModel = useMemo(
        () => resolveFirstBlueprintLayerPreview(localBlueprintService, nodeCatalog, globalBlueprintId),
        [blueprintRevision, globalBlueprintId, localBlueprintService, nodeCatalog],
    );

    const handleOpenSurface = useCallback((surface: UISurface) => {
        openEditorTab(createSurfaceEditorTab(surface));
    }, [openEditorTab]);

    const handleOpenGlobalBlueprint = useCallback(() => {
        if (!globalBlueprintId) {
            return;
        }
        openEditorTab(createBlueprintEntryEditorTab({
            blueprintId: globalBlueprintId,
            ownerKind: "globalMain",
            surfaceId: GLOBAL_MAIN_OWNER_KEY,
            title: globalOwnerLabel.titlePrefix,
        }));
    }, [globalBlueprintId, openEditorTab]);

    const handleOpenComponent = useCallback((component: UIComponentDefinition) => {
        openEditorTab({
            id: getComponentTabId(component.id),
            title: component.name,
            icon: <PanelsTopLeft className="w-4 h-4" />,
            component: UISurfaceEditorTab,
            payload: { componentId: component.id },
            closable: true,
            modified: false,
        });
    }, [openEditorTab]);

    const focusSceneProperties = useCallback((surface: UISurface) => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: "scene", data: surface.id });
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
        uiService.panels.show("narraleaf-studio:properties");
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId, { silent: true });
    }, [context, panelId]);

    const handleSurfaceClick = useCallback((surface: UISurface) => {
        handleOpenSurface(surface);
        focusSceneProperties(surface);
    }, [focusSceneProperties, handleOpenSurface]);

    const renderSurfacePreview = useCallback((surface: UISurface) => {
        if (!runtimeBridge) {
            return null;
        }
        const backgroundColor = getEditorSurfaceAreaBackgroundColor(surface);
        return runtimeBridge.renderSurface({
            surfaceId: surface.id,
            hostAdapter: { host: surface.host },
            className: "relative",
            style: backgroundColor ? { backgroundColor } : undefined,
        });
    }, [runtimeBridge]);

    useEffect(() => {
        if (!documentService || hasEnsuredAppSurface) {
            return;
        }
        const document = documentService.getDocument();
        const hasAppSurface = document.surfaces.some(surface => surface.kind === "appSurface");
        if (hasAppSurface) {
            setHasEnsuredAppSurface(true);
            return;
        }
        if (documentService.getRevision() !== 0) {
            return;
        }
        const defaultSurface = documentService.createSurface({
            kind: "appSurface",
            name: DEFAULT_APP_SURFACE_NAME,
            host: "app",
        });
        setHasEnsuredAppSurface(true);
        handleOpenSurface(defaultSurface);
    }, [documentService, handleOpenSurface, hasEnsuredAppSurface]);

    const handleDeleteSurface = useCallback(async (surface: UISurface) => {
        if (!documentService || !uiService) {
            return;
        }
        const label = getSurfaceIdentityLabel(surface);
        const document = documentService.getDocument();
        const root = document.elements[surface.rootElementId];
        const hasChildren = Boolean(root && root.childrenIds.length > 0);
        const confirmed = await uiService.showConfirm(
            `Delete ${label}?`,
            hasChildren ? `This will remove all elements in this ${label}.` : undefined
        );
        if (!confirmed) {
            return;
        }
        const tabsToClose = collectSurfaceOwnedEditorTabs(editorLayout, surface.id);
        documentService.deleteSurface(surface.id);
        for (const { groupId, tabIds } of tabsToClose) {
            closeEditorTabs(tabIds, groupId);
        }
        const remaining = documentService.getDocument().surfaces.filter(next => next.kind === surface.kind);
        if (remaining.length > 0) {
            handleOpenSurface(remaining[0]);
        }
    }, [documentService, uiService, editorLayout, handleOpenSurface, closeEditorTabs]);

    const handleRenameSurface = useCallback(async (surface: UISurface) => {
        if (!documentService || !inputDialog || !uiService) {
            return;
        }
        const name = await inputDialog.showRenameDialog(surface.name, getSurfaceIdentityLabel(surface));
        if (!name) {
            return;
        }
        documentService.renameSurface(surface.id, name);

        const updatedSurface = documentService.getDocument().surfaces.find(next => next.id === surface.id);
        if (!updatedSurface) {
            return;
        }
        const tabId = getSurfaceTabId(surface.id);
        const groupId = findEditorGroupIdByTabId(editorLayout, tabId);
        if (groupId) {
            uiService.getStore().openEditorTabInGroup(createSurfaceEditorTab(updatedSurface), groupId, false);
        }
    }, [documentService, editorLayout, inputDialog, uiService]);

    const handleOpenMenu = useCallback(
        (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => {
            event.preventDefault();
            event.stopPropagation();
            const label = getSurfaceIdentityLabel(surface);
            const items: ContextMenuDef = [
                {
                    id: "open-surface",
                    label: `Open ${label}`,
                    onClick: () => handleOpenSurface(surface),
                },
                {
                    id: "rename-surface",
                    label: `Rename ${label}`,
                    onClick: () => {
                        void handleRenameSurface(surface);
                    },
                },
            ];
            if (surface.id !== MAIN_APP_SURFACE_ID) {
                items.push(
                    {
                        id: "surface-separator",
                        separator: true,
                    },
                    {
                        id: "delete-surface",
                        label: `Delete ${label}`,
                        onClick: () => {
                            void handleDeleteSurface(surface);
                        },
                    },
                );
            }
            setMenuItems(items);
            showMenu(event);
        },
        [showMenu, handleOpenSurface, handleRenameSurface, handleDeleteSurface],
    );

    const promptCreateSurface = useCallback(
        (suggestedName: string): Promise<CreateSurfaceDialogValue | null> => {
            if (!uiService) {
                return Promise.resolve(null);
            }
            return new Promise(resolve => {
                let dialogId: string | null = null;
                let settled = false;
                const selection: CreateSurfaceDialogValue = {
                    name: suggestedName,
                    designSize: defaultDesignSize,
                    slotId: defaultStageSlotId,
                    valid: kind === "appSurface" || !occupiedStageSlotIds.has(defaultStageSlotId),
                };

                const safeResolve = (value: CreateSurfaceDialogValue | null) => {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    resolve(value);
                };

                const closeDialog = () => {
                    if (dialogId) {
                        uiService.dialogs.close(dialogId);
                        dialogId = null;
                    }
                };

                const handleConfirm = () => {
                    if (!selection.valid) {
                        uiService.showNotification(
                            kind === "appSurface"
                                ? "Check the page name and size before creating it."
                                : "Select an available Game UI slot before creating it.",
                            "warning",
                        );
                        return;
                    }
                    safeResolve({ ...selection });
                    closeDialog();
                };

                const handleCancel = () => {
                    safeResolve(null);
                    closeDialog();
                };

                dialogId = uiService.dialogs.show({
                    title: kind === "appSurface" ? "Create Page" : "Create Game UI",
                    content: (
                        <CreateSurfaceDialogContent
                            kind={kind}
                            defaultName={suggestedName}
                            defaultDesignSize={defaultDesignSize}
                            defaultSlotId={defaultStageSlotId}
                            disabledSlotIds={disabledStageSlotIds}
                            onChange={value => {
                                selection.name = value.name;
                                selection.designSize = value.designSize;
                                selection.slotId = value.slotId;
                                selection.valid = value.valid;
                            }}
                        />
                    ),
                    closable: true,
                    width: 420,
                    buttons: [
                        {
                            label: "Cancel",
                            onClick: handleCancel,
                        },
                        {
                            label: "Create",
                            primary: true,
                            onClick: handleConfirm,
                        },
                    ],
                    onClose: handleCancel,
                });
            });
        },
        [defaultDesignSize, defaultStageSlotId, disabledStageSlotIds, kind, occupiedStageSlotIds, uiService],
    );

    const handleCreateSurface = useCallback(async () => {
        if (!documentService || !currentKindOption) {
            return;
        }
        if (kind === "stageSurface" && disabledStageSlotIds.length >= GAME_UI_SLOT_OPTIONS.length) {
            uiService?.showNotification("All Game UI slots already have a surface. Open an existing Game UI from the list.", "info");
            return;
        }
        const suggestedName =
            kind === "appSurface"
                ? `Page ${filteredSurfaces.length + 1}`
                : `${STAGE_SLOT_LABELS[defaultStageSlotId]} UI`;
        const selection = await promptCreateSurface(suggestedName);
        if (!selection) {
            return;
        }
        let stageMount: UIStageSurfaceMount | undefined;
        if (kind === "stageSurface") {
            stageMount = { kind: "slot", slotId: selection.slotId ?? DEFAULT_STAGE_SLOT_ID };
        }
        const surface = documentService.createSurface({
            kind,
            name: selection.name,
            host: currentKindOption.host,
            designSize: kind === "appSurface" ? selection.designSize : undefined,
            stageMount,
        });
        void documentService.save(documentService.getDocument()).catch(err => {
            console.warn("[UISurfacesPanel] failed to save surface", err);
        });
        handleOpenSurface(surface);
    }, [
        currentKindOption,
        defaultStageSlotId,
        disabledStageSlotIds.length,
        documentService,
        filteredSurfaces.length,
        handleOpenSurface,
        kind,
        promptCreateSurface,
        uiService,
    ]);

    const globalBlueprintCard = useMemo<SurfaceListGlobalBlueprintCard | undefined>(() => {
        if (kind !== "appSurface") {
            return undefined;
        }
        return {
            title: globalOwnerLabel.label,
            subtitle: "Global",
            typeLabel: "Blueprint",
            preview: <BlueprintLayerPreview model={globalBlueprintPreviewModel} heightClassName="h-24" />,
            canOpen: Boolean(globalBlueprintId),
            onClick: handleOpenGlobalBlueprint,
        };
    }, [globalBlueprintId, globalBlueprintPreviewModel, handleOpenGlobalBlueprint, kind]);

    return (
        <div className="h-full flex flex-col">
            <SurfaceFilters
                kind={kind}
                onKindChange={setKind}
            />
            <SurfaceActions
                onCreate={handleCreateSurface}
                createLabel={kind === "appSurface" ? "Create Page" : "Create Game UI"}
                createDisabled={!documentService || !currentKindOption}
            />
            <SurfaceList
                surfaces={filteredSurfaces}
                surfaceKind={kind}
                globalBlueprintCard={globalBlueprintCard}
                renderSurfacePreview={renderSurfacePreview}
                onSurfaceClick={handleSurfaceClick}
                onOpenMenu={handleOpenMenu}
            />
            <ComponentLibraryPanel
                documentService={documentService}
                runtimeBridge={runtimeBridge}
                uiService={uiService}
                onOpenComponent={handleOpenComponent}
            />
            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
        </div>
    );
}
