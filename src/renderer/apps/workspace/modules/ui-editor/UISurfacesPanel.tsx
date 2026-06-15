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
    UIStageSurface,
    UIAppSurface,
} from "@shared/types/ui-editor/document";
import { useRegistry } from "../../registry";
import { UISurfaceEditorTab } from "./editors/UISurfaceEditorTab";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import type { SelectOption } from "@/lib/components/elements/Select";
import { PanelsTopLeft } from "lucide-react";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { DEFAULT_APP_SURFACE_NAME, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { SurfaceActions } from "./panel/SurfaceActions";
import { SurfaceFilters } from "./panel/SurfaceFilters";
import { SurfaceList } from "./panel/SurfaceList";
import { StageMountDialogContent } from "./panel/dialogs/StageMountDialogContent";
import {
    StageSurfaceLinkDialogContent,
    StageSurfaceLinkDialogValue,
} from "./panel/dialogs/StageSurfaceLinkDialogContent";
import { formatStageMountLabel, SURFACE_KIND_OPTIONS } from "./panel/constants";

const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const getSurfaceTabId = (surfaceId: string) => `${SURFACE_TAB_PREFIX}${surfaceId}`;

export function UISurfacesPanel({ panelId }: PanelComponentProps) {
    const { context } = useWorkspace();
    const { openEditorTab, closeEditorTab } = useRegistry();
    const [surfaces, setSurfaces] = useState<UISurface[]>([]);
    const [kind, setKind] = useState<UISurfaceKind>("appSurface");
    const [stageMountFilter, setStageMountFilter] = useState<UIStageSurfaceMount["kind"] | null>(null);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const [hasEnsuredAppSurface, setHasEnsuredAppSurface] = useState(false);

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
    const inputDialog = useMemo(() => {
        if (!uiService) return null;
        return createInputDialog(uiService);
    }, [uiService]);

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

    useEffect(() => {
        if (kind !== "stageSurface" && stageMountFilter !== null) {
            setStageMountFilter(null);
        }
    }, [kind, stageMountFilter]);

    const filteredSurfaces = useMemo(() => {
        return surfaces.filter(surface => {
            if (surface.kind !== kind) {
                return false;
            }
            if (kind === "stageSurface" && stageMountFilter && surface.kind === "stageSurface") {
                return surface.mount.kind === stageMountFilter;
            }
            return true;
        });
    }, [surfaces, kind, stageMountFilter]);
    const surfacesOfKindCount = useMemo(
        () => surfaces.filter(s => s.kind === kind).length,
        [surfaces, kind]
    );
    const currentKindOption = useMemo(() => SURFACE_KIND_OPTIONS.find(option => option.kind === kind), [kind]);
    const stageSurfaces = useMemo(
        () => surfaces.filter((surface): surface is UIStageSurface => surface.kind === "stageSurface"),
        [surfaces]
    );
    const appSurfaces = useMemo(
        () => surfaces.filter((surface): surface is UIAppSurface => surface.kind === "appSurface"),
        [surfaces]
    );
    const hasStageSurfaces = stageSurfaces.length > 0;
    const hasAppSurfaces = appSurfaces.length > 0;

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
        const document = documentService.getDocument();
        const root = document.elements[surface.rootElementId];
        const hasChildren = Boolean(root && root.childrenIds.length > 0);
        const confirmed = await uiService.showConfirm(
            "Delete surface?",
            hasChildren ? "This will remove all elements on the surface." : undefined
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
        const items: ContextMenuDef = [
            {
                id: "open-surface",
                label: "Open Surface",
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
                    label: "Delete Surface",
                    onClick: () => {
                        void handleDeleteSurface(surface);
                    },
                },
            );
        }
        setMenuItems(items);
        showMenu(event);
    }, [showMenu, handleOpenSurface, handleDeleteSurface]);

    const promptStageMountSelection = useCallback(async (): Promise<UIStageSurfaceMount | null> => {
        if (!uiService) {
            return null;
        }
        return new Promise(resolve => {
            let settled = false;
            let dialogId: string | null = null;
            const mountRef = { current: { kind: "persistent" } as UIStageSurfaceMount };

            const safeResolve = (value: UIStageSurfaceMount | null) => {
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
                safeResolve(mountRef.current);
                closeDialog();
            };

            const handleCancel = () => {
                safeResolve(null);
                closeDialog();
            };

            dialogId = uiService.dialogs.show({
                title: "Select Stage Mount",
                content: (
                    <StageMountDialogContent
                        initial={mountRef.current}
                        onChange={value => {
                            mountRef.current = value;
                        }}
                    />
                ),
                closable: true,
                buttons: [
                    {
                        label: "Cancel",
                        onClick: handleCancel,
                    },
                    {
                        label: "Confirm",
                        primary: true,
                        onClick: handleConfirm,
                    },
                ],
                onClose: () => safeResolve(null),
            });

        });
    }, [uiService]);

    const promptStageSurfaceLink = useCallback(
        ({
            stageSurfaceOptions,
            appSurfaceOptions,
            initialStageSurfaceId,
            initialAppSurfaceId,
        }: {
            stageSurfaceOptions: SelectOption[];
            appSurfaceOptions: SelectOption[];
            initialStageSurfaceId: string;
            initialAppSurfaceId: string | null;
        }): Promise<StageSurfaceLinkDialogValue | null> => {
            if (!uiService) {
                return Promise.resolve(null);
            }
            return new Promise(resolve => {
                let dialogId: string | null = null;
                let settled = false;
                const selection: StageSurfaceLinkDialogValue = {
                    stageSurfaceId: initialStageSurfaceId,
                    appSurfaceId: initialAppSurfaceId,
                };

                const safeResolve = (value: StageSurfaceLinkDialogValue | null) => {
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
                    safeResolve(selection);
                    closeDialog();
                };

                const handleCancel = () => {
                    safeResolve(null);
                    closeDialog();
                };

                const handleChange = (value: StageSurfaceLinkDialogValue) => {
                    selection.stageSurfaceId = value.stageSurfaceId;
                    selection.appSurfaceId = value.appSurfaceId;
                };

                dialogId = uiService.dialogs.show({
                    title: "Link App Surface",
                    content: (
                        <StageSurfaceLinkDialogContent
                            stageSurfaceOptions={stageSurfaceOptions}
                            appSurfaceOptions={appSurfaceOptions}
                            initialStageSurfaceId={initialStageSurfaceId}
                            initialAppSurfaceId={initialAppSurfaceId}
                            onChange={handleChange}
                        />
                    ),
                    closable: true,
                    buttons: [
                        {
                            label: "Cancel",
                            onClick: handleCancel,
                        },
                        {
                            label: "Confirm",
                            primary: true,
                            onClick: handleConfirm,
                        },
                    ],
                    onClose: handleCancel,
                });
            });
        },
        [uiService],
    );

    const handleCreateSurface = useCallback(async () => {
        if (!documentService || !currentKindOption || !inputDialog) {
            return;
        }
        const suggestedName = `${currentKindOption.label} ${filteredSurfaces.length + 1}`;
        const name = await inputDialog.show({
            title: "New Surface",
            description: `Please name the ${currentKindOption.label.toLowerCase()} surface.`,
            placeholder: "Enter surface name",
            initialValue: suggestedName,
            required: true,
            maxLength: 100,
        });
        if (!name) {
            return;
        }
        let stageMount: UIStageSurfaceMount | undefined;
        if (kind === "stageSurface") {
            const selectedMount = await promptStageMountSelection();
            if (!selectedMount) {
                return;
            }
            stageMount = selectedMount;
        }
        const surface = documentService.createSurface({
            kind,
            name,
            host: currentKindOption.host,
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
        inputDialog,
        kind,
        promptStageMountSelection,
    ]);

    const handleLinkStageSurface = useCallback(async () => {
        if (!documentService || !uiService) {
            return;
        }
        if (!hasStageSurfaces) {
            return;
        }
        if (!hasAppSurfaces) {
            uiService.showNotification("Create an App surface before linking a stage surface.", "warning");
            return;
        }

        const stageSurfaceOptions: SelectOption[] = stageSurfaces.map(surface => ({
            value: surface.id,
            label: `${surface.name} · ${formatStageMountLabel(surface.mount)}`,
        }));
        const appSurfaceOptions: SelectOption[] = [
            { value: "", label: "Keep own root (clear link)" },
            ...appSurfaces.map(surface => ({
                value: surface.id,
                label: surface.name,
            })),
        ];

        const filteredStageSurface = filteredSurfaces.find(
            (surface): surface is UIStageSurface => surface.kind === "stageSurface"
        );
        const defaultStageSurface = filteredStageSurface ?? stageSurfaces[0];
        const initialStageSurfaceId = defaultStageSurface?.id;
        if (!initialStageSurfaceId) {
            return;
        }
        const initialAppSurfaceId = defaultStageSurface?.link?.surfaceId ?? appSurfaces[0]?.id ?? null;

        const selection = await promptStageSurfaceLink({
            stageSurfaceOptions,
            appSurfaceOptions,
            initialStageSurfaceId,
            initialAppSurfaceId,
        });
        if (!selection) {
            return;
        }

        documentService.updateSurface(selection.stageSurfaceId, surface => {
            if (surface.kind !== "stageSurface") {
                return;
            }
            if (selection.appSurfaceId) {
                surface.link = {
                    kind: "appSurface",
                    surfaceId: selection.appSurfaceId,
                };
            } else {
                surface.link = undefined;
            }
        });
        uiService.showNotification("Stage surface link saved.", "success");
    }, [
        appSurfaces,
        documentService,
        filteredSurfaces,
        hasAppSurfaces,
        hasStageSurfaces,
        promptStageSurfaceLink,
        stageSurfaces,
        uiService,
    ]);

    return (
        <div className="h-full flex flex-col">
            <SurfaceFilters
                kind={kind}
                stageMountFilter={stageMountFilter}
                onKindChange={setKind}
                onStageMountFilterChange={setStageMountFilter}
            />
            <SurfaceActions
                onCreate={handleCreateSurface}
                onLink={handleLinkStageSurface}
                createDisabled={!documentService || !currentKindOption || !inputDialog}
                linkDisabled={!hasStageSurfaces || !hasAppSurfaces}
                showLinkButton={kind === "stageSurface"}
                linkTitle={
                    hasStageSurfaces && hasAppSurfaces
                        ? "Reuse an app surface’s UI tree on this stage (link, not a duplicate)"
                        : "Need at least one app surface and one stage surface to configure a link"
                }
            />
            <SurfaceList
                surfaces={filteredSurfaces}
                surfaceKind={kind}
                stageMountFilter={stageMountFilter}
                surfacesOfKindCount={surfacesOfKindCount}
                allSurfaces={surfaces}
                renderSurfacePreview={renderSurfacePreview}
                onSurfaceClick={handleSurfaceClick}
                onOpenMenu={handleOpenMenu}
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
