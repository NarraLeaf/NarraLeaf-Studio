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
import { MousePointer2, Move, Play, Magnet, ChevronDown, PanelsTopLeft } from "lucide-react";
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
} from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";
import { useSurfaceCanvasContextMenu } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceCanvasContextMenu";
import { useSurfaceImageDrop } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceImageDrop";
import { useSurfaceDoubleClick } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceDoubleClick";
import { useSurfaceInteractionCropDimming } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceInteractionCropDimming";
import {
    SurfaceEditorToolbarButtonGroup,
    SurfaceEditorToolbarSegButton,
} from "@/apps/workspace/modules/ui-editor/editors/SurfaceEditorToolbarButtonGroup";
import { SurfaceSnapSettingsTrigger } from "@/apps/workspace/modules/ui-editor/editors/SurfaceSnapSettingsMenu";
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
    const { surface, documentVersion } = useSurfaceDocument(surfaceId, stateService, documentService);
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
    });

    const hostAdapter = useMemo<UIHostAdapter>(() => {
        return {
            host: surface?.host ?? "app",
            editorStateService: stateService ?? undefined,
            editorDocumentService: documentService ?? undefined,
        };
    }, [documentService, stateService, surface?.host]);

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
    }, [documentService, isComponentEdit, runtimeBridge, surface, surfaceId, hostAdapter, documentVersion]);

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
            await devModeService.launch({
                kind: "surface",
                surfaceId,
            });
        })();
    }, [devModeService, isComponentEdit, surfaceId, workspace]);

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
    });

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

    if (!surface) {
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
        <div className="h-full flex overflow-hidden border border-edge">
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
                    />

                    {/* Top toolbar */}
                    <div className="absolute top-3 right-3 z-20 flex items-center gap-2 rounded-md border border-edge-strong bg-surface-canvas/80 px-2 py-1">
                        <button
                            type="button"
                            className={toolButtonClass(tool.kind === "select")}
                            onClick={handleSelectTool}
                            title={t("uiEditor.editor.selectTool")}
                        >
                            <MousePointer2 className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            className={toolButtonClass(tool.kind === "pan")}
                            onClick={handlePanTool}
                            title={t("uiEditor.editor.panTool")}
                        >
                            <Move className="w-4 h-4" />
                        </button>
                        <SurfaceEditorToolbarButtonGroup aria-label={t("uiEditor.snap.label")}>
                            <SurfaceEditorToolbarSegButton
                                type="button"
                                active={smartSnapEnabled}
                                onClick={handleToggleSmartSnap}
                                title={t("uiEditor.snap.tip")}
                                disabled={!stateService}
                                aria-pressed={smartSnapEnabled}
                            >
                                <Magnet className="h-4 w-4" />
                            </SurfaceEditorToolbarSegButton>
                            {stateService ? (
                                <SurfaceSnapSettingsTrigger stateService={stateService} detail={smartSnapDetail} />
                            ) : (
                                <SurfaceEditorToolbarSegButton type="button" disabled title={t("uiEditor.snap.settings")} aria-label={t("uiEditor.snap.settings")}>
                                    <ChevronDown className="h-4 w-4" />
                                </SurfaceEditorToolbarSegButton>
                            )}
                        </SurfaceEditorToolbarButtonGroup>
                        <div className="mx-1 h-6 w-px bg-fill" />
                        <button
                            type="button"
                            className={toolButtonClass(false)}
                            onClick={handleStartCurrentSurface}
                            title={isComponentEdit ? t("uiEditor.editor.componentDefinitionHint") : t("uiEditor.editor.openInDevMode")}
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
                                className="rounded border border-primary/35 bg-primary/15 px-2.5 py-1 text-2xs font-medium text-fg hover:bg-primary/25 disabled:cursor-not-allowed disabled:opacity-45"
                                disabled={!bindingSelection}
                                onClick={handleConfirmElementBinding}
                            >
                                {t("common.confirm")}
                            </button>
                            <button
                                type="button"
                                className="rounded border border-edge bg-fill-subtle px-2.5 py-1 text-2xs text-fg-muted hover:bg-fill"
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
                            {documentService ? (
                                <SurfaceLayoutDiagnosticMarkers
                                    document={documentService.getDocument()}
                                    hints={layoutInteractionHints}
                                />
                            ) : null}
                        </div>
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
