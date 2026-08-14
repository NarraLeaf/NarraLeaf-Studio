import {
    useCallback,
    useDeferredValue,
    useEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
} from "react";
import { EditorComponentProps } from "../../types";
import { UIEditorInteractionLayer, useUIEditorKeybindings } from "@/lib/ui-editor/interaction";
import { UIEditorDockerBar } from "@/lib/ui-editor/docker";
import { MousePointer2, Move, Play, Magnet, Maximize, PanelsTopLeft } from "lucide-react";
import type { UITool } from "@/lib/ui-editor/editor/types";
import { ContextMenu, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { useTranslation } from "@/lib/i18n";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { useUISurfaceEditorServices } from "@/apps/workspace/modules/ui-editor/editors/useUISurfaceEditorServices";
import { useWorkspace } from "@/apps/workspace/context";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { Services } from "@/lib/workspace/services/services";
import { FocusArea } from "@/lib/workspace/services/ui/types";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import { UIEditorHistoryService } from "@/lib/workspace/services/ui-editor/UIEditorHistoryService";
import { HistoryService } from "@/lib/workspace/services/history/HistoryService";
import { uiSurfaceHistoryScope } from "@/lib/workspace/services/history/historyScopes";
import { collectSurfaceDiagnostics } from "@/lib/ui-editor/diagnostics/collectSurfaceDiagnostics";
import { flushUIDocAndGraphIfDirty } from "@/apps/workspace/modules/actions/flushDevModeAssets";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { SurfaceLayoutDiagnosticMarkers } from "@/apps/workspace/modules/ui-editor/editors/SurfaceLayoutDiagnosticMarkers";
import { SurfaceOutlinePanel } from "@/apps/workspace/modules/ui-editor/editors/SurfaceOutlinePanel";
import {
    useDocumentDirtyIndicator,
    useEditorToolState,
    useSurfaceDocument,
    useViewportTransform,
    useSmartSnapEnabled,
    useSmartSnapDetailSettings,
    usePreviewAspectId,
    usePreviewSafeAreaId,
} from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";
import { useSurfaceViewportAutoFit } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceViewportAutoFit";
import { useSurfaceCanvasContextMenu } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceCanvasContextMenu";
import { useSurfaceImageDrop } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceImageDrop";
import { useSurfaceDoubleClick } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceDoubleClick";
import { useSurfaceInteractionCropDimming } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceInteractionCropDimming";
import {
    SurfaceEditorToolbarButtonGroup,
    SurfaceEditorToolbarSegButton,
} from "@/apps/workspace/modules/ui-editor/editors/SurfaceEditorToolbarButtonGroup";
import { SurfaceSnapSettingsTrigger } from "@/apps/workspace/modules/ui-editor/editors/SurfaceSnapSettingsMenu";
import { SurfaceAlignTrigger } from "@/apps/workspace/modules/ui-editor/editors/SurfaceAlignMenu";
import { SurfacePreviewFramesTrigger } from "@/apps/workspace/modules/ui-editor/editors/SurfacePreviewFramesMenu";
import { SurfacePreviewFramesReadout } from "@/apps/workspace/modules/ui-editor/editors/SurfacePreviewFramesReadout";
import {
    readProjectMobileOrientation,
    readProjectStageFit,
    readProjectViewportConfig,
} from "@/apps/workspace/modules/ui-editor/editors/projectMobileOrientation";
import { SurfacePreviewFramesOverlay } from "@/lib/ui-editor/preview/SurfacePreviewFramesOverlay";
import { listInsertPaletteModules } from "@/lib/ui-editor/widget-modules/insertPalette";
import { MOVEABLE_DOUBLE_CLICK_TARGET_SELECTOR } from "@/lib/ui-editor/interaction/surfaceInlineTextEditActivation";
import {
    debugUIDoubleClick,
    describeDoubleClickTarget,
} from "@/lib/ui-editor/interaction/doubleClickDebug";
import { selectSurfaceForProperties } from "@/lib/ui-editor/commands/uiEditorSelection";
import { useRegistry } from "@/apps/workspace/registry";
import {
    createComponentDocumentServiceAdapter,
    getComponentEditorSurfaceId,
    getComponentTabId,
} from "./componentEditorAdapter";
import { isComponentEditorRootElement } from "@/lib/ui-editor/componentEditorRoot";
import {
    cancelElementBindingSession,
    cancelElementBindingSessionById,
    completeElementBindingSessionForSession,
    readElementBindingSession,
    subscribeElementBindingSession,
} from "@/apps/workspace/modules/blueprint-lite/elementBindingSession";
import type { EditorLayout } from "@/apps/workspace/registry/types";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    EDITOR_SURFACE_LOW_OPACITY_OUTLINE,
    getEditorSurfaceAreaBackgroundColor,
    shouldShowEditorSurfaceLowOpacityOutline,
} from "@/lib/ui-editor/runtime/surfaceBackground";
import { useFreezeGuard } from "@/apps/workspace/components/ui/freezeGuard";
import { useBrandPaletteRevision } from "@/lib/ui-editor/runtime/useBrandPaletteRevision";
import type { UIEditorReadOnly } from "@/lib/ui-editor/interaction/readOnlyInteraction";

const SURFACE_TAB_PREFIX = "ui-editor:surface:";
const getSurfaceTabId = (targetSurfaceId: string) => `${SURFACE_TAB_PREFIX}${targetSurfaceId}`;

function getEditorSurfaceStyle(surface: UISurface | null | undefined): CSSProperties | undefined {
    if (!surface) {
        return undefined;
    }
    const backgroundColor = getEditorSurfaceAreaBackgroundColor(surface);
    const style: CSSProperties = {};
    if (backgroundColor) {
        style.backgroundColor = backgroundColor;
    }
    if (shouldShowEditorSurfaceLowOpacityOutline(surface)) {
        style.outline = EDITOR_SURFACE_LOW_OPACITY_OUTLINE;
        style.outlineOffset = "0px";
    }
    return Object.keys(style).length > 0 ? style : undefined;
}

function findEditorGroupIdByTabId(layout: EditorLayout, tabId: string): string | null {
    if ("tabs" in layout) {
        return layout.tabs.some(tab => tab.id === tabId) ? layout.id : null;
    }
    return findEditorGroupIdByTabId(layout.first, tabId) ?? findEditorGroupIdByTabId(layout.second, tabId);
}

export function UISurfaceEditorTab({ tabId, payload, active }: EditorComponentProps<{ surfaceId?: string; componentId?: string }>) {
    const { t } = useTranslation();
    const componentId = payload?.componentId;
    const isComponentEdit = Boolean(componentId);
    const baseSurfaceId = payload?.surfaceId;
    const { runtimeBridge, stateService, documentService: baseDocumentService, uiService } = useUISurfaceEditorServices();
    const documentService = useMemo(() => {
        if (!baseDocumentService || !componentId) {
            return baseDocumentService;
        }
        return createComponentDocumentServiceAdapter(baseDocumentService, componentId);
    }, [baseDocumentService, componentId]);
    const surfaceId = componentId ? getComponentEditorSurfaceId(componentId) : baseSurfaceId;
    const { context, workspace } = useWorkspace();
    const { editorLayout, openEditorTab, setActiveEditorTab } = useRegistry();
    const localBlueprint = useMemo(
        () => context?.services.get<LocalBlueprintService>(Services.LocalBlueprint) ?? null,
        [context],
    );
    const historyService = useMemo(
        () => context?.services.get<UIEditorHistoryService>(Services.UIEditorHistory) ?? null,
        [context],
    );
    const inputDialog = useMemo(() => (uiService ? createInputDialog(uiService) : null), [uiService]);
    const graphService = useMemo(() => context?.services.get<UIGraphService>(Services.UIGraph) ?? null, [context]);
    const [graphVersion, setGraphVersion] = useState(0);
    useEffect(() => {
        if (!graphService) {
            return undefined;
        }
        return graphService.onGraphsChanged(() => {
            setGraphVersion(v => v + 1);
        });
    }, [graphService]);

    const tool = useEditorToolState(stateService);
    const viewport = useViewportTransform(stateService);
    const smartSnapEnabled = useSmartSnapEnabled(stateService);
    const smartSnapDetail = useSmartSnapDetailSettings(stateService);
    const previewAspectId = usePreviewAspectId(stateService);
    const previewSafeAreaId = usePreviewSafeAreaId(stateService);
    // What the shells lock to, which is what decides which edge a device inset lands on.
    const mobileOrientation = readProjectMobileOrientation(context);
    // Whether the build letterboxes or crops; both frames read differently under `cover`.
    const stageFit = readProjectStageFit(context);
    const { surface, documentVersion } = useSurfaceDocument(surfaceId, stateService, documentService);
    /**
     * A palette edit repaints the canvas for the same reason a document edit does, and is invisible
     * for the opposite one: `nlbrand:` colours are resolved while the tree is built, so the document
     * version does not move and the memo below would hand back the tree it built against the old
     * palette. Measured: editing the primary colour left the canvas on the previous colour until an
     * unrelated re-render, which reads as "the link does not work".
     */
    const brandRevision = useBrandPaletteRevision();
    const widgetModules = useMemo(() => listInsertPaletteModules(surface), [surface]);
    const deferredDocumentVersion = useDeferredValue(documentVersion);
    const deferredGraphVersion = useDeferredValue(graphVersion);
    const [bindingSession, setBindingSession] = useState(readElementBindingSession());
    const [selectionVersion, setSelectionVersion] = useState(0);
    const bindingAutoCancelTimerRef = useRef<number | null>(null);

    const clearPendingBindingAutoCancel = useCallback(() => {
        if (bindingAutoCancelTimerRef.current == null) {
            return;
        }
        window.clearTimeout(bindingAutoCancelTimerRef.current);
        bindingAutoCancelTimerRef.current = null;
    }, []);

    useEffect(() => subscribeElementBindingSession(() => setBindingSession(readElementBindingSession())), []);
    useEffect(() => {
        if (!stateService) {
            return undefined;
        }
        return stateService.on("selectionChanged", () => setSelectionVersion(v => v + 1));
    }, [stateService]);

    useEffect(() => {
        if (!stateService || !surface) {
            return;
        }
        const current = stateService.getSelection();
        if (isUIElementSelection(current)) {
            if (current.data.surfaceId === surface.id && current.data.elementIds.length > 0) {
                return;
            }
            selectSurfaceForProperties(stateService, surface.id, uiService);
            return;
        }
        if (current.type === "scene") {
            const currentSceneId = typeof current.data === "string" ? current.data : current.data?.id ?? null;
            if (currentSceneId === surface.id) {
                selectSurfaceForProperties(stateService, surface.id, uiService);
                return;
            }
            selectSurfaceForProperties(stateService, surface.id, uiService);
            return;
        }
        if (current.type === null) {
            selectSurfaceForProperties(stateService, surface.id, uiService);
        }
    }, [stateService, surface, uiService]);

    const surfaceDiagnostics = useMemo(() => {
        if (!documentService || !surface) {
            return [];
        }
        const bp = graphService?.getDocument().blueprintDocument;
        return collectSurfaceDiagnostics(documentService.getDocument(), surface.id, { blueprintDocument: bp });
    }, [documentService, surface, graphService, deferredDocumentVersion, deferredGraphVersion]);

    const surfaceLevelDiagnosticMessages = useMemo(
        () => surfaceDiagnostics.filter(d => !d.elementId).map(d => d.message),
        [surfaceDiagnostics],
    );

    const activeBindingSession =
        !isComponentEdit && bindingSession && surface && bindingSession.surfaceId === surface.id ? bindingSession : null;

    const returnToBindingBlueprint = useCallback(
        (blueprintTabId: string) => {
            const sourceGroupId = findEditorGroupIdByTabId(editorLayout, blueprintTabId);
            if (sourceGroupId) {
                setActiveEditorTab(blueprintTabId, sourceGroupId);
            }
        },
        [editorLayout, setActiveEditorTab],
    );

    useEffect(() => {
        clearPendingBindingAutoCancel();
        if (!activeBindingSession) {
            return undefined;
        }
        const sessionId = activeBindingSession.id;
        return () => {
            clearPendingBindingAutoCancel();
            bindingAutoCancelTimerRef.current = window.setTimeout(() => {
                bindingAutoCancelTimerRef.current = null;
                cancelElementBindingSessionById(sessionId);
            }, 0);
        };
    }, [activeBindingSession?.id, clearPendingBindingAutoCancel]);

    const bindingSelection = useMemo(() => {
        if (!activeBindingSession || !stateService || !documentService) {
            return null;
        }
        const sel = stateService.getSelection();
        if (!isUIElementSelection(sel)) {
            return null;
        }
        const data = sel.data as UIElementSelection;
        if (data.surfaceId !== activeBindingSession.surfaceId || data.elementIds.length !== 1) {
            return null;
        }
        const elementId = data.primaryId ?? data.elementIds[0];
        const element = documentService.getDocument().elements[elementId];
        if (!element || element.type === "nl.root" || isComponentEditorRootElement(element)) {
            return null;
        }
        return { elementId: element.id, elementType: element.type, label: element.name || element.type };
    }, [activeBindingSession, documentService, selectionVersion, stateService]);

    const handleConfirmElementBinding = useCallback(() => {
        if (!activeBindingSession || !stateService || !documentService) {
            return;
        }
        const sel = stateService.getSelection();
        if (!isUIElementSelection(sel)) {
            return;
        }
        const data = sel.data as UIElementSelection;
        if (data.surfaceId !== activeBindingSession.surfaceId || data.elementIds.length !== 1) {
            return;
        }
        const elementId = data.primaryId ?? data.elementIds[0];
        const element = documentService.getDocument().elements[elementId];
        if (!element || element.type === "nl.root" || isComponentEditorRootElement(element)) {
            return;
        }
        clearPendingBindingAutoCancel();
        completeElementBindingSessionForSession(activeBindingSession, {
            surfaceId: activeBindingSession.surfaceId,
            elementId: element.id,
            elementType: element.type,
        });
        returnToBindingBlueprint(activeBindingSession.blueprintTabId);
    }, [activeBindingSession, clearPendingBindingAutoCancel, documentService, returnToBindingBlueprint, stateService]);

    const handleCancelElementBinding = useCallback(() => {
        clearPendingBindingAutoCancel();
        if (!activeBindingSession) {
            cancelElementBindingSession();
            return;
        }
        const blueprintTabId = activeBindingSession.blueprintTabId;
        cancelElementBindingSession();
        returnToBindingBlueprint(blueprintTabId);
    }, [activeBindingSession, clearPendingBindingAutoCancel, returnToBindingBlueprint]);

    const layoutInteractionHints = useMemo(
        () =>
            surfaceDiagnostics
                .filter(d => d.elementId && (d.source === "layout" || d.source === "interaction"))
                .map(d => ({ elementId: d.elementId!, label: d.message })),
        [surfaceDiagnostics],
    );
    useDocumentDirtyIndicator(documentService, uiService, tabId);

    const { menuState, showMenu, hideMenu } = useContextMenu();

    const editorRootRef = useRef<HTMLDivElement | null>(null);
    const canvasRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);
    const doubleClickMouseDownRef = useRef<{
        time: number;
        x: number;
        y: number;
        button: number;
    } | null>(null);
    const focusSurfaceEditor = useCallback(() => {
        uiService?.focus.setFocus(FocusArea.Editor, tabId);
    }, [tabId, uiService]);

    // The interface editor's canvas is the case the frozen workspace was described by: *"select an
    // element and read its properties, but not modify or move it"*. This is the only place the freeze
    // enters the canvas - everything below `lib/ui-editor` takes a plain `readOnly` and knows nothing
    // about version control.
    const freeze = useFreezeGuard();
    const readOnly = useMemo<UIEditorReadOnly>(
        () => ({ active: freeze.frozen, reason: freeze.reason }),
        [freeze.frozen, freeze.reason],
    );

    // Opening an interface shows all of it: the canvas is fitted to the free part of the editing
    // area and centred there, and stays fitted while that area changes size - until the author
    // zooms or pans, after which the view is theirs and only the tool bar button below refits it.
    const { fitToViewport } = useSurfaceViewportAutoFit({
        stateService,
        surfaceId,
        designSize: surface?.designSize,
        viewportRef,
        active,
        enabled: Boolean(surface && stateService),
    });

    const { createElementAtClientPoint, surfaceImageDropTargetProps, surfaceImageDropOverlayClass } =
        useSurfaceImageDrop({
            viewportRef,
            viewport,
            documentService,
            surface,
            stateService,
            workspaceContext: context,
        });

    const { menuItems, handleCanvasContextMenu } = useSurfaceCanvasContextMenu({
        surface,
        documentService,
        stateService,
        uiService,
        localBlueprint,
        widgetModules,
        inputDialog,
        createElementAtClientPoint,
        allowAddSelectionToComponentLibrary: !isComponentEdit,
        showMenu,
        hideMenu,
    });

    const requestRenamePrimary = useCallback(() => {
        if (!stateService || !documentService || !surface || !inputDialog) {
            return;
        }
        const sel = stateService.getSelection();
        if (!isUIElementSelection(sel)) {
            return;
        }
        const data = sel.data as UIElementSelection;
        if (data.surfaceId !== surface.id || data.elementIds.length !== 1) {
            return;
        }
        const pid = data.primaryId ?? data.elementIds[0];
        const el = documentService.getDocument().elements[pid];
        if (!el || el.type === "nl.root" || isComponentEditorRootElement(el)) {
            return;
        }
        void inputDialog.showRenameDialog(el.name ?? el.type ?? t("uiEditor.editor.layerFallback"), "layer").then(name => {
            if (name) {
                documentService.renameElement(pid, name);
            }
        });
    }, [documentService, inputDialog, stateService, surface, t]);

    useUIEditorKeybindings({
        tabId,
        surfaceId: surface?.id,
        enabled: Boolean(surface && documentService && stateService && localBlueprint),
        contextMenuOpen: menuState.visible,
        onCloseContextMenu: hideMenu,
        documentService,
        localBlueprint,
        historyService,
        stateService,
        uiService,
        requestRenamePrimary,
        readOnly,
    });

    const hostAdapter = useMemo<UIHostAdapter>(() => {
        return {
            host: surface?.host ?? "app",
            editorStateService: stateService ?? undefined,
            editorDocumentService: documentService ?? undefined,
            // Beside the two services rather than anywhere else, because those two ARE the write
            // path a widget renderer can reach from inside its own markup - see
            // `resolveInlineTextEditHost`, which reads all three together.
            editorReadOnly: readOnly,
        };
    }, [documentService, readOnly, stateService, surface?.host]);

    const surfaceContent = useMemo(() => {
        if (!surfaceId || !runtimeBridge || !documentService) {
            return null;
        }
        const style = getEditorSurfaceStyle(surface);
        if (isComponentEdit) {
            return runtimeBridge.renderDocumentSurface({
                document: documentService.getDocument(),
                surfaceId,
                hostAdapter,
                className: "relative",
                style,
            });
        }
        return runtimeBridge.renderSurface({
            surfaceId,
            hostAdapter,
            className: "relative",
            style,
        });
    }, [documentService, isComponentEdit, runtimeBridge, surface, surfaceId, hostAdapter, documentVersion, brandRevision]);

    const applyTool = useCallback(
        (nextTool: UITool) => {
            if (!stateService) return;
            stateService.setTool(nextTool);
        },
        [stateService]
    );

    const handleSelectTool = useCallback(() => applyTool({ kind: "select" }), [applyTool]);
    const handlePanTool = useCallback(() => applyTool({ kind: "pan" }), [applyTool]);
    const handleToggleSmartSnap = useCallback(() => {
        if (!stateService) {
            return;
        }
        stateService.setSmartSnapEnabled(!stateService.getSmartSnapEnabled());
    }, [stateService]);
    const devModeService = useMemo(() => {
        if (!context) {
            return null;
        }
        return context.services.get<DevModeService>(Services.DevMode);
    }, [context]);
    const handleStartCurrentSurface = useCallback(() => {
        if (isComponentEdit || !surfaceId || !devModeService || !workspace) {
            return;
        }
        void (async () => {
            try {
                await flushUIDocAndGraphIfDirty(workspace);
            } catch (e) {
                console.error("[DevMode] flush before launch failed", e);
            }
            // The canvas launch button is the one that carries the canvas's own reference frame
            // across. The top bar's Run is "play it as the player gets it" and passes nothing, so
            // the two launches stay meaningfully different.
            await devModeService.launch({
                kind: "surface",
                surfaceId,
                safeAreaId: previewSafeAreaId,
                mobileOrientation,
                viewport: readProjectViewportConfig(context),
            });
        })();
    }, [context, devModeService, isComponentEdit, mobileOrientation, previewSafeAreaId, surfaceId, workspace]);

    const handleOpenSurfaceEditor = useCallback(
        (targetSurfaceId: string) => {
            const targetSurface = baseDocumentService?.getDocument().surfaces.find(next => next.id === targetSurfaceId);
            if (!targetSurface) {
                return;
            }
            openEditorTab({
                id: getSurfaceTabId(targetSurface.id),
                title: targetSurface.name,
                icon: <PanelsTopLeft className="w-4 h-4" />,
                component: UISurfaceEditorTab,
                payload: { surfaceId: targetSurface.id },
                closable: true,
                modified: false,
            });
        },
        [baseDocumentService, openEditorTab],
    );

    const handleOpenComponentEditor = useCallback(
        (targetComponentId: string) => {
            const component = baseDocumentService?.getComponent(targetComponentId);
            if (!component) {
                return;
            }
            openEditorTab({
                id: getComponentTabId(component.id),
                title: component.name,
                icon: <PanelsTopLeft className="w-4 h-4" />,
                component: UISurfaceEditorTab,
                payload: { componentId: component.id },
                closable: true,
                modified: false,
            });
        },
        [baseDocumentService, openEditorTab],
    );

    const toolButtonClass = (active: boolean) =>
        `w-9 h-9 rounded-md border flex items-center justify-center text-xs transition-colors ${
            active
                ? "border-primary bg-primary/20 text-fg"
                : "border-edge text-fg-muted hover:border-primary hover:text-fg hover:bg-fill"
        } disabled:opacity-50 disabled:cursor-not-allowed`;

    useSurfaceInteractionCropDimming({
        surfaceId,
        stateService,
        canvasRef,
        documentVersion,
    });

    const handleSurfaceDoubleClick = useSurfaceDoubleClick({
        surfaceId: surfaceId ?? "",
        tool,
        stateService,
        documentService,
        readOnly,
    });

    /**
     * Say which stack a scope-less undo means while this surface is the one on screen.
     *
     * Every other editor claims this on editor focus, through `useHistoryScope`. This one owns its
     * stack through {@link UIEditorHistoryService} instead and so claimed nothing at all - which the
     * canvas never noticed, because its own `mod+z` addresses the surface directly, but the Edit
     * menu and the shell keybinding both read the active scope and were therefore answering for the
     * project stack whatever the author had open.
     *
     * Keyed on `active` rather than on focus: an edit made in the property inspector belongs to the
     * surface being shown, and by then focus is on the panel rather than on the canvas.
     */
    useEffect(() => {
        if (!historyService || !surfaceId || !active || !context) {
            return undefined;
        }
        const history = context.services.get<HistoryService>(Services.History);
        const scopeId = uiSurfaceHistoryScope(surfaceId);
        history.setActiveScope(scopeId);
        return () => {
            if (history.getActiveScopeId() === scopeId) {
                history.setActiveScope(null);
            }
        };
    }, [active, context, historyService, surfaceId]);

    useEffect(() => {
        const root = editorRootRef.current;
        // These are document-level capture listeners; a kept-alive tab stays mounted while hidden, so
        // only the visible surface editor should listen — otherwise every hidden editor runs its
        // handler on every app-wide mousedown/dblclick.
        if (!root || !active) {
            return undefined;
        }
        const shouldHandleEditorClick = (event: MouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (!target) {
                debugUIDoubleClick("document dblclick ignored no element target", {});
                return false;
            }
            const isInsideEditor = root.contains(target);
            const isMoveableTarget = Boolean(target.closest(MOVEABLE_DOUBLE_CLICK_TARGET_SELECTOR));
            debugUIDoubleClick("document editor click candidate", {
                target: describeDoubleClickTarget(target),
                isInsideEditor,
                isMoveableTarget,
                clientX: event.clientX,
                clientY: event.clientY,
            });
            return isInsideEditor || isMoveableTarget;
        };

        const handleNativeDoubleClick = (event: MouseEvent) => {
            if (!shouldHandleEditorClick(event)) {
                return;
            }
            debugUIDoubleClick("native dblclick handled", {
                clientX: event.clientX,
                clientY: event.clientY,
            });
            handleSurfaceDoubleClick(event);
        };

        const handleMouseDown = (event: MouseEvent) => {
            if (event.button !== 0 || !shouldHandleEditorClick(event)) {
                doubleClickMouseDownRef.current = null;
                return;
            }

            const now = event.timeStamp || performance.now();
            const previous = doubleClickMouseDownRef.current;
            doubleClickMouseDownRef.current = {
                time: now,
                x: event.clientX,
                y: event.clientY,
                button: event.button,
            };
            if (!previous || previous.button !== event.button) {
                return;
            }

            const dt = now - previous.time;
            const dx = event.clientX - previous.x;
            const dy = event.clientY - previous.y;
            const closeEnough = dx * dx + dy * dy <= 64;
            if (dt < 80 || dt > 500 || !closeEnough) {
                return;
            }

            doubleClickMouseDownRef.current = null;
            debugUIDoubleClick("manual doubleclick handled", {
                dt,
                dx,
                dy,
                clientX: event.clientX,
                clientY: event.clientY,
            });
            handleSurfaceDoubleClick(event);
        };

        document.addEventListener("mousedown", handleMouseDown, true);
        document.addEventListener("dblclick", handleNativeDoubleClick, true);
        return () => {
            document.removeEventListener("mousedown", handleMouseDown, true);
            document.removeEventListener("dblclick", handleNativeDoubleClick, true);
        };
    }, [handleSurfaceDoubleClick, active]);

    // `stateService` is null only while the workspace context is, and `surface` is read through
    // that same context - so a surface implies a state service. Guarding both here is what lets the
    // toolbar below use it without a null branch: the alternative is a disabled twin control that
    // can never render but still has to be written, styled and translated.
    if (!surface || !stateService) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-fg-subtle">
                {isComponentEdit ? t("uiEditor.editor.componentNotFound") : t("uiEditor.editor.interfaceNotFound")}
            </div>
        );
    }

    const transformStyle = {
        transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`,
        transformOrigin: "top left" as const,
    };

    return (
        // A component being edited is the same canvas answering a different question, so the two
        // read as different topics even though the editor is one component.
        <div
            className="h-full flex overflow-hidden border border-edge"
            data-help-topic={isComponentEdit ? "uiComponents" : "uiSurfaces"}
        >
            <WidgetRuntimeStateProvider key={surface.id}>
                <div
                    ref={editorRootRef}
                    className="relative flex-1 bg-surface-canvas"
                    onContextMenu={handleCanvasContextMenu}
                    onMouseDownCapture={focusSurfaceEditor}
                    onFocusCapture={focusSurfaceEditor}
                >
                    <SurfaceOutlinePanel
                        surfaceId={surface.id}
                        stateService={stateService}
                        documentService={documentService}
                        uiService={uiService}
                        localBlueprint={localBlueprint}
                        inputDialog={inputDialog}
                        allowAddSelectionToComponentLibrary={!isComponentEdit}
                        readOnly={readOnly}
                    />

                    {/* Top toolbar */}
                    <div className="absolute top-3 right-3 z-20 flex items-center gap-2 rounded-md border border-edge-strong bg-surface-canvas/80 px-2 py-1">
                        <button
                            type="button"
                            className={toolButtonClass(tool.kind === "select")}
                            onClick={handleSelectTool}
                            data-tip={t("uiEditor.editor.selectTool")} aria-label={t("uiEditor.editor.selectTool")}
                        >
                            <MousePointer2 className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            className={toolButtonClass(tool.kind === "pan")}
                            onClick={handlePanTool}
                            data-tip={t("uiEditor.editor.panTool")} aria-label={t("uiEditor.editor.panTool")}
                        >
                            <Move className="w-4 h-4" />
                        </button>
                        {/* The zoom the canvas is at, and the way back to the fit it opened with. */}
                        <button
                            type="button"
                            className={`${toolButtonClass(false)} w-auto min-w-[3.25rem] gap-1 px-2 tabular-nums`}
                            onClick={fitToViewport}
                            data-tip={t("uiEditor.editor.fitToView")} aria-label={t("uiEditor.editor.fitToView")}
                        >
                            <Maximize className="h-4 w-4 shrink-0" />
                            {Math.round(viewport.scale * 100)}%
                        </button>
                        <SurfaceEditorToolbarButtonGroup aria-label={t("uiEditor.snap.label")}>
                            <SurfaceEditorToolbarSegButton
                                type="button"
                                active={smartSnapEnabled}
                                onClick={handleToggleSmartSnap}
                                data-tip={t("uiEditor.snap.tip")}
                                aria-pressed={smartSnapEnabled}
                            >
                                <Magnet className="h-4 w-4" />
                            </SurfaceEditorToolbarSegButton>
                            <SurfaceSnapSettingsTrigger stateService={stateService} detail={smartSnapDetail} />
                        </SurfaceEditorToolbarButtonGroup>
                        <SurfaceAlignTrigger
                            surfaceId={surface.id}
                            documentService={documentService}
                            stateService={stateService}
                            readOnly={readOnly.active}
                            readOnlyReason={readOnly.reason}
                            revision={`${documentVersion}:${selectionVersion}`}
                        />
                        <SurfacePreviewFramesTrigger
                            stateService={stateService}
                            aspectId={previewAspectId}
                            safeAreaId={previewSafeAreaId}
                        />
                        <div className="mx-1 h-6 w-px bg-fill" />
                        <button
                            type="button"
                            className={toolButtonClass(false)}
                            onClick={handleStartCurrentSurface}
                            data-tip={isComponentEdit ? t("uiEditor.editor.componentDefinitionHint") : t("uiEditor.editor.openInDevMode")} aria-label={isComponentEdit ? t("uiEditor.editor.componentDefinitionHint") : t("uiEditor.editor.openInDevMode")}
                            disabled={!surfaceId || isComponentEdit}
                        >
                            <Play className="w-4 h-4" />
                        </button>
                    </div>

                    {activeBindingSession ? (
                        <div className="absolute left-1/2 top-3 z-30 flex -translate-x-1/2 items-center gap-2 rounded-md border border-primary/30 bg-surface-overlay/95 px-3 py-2 text-xs text-fg shadow-lg">
                            <div className="min-w-[220px]">
                                <div className="font-medium text-primary">{t("uiEditor.editor.bindElement")}</div>
                                <div className="max-w-[300px] truncate text-2xs text-fg-muted">
                                    {bindingSelection ? bindingSelection.label : t("uiEditor.editor.bindSelectHint")}
                                </div>
                            </div>
                            <button
                                type="button"
                                className="rounded-md border border-primary/35 bg-primary/15 px-2.5 py-1 text-2xs font-medium text-fg hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-45"
                                {...freeze.writes(!bindingSelection)}
                                onClick={handleConfirmElementBinding}
                            >
                                {t("common.confirm")}
                            </button>
                            <button
                                type="button"
                                className="rounded-md border border-edge bg-fill-subtle px-2.5 py-1 text-2xs text-fg-muted hover:bg-fill"
                                onClick={handleCancelElementBinding}
                            >
                                {t("common.cancel")}
                            </button>
                        </div>
                    ) : null}

                    {/* Viewport / Canvas */}
                    <div
                        ref={viewportRef}
                        className={`absolute inset-0 overflow-hidden ${surfaceImageDropOverlayClass}`}
                        {...surfaceImageDropTargetProps}
                    >
                        {surfaceLevelDiagnosticMessages.length > 0 ? (
                            <div className="absolute left-64 right-36 top-14 z-20 rounded-md border border-warning/35 bg-warning/10 px-3 py-2 text-2xs text-warning">
                                <span className="font-medium text-warning">{t("uiEditor.editor.staticChecks")}</span>
                                <span className="text-warning/85">{surfaceLevelDiagnosticMessages.join(" · ")}</span>
                                <span className="mt-1 block text-2xs text-fg-subtle">
                                    {t("uiEditor.editor.devModeHint")}
                                </span>
                            </div>
                        ) : null}
                        <div ref={canvasRef} className="relative h-full w-full" style={transformStyle}>
                            {surfaceContent}
                            {/* Design-space reference frames, under the diagnostics and interaction layers. */}
                            <SurfacePreviewFramesOverlay
                                designSize={surface.designSize}
                                aspectId={previewAspectId}
                                safeAreaId={previewSafeAreaId}
                                mobileOrientation={mobileOrientation}
                                stageFit={stageFit}
                                viewportScale={viewport.scale}
                            />
                            {documentService ? (
                                <SurfaceLayoutDiagnosticMarkers
                                    document={documentService.getDocument()}
                                    hints={layoutInteractionHints}
                                />
                            ) : null}
                        </div>
                        {/* Outside the transformed node on purpose - this one is text. */}
                        <SurfacePreviewFramesReadout
                            designSize={surface.designSize}
                            aspectId={previewAspectId}
                            safeAreaId={previewSafeAreaId}
                            mobileOrientation={mobileOrientation}
                            stageFit={stageFit}
                        />
                    </div>

                    {stateService && documentService ? (
                        <UIEditorInteractionLayer
                            surfaceId={surface.id}
                            surface={surface}
                            containerRef={viewportRef}
                            stateService={stateService}
                            documentService={documentService}
                            uiService={uiService}
                            showOutlines={true}
                            openSurfaceEditor={handleOpenSurfaceEditor}
                            openComponentEditor={handleOpenComponentEditor}
                            readOnly={readOnly}
                        />
                    ) : null}

                    {/* Docker bar */}
                    {stateService && documentService && (
                        <UIEditorDockerBar
                            surfaceId={surface.id}
                            stateService={stateService}
                            documentService={documentService}
                            runtimeBridge={runtimeBridge}
                            enableComponents={!isComponentEdit}
                            readOnly={readOnly}
                        />
                    )}

                    {/* Context menu */}
                    <ContextMenu
                        items={menuItems}
                        position={menuState.position}
                        visible={menuState.visible}
                        onClose={hideMenu}
                    />
                </div>
            </WidgetRuntimeStateProvider>
        </div>
    );
}
