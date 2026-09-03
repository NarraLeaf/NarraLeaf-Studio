import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { useTranslation } from "@/lib/i18n";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { appendDeveloperIdSection } from "@/lib/developer";
import { getSurfaceDisplayLabel, getSurfaceRenameNoun } from "@/lib/ui-editor/surfaceDisplayLabel";
import { DEFAULT_APP_SURFACE_NAME, DEFAULT_UI_SURFACE_SIZE, MAIN_APP_SURFACE_ID } from "@shared/constants/ui-editor";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import { SurfaceActions } from "./panel/SurfaceActions";
import { isDeferredWriteAllowed, useFreezeGuard } from "../../components/ui/freezeGuard";
import { UITemplateStoreModal } from "./panel/templates/UITemplateStoreModal";
import { SurfaceFilters } from "./panel/SurfaceFilters";
import { SurfaceList, type SurfaceListGlobalBlueprintCard } from "./panel/SurfaceList";
import { reorderSurfacesForDrop, type SurfaceDropGap } from "./panel/surfaceReorder";
import {
    useOpenBlueprintTarget,
    type BlueprintOpenOptions,
} from "@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget";
import { ComponentLibraryPanel } from "./panel/ComponentLibraryPanel";
import { InputActionLibraryPanel } from "./input/InputActionLibraryPanel";
import { getComponentEditorSurfaceId, getComponentTabId } from "./editors/componentEditorAdapter";
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
import { ownerLabelKey } from "@shared/types/ui-editor/ownerLabels";
import {
    CreateSurfaceDialogContent,
    CreateSurfaceDialogValue,
} from "./panel/dialogs/CreateSurfaceDialogContent";
import { DEFAULT_STAGE_SLOT_ID, GAME_UI_SLOT_IDS, SURFACE_KIND_OPTIONS } from "./panel/constants";
import { getStageSlotLabel } from "@/lib/ui-editor/stageSlotLabel";
import type { EditorLayout, EditorTabDefinition } from "../../registry/types";
import { getEditorSurfaceAreaBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { useBrandPaletteRevision } from "@/lib/ui-editor/runtime/useBrandPaletteRevision";
import { copyUiSurface, pasteUiSurface } from "@/lib/ui-editor/commands/uiSurfaceCommands";
import { useUiSurfaceClipboardPresence } from "@/lib/ui-editor/commands/useUiSurfaceClipboardSync";
import { interfaceDocumentFreezeScope } from "./uiLiveSession";

const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const BLUEPRINT_ENTRY_TAB_PREFIX = "blueprint-entry:";
const getSurfaceTabId = (surfaceId: string) => `${SURFACE_TAB_PREFIX}${surfaceId}`;

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

// Exported for the quick-open picker, so surfaces open through the exact same tab definition.
export function createSurfaceEditorTab(surface: UISurface) {
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
    const { t } = useTranslation();
    const { context } = useWorkspace();
    const { editorLayout, openEditorTab, closeEditorTabs } = useRegistry();
    const openBlueprintTarget = useOpenBlueprintTarget();
    const [surfaces, setSurfaces] = useState<UISurface[]>([]);
    const [kind, setKind] = useState<UISurfaceKind>("appSurface");
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const [hasEnsuredAppSurface, setHasEnsuredAppSurface] = useState(false);
    const [templateStoreOpen, setTemplateStoreOpen] = useState(false);
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
    // Absent, not greyed, while the machine's clipboard holds no interface - see `SurfaceActions`.
    const canPasteSurface = useUiSurfaceClipboardPresence(Boolean(documentService));
    // Renaming, duplicating and deleting a surface write the interface document. Opening one - and the
    // filter, the search and the previews - do not.
    const freeze = useFreezeGuard(interfaceDocumentFreezeScope());
    /**
     * The freeze as it stands NOW, for the three flows that put a dialog between the author's click
     * and the write.
     *
     * The rows are greyed when the menu opens, which settles whether the flow may start; it cannot
     * settle whether it may finish. A freeze arrives while the workspace is running - a collaborator
     * opens a session, the author steps back to a past revision - and the handler that resumes after
     * `await` is the one rendered at click time, holding the answer from before it landed. Without
     * this the author names a new page, presses Create, and gets a tab for a page that was never
     * written: the failure `FreezeGuard.run` exists for, in the one shape `run` cannot cover.
     */
    const frozenRef = useRef(freeze.frozen);
    frozenRef.current = freeze.frozen;

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
        return GAME_UI_SLOT_IDS.find(slotId => !occupiedStageSlotIds.has(slotId)) ?? DEFAULT_STAGE_SLOT_ID;
    }, [occupiedStageSlotIds]);
    const defaultDesignSize = useMemo<UISurfaceDesignSize>(() => {
        return surfaces[0]?.designSize ?? DEFAULT_UI_SURFACE_SIZE;
    }, [surfaces]);
    const globalBlueprintId = useMemo(() => {
        const blueprintDocument = localBlueprintService?.getBlueprintDocument();
        return blueprintDocument?.ownerRecords[GLOBAL_MAIN_OWNER_KEY]?.blueprintId;
    }, [blueprintRevision, localBlueprintService]);
    const globalBlueprintPreviewModel = useMemo(
        () => resolveFirstBlueprintLayerPreview(localBlueprintService, nodeCatalog, globalBlueprintId),
        [blueprintRevision, globalBlueprintId, localBlueprintService, nodeCatalog],
    );

    const handleOpenSurface = useCallback((surface: UISurface) => {
        openEditorTab(createSurfaceEditorTab(surface));
    }, [openEditorTab]);

    // Through `useOpenBlueprintTarget` rather than `openEditorTab` directly, so this entry behaves
    // like every other one: it finds a blueprint that is already in a window instead of opening a
    // second view onto it, and it can open into a window itself.
    const handleOpenGlobalBlueprint = useCallback((options?: BlueprintOpenOptions) => {
        if (!globalBlueprintId) {
            return;
        }
        openBlueprintTarget({
            blueprintId: globalBlueprintId,
            ownerKind: "globalMain",
            surfaceId: GLOBAL_MAIN_OWNER_KEY,
            title: t(ownerLabelKey("globalMain")),
        }, options);
    }, [globalBlueprintId, openBlueprintTarget, t]);

    /**
     * Make `subjectId` the properties panel's subject and bring the panel forward.
     *
     * Takes an id rather than a surface because a component's subject is its editor's pseudo surface
     * (`component-editor:<id>`), which is not in `document.surfaces` at all.
     */
    const focusSurfaceProperties = useCallback((subjectId: string) => {
        if (!context) {
            return;
        }
        const uiService = context.services.get<UIService>(Services.UI);
        uiService.getStore().setSelection({ type: "scene", data: subjectId });
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId);
        uiService.panels.show("narraleaf-studio:properties");
        uiService.focus.setFocus(FocusArea.LeftPanel, panelId, { silent: true });
    }, [context, panelId]);

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
        // The same bargain a page card makes: opening it also makes it the panel's subject. For a
        // component that subject is where its params are declared - its root is the outline's root
        // and so not selectable, leaving nothing inside it to hang them on.
        focusSurfaceProperties(getComponentEditorSurfaceId(component.id));
    }, [focusSurfaceProperties, openEditorTab]);

    const handleSurfaceClick = useCallback((surface: UISurface) => {
        handleOpenSurface(surface);
        focusSurfaceProperties(surface.id);
    }, [focusSurfaceProperties, handleOpenSurface]);

    // Same reason as the canvas: a palette edit changes what a `nlbrand:` colour paints without
    // touching the document, so the thumbnails need their own reason to be rebuilt.
    const brandRevision = useBrandPaletteRevision();
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
    }, [runtimeBridge, brandRevision]);

    // Each card asks only about itself, so an edit to one page leaves the other cards' element trees
    // alone. Without this the panel rebuilds every preview in the project on every keystroke.
    const getSurfaceContentRevision = useCallback(
        (surface: UISurface) => documentService?.getSurfaceContentRevision(surface.id) ?? 0,
        [documentService],
    );

    /**
     * A card dropped somewhere else in the list.
     *
     * The list states the move as a gap between the cards it draws - one kind - and the order that
     * has to be written is the whole document's, so the two are joined here. See
     * {@link reorderSurfacesForDrop} for why the other kind's cards must not shift.
     */
    const handleReorderSurfaces = useCallback((draggedId: string, gap: SurfaceDropGap) => {
        if (!documentService) {
            return;
        }
        const order = reorderSurfacesForDrop(documentService.getDocument().surfaces, kind, draggedId, gap);
        if (order) {
            documentService.reorderSurfaces(order, draggedId);
        }
    }, [documentService, kind]);

    // A project with no page at all gets one the moment this panel opens - a write no author asked
    // for, and the third shape `isDeferredWriteAllowed` exists for: there is no control to grey out
    // and no gesture to leave unattached. Frozen, it is DEFERRED rather than attempted, because
    // attempting it raises "Nothing is being saved right now" about the panel's own bookkeeping and
    // then opens a tab for a page that was never written. `frozen` is an input of the effect, so the
    // page is created as soon as the workspace is writable again; the project that had none still
    // has none.
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
        if (!isDeferredWriteAllowed(freeze.frozen)) {
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
    }, [documentService, freeze.frozen, handleOpenSurface, hasEnsuredAppSurface]);

    const handleDeleteSurface = useCallback(async (surface: UISurface) => {
        if (!documentService || !uiService) {
            return;
        }
        const label = getSurfaceDisplayLabel(surface, t);
        const document = documentService.getDocument();
        const root = document.elements[surface.rootElementId];
        const hasChildren = Boolean(root && root.childrenIds.length > 0);
        const confirmed = await uiService.showConfirm(
            t("uiEditor.panel.deleteConfirm", { label }),
            hasChildren ? t("uiEditor.panel.deleteDetail", { label }) : undefined
        );
        // `frozenRef`, not `freeze`: the freeze may have landed while the confirmation was open.
        if (!confirmed || frozenRef.current) {
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
    }, [documentService, uiService, editorLayout, handleOpenSurface, closeEditorTabs, t]);

    const handleRenameSurface = useCallback(async (surface: UISurface) => {
        if (!documentService || !inputDialog || !uiService) {
            return;
        }
        const name = await inputDialog.showRenameDialog(surface.name, getSurfaceRenameNoun(surface));
        // `frozenRef`, not `freeze`: the freeze may have landed while the author was typing.
        if (!name || frozenRef.current) {
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

    // A copy reads the document and the blueprint store; nothing about it writes, so it stays
    // available while the workspace is frozen.
    const handleCopySurface = useCallback((surface: UISurface) => {
        if (!documentService) {
            return;
        }
        copyUiSurface(documentService, localBlueprintService, surface.id);
    }, [documentService, localBlueprintService]);

    const handlePasteSurface = useCallback(async () => {
        if (!documentService) {
            return;
        }
        const pasted = await pasteUiSurface(documentService);
        if (!pasted) {
            return;
        }
        // The list is filtered by kind and a copied Game UI keeps its kind, so an interface pasted
        // while the other tab is showing would arrive out of sight.
        setKind(pasted.kind);
        handleOpenSurface(pasted);
    }, [documentService, handleOpenSurface]);

    const handleDuplicateSurface = useCallback((surface: UISurface) => {
        if (!documentService || surface.kind !== "appSurface") {
            return;
        }
        const duplicated = documentService.duplicateSurface(surface.id);
        if (!duplicated) {
            uiService?.showNotification(t("uiEditor.panel.duplicateFailed"), "warning");
            return;
        }
        void documentService.save(documentService.getDocument()).catch(err => {
            console.warn("[UISurfacesPanel] failed to save duplicated page", err);
        });
        handleOpenSurface(duplicated);
    }, [documentService, handleOpenSurface, uiService, t]);

    const handleOpenMenu = useCallback(
        (event: MouseEvent<HTMLDivElement | HTMLButtonElement>, surface: UISurface) => {
            event.preventDefault();
            event.stopPropagation();
            const label = getSurfaceDisplayLabel(surface, t);
            const items: ContextMenuDef = [
                {
                    id: "open-surface",
                    label: t("uiEditor.panel.openSurface", { label }),
                    onClick: () => handleOpenSurface(surface),
                },
                {
                    id: "rename-surface",
                    label: t("uiEditor.panel.renameSurface", { label }),
                    ...freeze.menuRow(),
                    onClick: () => {
                        void handleRenameSurface(surface);
                    },
                },
            ];
            if (surface.kind === "appSurface") {
                items.push({
                    id: "duplicate-surface",
                    label: t("uiEditor.panel.duplicateSurface", { label }),
                    ...freeze.menuRow(),
                    onClick: () => {
                        handleDuplicateSurface(surface);
                    },
                });
            }
            // The main page is left out of both: a project has exactly one, so it can be neither
            // duplicated nor imported, and a copy of it would paste as nothing.
            if (surface.id !== MAIN_APP_SURFACE_ID) {
                items.push(
                    {
                        id: "copy-surface",
                        label: t("uiEditor.panel.copySurface", { label }),
                        onClick: () => {
                            handleCopySurface(surface);
                        },
                    },
                    {
                        id: "surface-separator",
                        separator: true,
                    },
                    {
                        id: "delete-surface",
                        label: t("uiEditor.panel.deleteSurface", { label }),
                        ...freeze.menuRow(),
                        onClick: () => {
                            void handleDeleteSurface(surface);
                        },
                    },
                );
            }
            setMenuItems(appendDeveloperIdSection(
                items,
                [{ kind: "surface", value: surface.id, label }],
                { hideMenu, notify: uiService?.showNotification.bind(uiService) },
            ));
            showMenu(event);
        },
        [freeze, showMenu, hideMenu, uiService, handleOpenSurface, handleRenameSurface, handleCopySurface, handleDuplicateSurface, handleDeleteSurface, t],
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
                                ? t("uiEditor.panel.pageValidationHint")
                                : t("uiEditor.panel.gameUiSlotHint"),
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
                    title: kind === "appSurface" ? t("uiEditor.panel.createPage") : t("uiEditor.panel.createGameUi"),
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
                            label: t("common.cancel"),
                            onClick: handleCancel,
                        },
                        {
                            label: t("common.create"),
                            primary: true,
                            onClick: handleConfirm,
                        },
                    ],
                    onClose: handleCancel,
                });
            });
        },
        [defaultDesignSize, defaultStageSlotId, disabledStageSlotIds, kind, occupiedStageSlotIds, uiService, t],
    );

    const handleCreateSurface = useCallback(async () => {
        if (!documentService || !currentKindOption) {
            return;
        }
        if (kind === "stageSurface" && disabledStageSlotIds.length >= GAME_UI_SLOT_IDS.length) {
            uiService?.showNotification(t("uiEditor.panel.allSlotsUsed"), "info");
            return;
        }
        const suggestedName =
            kind === "appSurface"
                ? t("uiEditor.naming.page", { index: filteredSurfaces.length + 1 })
                : t("uiEditor.naming.gameUi", { slot: getStageSlotLabel(defaultStageSlotId, t) });
        const selection = await promptCreateSurface(suggestedName);
        // `frozenRef`, not `freeze`: the freeze may have landed while the dialog was open.
        if (!selection || frozenRef.current) {
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
        t,
    ]);

    const globalBlueprintCard = useMemo<SurfaceListGlobalBlueprintCard | undefined>(() => {
        if (kind !== "appSurface") {
            return undefined;
        }
        return {
            title: t(ownerLabelKey("globalMain")),
            subtitle: t("uiEditor.panel.globalSubtitle"),
            typeLabel: t("uiEditor.panel.blueprintType"),
            preview: <BlueprintLayerPreview model={globalBlueprintPreviewModel} heightClassName="h-24" />,
            canOpen: Boolean(globalBlueprintId),
            onClick: () => handleOpenGlobalBlueprint(),
            onOpenInWindow: () => handleOpenGlobalBlueprint({ inOwnWindow: true }),
        };
    }, [globalBlueprintId, globalBlueprintPreviewModel, handleOpenGlobalBlueprint, kind, t]);

    return (
        // One continuous sunken tray: filters, the create button, the surface list
        // and the component library share the same recessed background, with cards
        // and the button floating raised on it — no color seam between sections.
        <div className="h-full flex flex-col bg-surface-sunken">
            <SurfaceFilters
                kind={kind}
                onKindChange={setKind}
            />
            <SurfaceActions
                onCreate={handleCreateSurface}
                createLabel={kind === "appSurface" ? t("uiEditor.panel.createPage") : t("uiEditor.panel.createGameUi")}
                createDisabled={!documentService || !currentKindOption}
                onOpenTemplateStore={() => setTemplateStoreOpen(true)}
                templateLabel={t("uiEditor.templateStore.open")}
                templateDisabled={!documentService}
                onPaste={canPasteSurface ? () => void handlePasteSurface() : undefined}
                pasteLabel={t("uiEditor.panel.pasteSurface")}
            />
            <SurfaceList
                surfaces={filteredSurfaces}
                globalBlueprintCard={globalBlueprintCard}
                renderSurfacePreview={renderSurfacePreview}
                getSurfaceContentRevision={getSurfaceContentRevision}
                onSurfaceClick={handleSurfaceClick}
                onOpenMenu={handleOpenMenu}
                onReorder={documentService && !freeze.frozen ? handleReorderSurfaces : undefined}
            />
            <ComponentLibraryPanel
                documentService={documentService}
                runtimeBridge={runtimeBridge}
                uiService={uiService}
                onOpenComponent={handleOpenComponent}
            />
            <InputActionLibraryPanel documentService={documentService} uiService={uiService} />
            <ContextMenu
                items={menuItems}
                position={menuState.position}
                visible={menuState.visible}
                onClose={hideMenu}
            />
            <UITemplateStoreModal
                isOpen={templateStoreOpen}
                onClose={() => setTemplateStoreOpen(false)}
                documentService={documentService}
                runtimeBridge={runtimeBridge}
                initialKind={kind}
                occupiedStageSlotIds={occupiedStageSlotIds}
                onApplied={handleOpenSurface}
                onNotify={(message, level) => uiService?.showNotification(message, level)}
            />
        </div>
    );
}
