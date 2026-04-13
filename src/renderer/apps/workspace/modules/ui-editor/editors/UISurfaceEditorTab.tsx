import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { EditorComponentProps } from "../../types";
import { UIEditorInteractionLayer, useUIEditorKeybindings } from "@/lib/ui-editor/interaction";
import { UIEditorDockerBar } from "@/lib/ui-editor/docker";
import { MousePointer2, Move, Play } from "lucide-react";
import type { UITool } from "@/lib/ui-editor/editor/types";
import { ContextMenu, useContextMenu } from "@/lib/components/elements/ContextMenu";
import { createInputDialog } from "@/lib/components/dialogs";
import { LocalBlueprintService } from "@/lib/workspace/services/ui-editor/LocalBlueprintService";
import { isUIElementSelection } from "@/lib/workspace/services/ui/UIStore";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import { useUISurfaceEditorServices } from "@/apps/workspace/modules/ui-editor/editors/useUISurfaceEditorServices";
import { useWorkspace } from "@/apps/workspace/context";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { Services } from "@/lib/workspace/services/services";
import { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
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
} from "@/apps/workspace/modules/ui-editor/editors/useSurfaceEditorTabModel";
import { useSurfaceCanvasContextMenu } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceCanvasContextMenu";
import { useSurfaceImageDrop } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceImageDrop";
import { useSurfaceDoubleClick } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceDoubleClick";
import { useSurfaceInteractionCropDimming } from "@/apps/workspace/modules/ui-editor/editors/useSurfaceInteractionCropDimming";

export function UISurfaceEditorTab({ tabId, payload }: EditorComponentProps<{ surfaceId: string }>) {
    const surfaceId = payload?.surfaceId;
    const { runtimeBridge, stateService, documentService, uiService, widgetModules } = useUISurfaceEditorServices();
    const { context, workspace } = useWorkspace();
    const localBlueprint = useMemo(
        () => context?.services.get<LocalBlueprintService>(Services.LocalBlueprint) ?? null,
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
    const { surface, documentVersion } = useSurfaceDocument(surfaceId, stateService, documentService);
    const deferredDocumentVersion = useDeferredValue(documentVersion);
    const deferredGraphVersion = useDeferredValue(graphVersion);

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

    const layoutInteractionHints = useMemo(
        () =>
            surfaceDiagnostics
                .filter(d => d.elementId && (d.source === "layout" || d.source === "interaction"))
                .map(d => ({ elementId: d.elementId!, label: d.message })),
        [surfaceDiagnostics],
    );
    useDocumentDirtyIndicator(documentService, uiService, tabId);

    const { menuState, showMenu, hideMenu } = useContextMenu();

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);

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
        localBlueprint,
        widgetModules,
        inputDialog,
        createElementAtClientPoint,
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
        if (!el || el.type === "nl.root") {
            return;
        }
        void inputDialog.showRenameDialog(el.name ?? el.type ?? "Layer", "layer").then(name => {
            if (name) {
                documentService.renameElement(pid, name);
            }
        });
    }, [documentService, inputDialog, stateService, surface]);

    useUIEditorKeybindings({
        tabId,
        surfaceId: surface?.id,
        enabled: Boolean(surface && documentService && stateService && localBlueprint),
        contextMenuOpen: menuState.visible,
        onCloseContextMenu: hideMenu,
        documentService,
        localBlueprint,
        stateService,
        requestRenamePrimary,
    });

    const hostAdapter = useMemo(() => {
        return {
            host: surface?.host ?? "app",
        };
    }, [surface?.host]);

    const surfaceContent = useMemo(() => {
        if (!surfaceId || !runtimeBridge) {
            return null;
        }
        return runtimeBridge.renderSurface({
            surfaceId,
            hostAdapter,
            className: "relative",
        });
    }, [runtimeBridge, surfaceId, hostAdapter, documentVersion]);

    const applyTool = useCallback(
        (nextTool: UITool) => {
            if (!stateService) return;
            stateService.setTool(nextTool);
        },
        [stateService]
    );

    const handleSelectTool = useCallback(() => applyTool({ kind: "select" }), [applyTool]);
    const handlePanTool = useCallback(() => applyTool({ kind: "pan" }), [applyTool]);
    const devModeService = useMemo(() => {
        if (!context) {
            return null;
        }
        return context.services.get<DevModeService>(Services.DevMode);
    }, [context]);
    const handleStartCurrentSurface = useCallback(() => {
        if (!surfaceId || !devModeService || !workspace) {
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
    }, [devModeService, surfaceId, workspace]);

    const toolButtonClass = (active: boolean) =>
        `w-9 h-9 rounded-md border flex items-center justify-center text-xs transition-colors ${
            active
                ? "border-primary bg-primary/20 text-white"
                : "border-white/10 text-gray-400 hover:border-primary hover:text-white hover:bg-white/10"
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

    if (!surface) {
        return (
            <div className="h-full flex items-center justify-center text-sm text-gray-500">
                Surface not found
            </div>
        );
    }

    const transformStyle = {
        transform: `translate(${viewport.offsetX}px, ${viewport.offsetY}px) scale(${viewport.scale})`,
        transformOrigin: "top left" as const,
    };

    return (
        <div className="h-full flex overflow-hidden border border-white/10">
            <WidgetRuntimeStateProvider key={surface.id}>
                <div className="relative flex-1 bg-[#050f10]" onContextMenu={handleCanvasContextMenu}>
                    <SurfaceOutlinePanel
                        surfaceId={surface.id}
                        stateService={stateService}
                        documentService={documentService}
                        localBlueprint={localBlueprint}
                        inputDialog={inputDialog}
                    />

                    {/* Top toolbar */}
                    <div className="absolute top-3 right-3 z-20 flex items-center gap-2 rounded-md border border-white/20 bg-[#05060a]/80 px-2 py-1">
                        <button
                            type="button"
                            className={toolButtonClass(tool.kind === "select")}
                            onClick={handleSelectTool}
                            title="Select tool"
                        >
                            <MousePointer2 className="w-4 h-4" />
                        </button>
                        <button
                            type="button"
                            className={toolButtonClass(tool.kind === "pan")}
                            onClick={handlePanTool}
                            title="Pan the canvas"
                        >
                            <Move className="w-4 h-4" />
                        </button>
                        <div className="mx-1 h-6 w-px bg-white/10" />
                        <button
                            type="button"
                            className={toolButtonClass(false)}
                            onClick={handleStartCurrentSurface}
                            title="Open this surface in Dev Mode"
                            disabled={!surfaceId}
                        >
                            <Play className="w-4 h-4" />
                        </button>
                    </div>

                    {/* Viewport / Canvas */}
                    <div
                        ref={viewportRef}
                        className={`absolute inset-0 overflow-hidden ${surfaceImageDropOverlayClass}`}
                        {...surfaceImageDropTargetProps}
                        onDoubleClick={handleSurfaceDoubleClick}
                    >
                        {surfaceLevelDiagnosticMessages.length > 0 ? (
                            <div className="absolute left-64 right-36 top-14 z-20 rounded-md border border-amber-500/35 bg-amber-950/40 px-3 py-2 text-[11px] text-amber-100/90">
                                <span className="font-medium text-amber-200/95">Static checks (editor only): </span>
                                <span className="text-amber-100/85">{surfaceLevelDiagnosticMessages.join(" · ")}</span>
                                <span className="mt-1 block text-[10px] text-gray-500">
                                    Open Dev Mode for real execution, node traces, and Host API calls.
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

                    <UIEditorInteractionLayer
                        surfaceId={surface.id}
                        surface={surface}
                        containerRef={viewportRef}
                        showOutlines={true}
                    />

                    {/* Docker bar */}
                    {stateService && documentService && (
                        <UIEditorDockerBar
                            surfaceId={surface.id}
                            stateService={stateService}
                            documentService={documentService}
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
