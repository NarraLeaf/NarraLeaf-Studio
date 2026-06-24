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
} from "@shared/types/ui-editor/document";
import { useRegistry } from "../../registry";
import { UISurfaceEditorTab } from "./editors/UISurfaceEditorTab";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { PanelsTopLeft } from "lucide-react";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { DEFAULT_APP_SURFACE_NAME, DEFAULT_UI_SURFACE_SIZE, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { SurfaceActions } from "./panel/SurfaceActions";
import { SurfaceFilters } from "./panel/SurfaceFilters";
import { SurfaceList, type SurfaceListGlobalBlueprintCard } from "./panel/SurfaceList";
import { ComponentLibraryPanel } from "./panel/ComponentLibraryPanel";
import { getComponentTabId } from "./editors/componentEditorAdapter";
import { createBlueprintEntryEditorTab } from "../blueprint-lite/openBlueprintEditorTab";
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
import { DEFAULT_STAGE_SLOT_ID, STAGE_SLOT_LABELS, SURFACE_KIND_OPTIONS } from "./panel/constants";

const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const getSurfaceTabId = (surfaceId: string) => `${SURFACE_TAB_PREFIX}${surfaceId}`;
const globalOwnerLabel = getOwnerLabel("globalMain");

export function UISurfacesPanel({ panelId }: PanelComponentProps) {
    const { context } = useWorkspace();
    const { openEditorTab, closeEditorTab } = useRegistry();
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
        const tabId = getSurfaceTabId(surface.id);
        openEditorTab({
            id: tabId,
            title: surface.name,
            icon: <PanelsTopLeft className="w-4 h-4" />,
            component: UISurfaceEditorTab,
            payload: { surfaceId: surface.id },
            closable: true,
            modified: false,
        });
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
        return runtimeBridge.renderSurface({
            surfaceId: surface.id,
            hostAdapter: { host: surface.host },
            className: "relative",
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
        const label = surface.kind === "appSurface" ? "page" : "Game UI";
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
        documentService.deleteSurface(surface.id);
        closeEditorTab(getSurfaceTabId(surface.id));
        const remaining = documentService.getDocument().surfaces.filter(next => next.kind === surface.kind);
        if (remaining.length > 0) {
            handleOpenSurface(remaining[0]);
        }
    }, [documentService, uiService, handleOpenSurface, closeEditorTab]);

    const handleOpenMenu = useCallback(
        (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => {
        event.stopPropagation();
        const label = surface.kind === "appSurface" ? "Page" : "Game UI";
        const items: ContextMenuDef = [
            {
                id: "open-surface",
                label: `Open ${label}`,
                onClick: () => handleOpenSurface(surface),
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
    }, [showMenu, handleOpenSurface, handleDeleteSurface]);

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
                    slotId: DEFAULT_STAGE_SLOT_ID,
                    valid: true,
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
                        uiService.showNotification("Check the page name and size before creating it.", "warning");
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
                            defaultSlotId={DEFAULT_STAGE_SLOT_ID}
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
        [defaultDesignSize, kind, uiService],
    );

    const handleCreateSurface = useCallback(async () => {
        if (!documentService || !currentKindOption) {
            return;
        }
        const suggestedName =
            kind === "appSurface"
                ? `Page ${filteredSurfaces.length + 1}`
                : `${STAGE_SLOT_LABELS[DEFAULT_STAGE_SLOT_ID]} UI`;
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
        documentService,
        filteredSurfaces.length,
        handleOpenSurface,
        kind,
        promptCreateSurface,
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
