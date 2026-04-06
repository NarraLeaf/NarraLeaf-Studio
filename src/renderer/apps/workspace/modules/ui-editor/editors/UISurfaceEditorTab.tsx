import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorComponentProps } from "../../types";
import { UIEditorInteractionLayer, UILayersPanel } from "@/lib/ui-editor/interaction";
import { SELECTABLE_TARGET } from "@/lib/ui-editor/interaction/constants";
import { UIEditorDockerBar } from "@/lib/ui-editor/docker";
import { MousePointer2, Move, ChevronUp, ChevronDown, Play } from "lucide-react";
import type { UITool } from "@/lib/ui-editor/editor/types";
import { clientToSurface, Rect2D } from "@/lib/ui-editor/geometry";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIWidgetModule } from "@/lib/ui-editor/widget-modules/types";
import { useUISurfaceEditorServices } from "@/apps/workspace/modules/ui-editor/editors/useUISurfaceEditorServices";
import { useWorkspace } from "@/apps/workspace/context";
import { DevModeService } from "@/lib/workspace/services/core/DevModeService";
import { InteractionOverride, Services } from "@/lib/workspace/services/services";
import { UIGraphService } from "@/lib/workspace/services/ui-editor/UIGraphService";
import { collectSurfaceDiagnostics } from "@/lib/ui-editor/diagnostics/collectSurfaceDiagnostics";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { getImageWidgetRectangleProps } from "@/lib/ui-editor/widget-modules/builtin/image/helpers";
import { getRectangleLikeProps, normalizeImageFill } from "@/lib/ui-editor/widget-modules/shared/chrome/rectangleHelpers";
import type { ImageFill } from "@shared/types/ui-editor/imageFill";

type ViewportTransform = {
    scale: number;
    offsetX: number;
    offsetY: number;
};

const DEFAULT_VIEWPORT: ViewportTransform = { scale: 1, offsetX: 0, offsetY: 0 };

export function UISurfaceEditorTab({ tabId, payload }: EditorComponentProps<{ surfaceId: string }>) {
    const surfaceId = payload?.surfaceId;
    const { runtimeBridge, stateService, documentService, uiService, widgetModules } = useUISurfaceEditorServices();
    const { context } = useWorkspace();
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

    const surfaceDiagnostics = useMemo(() => {
        if (!documentService || !surface) {
            return [];
        }
        const bp = graphService?.getDocument().blueprintDocument;
        return collectSurfaceDiagnostics(documentService.getDocument(), surface.id, { blueprintDocument: bp });
    }, [documentService, surface, graphService, documentVersion, graphVersion]);

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
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const lastContextPoint = useRef<{ x: number; y: number } | null>(null);

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);

    const hostAdapter = useMemo(() => {
        return {
            host: surface?.host ?? "app",
            effects: {
                runEffect: () => undefined,
            },
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
        if (!surfaceId || !devModeService) {
            return;
        }
        void devModeService.launch({
            kind: "surface",
            surfaceId,
        });
    }, [devModeService, surfaceId]);

    const toolButtonClass = (active: boolean) =>
        `w-9 h-9 rounded-md border flex items-center justify-center text-xs transition-colors ${
            active
                ? "border-primary bg-primary/20 text-white"
                : "border-white/10 text-gray-400 hover:border-primary hover:text-white hover:bg-white/10"
        } disabled:opacity-50 disabled:cursor-not-allowed`;

    const createElementAtClientPoint = useCallback(
        (type: string, point: { x: number; y: number }) => {
            if (!documentService || !surface || !stateService) {
                return;
            }
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }
            const rect = canvas.getBoundingClientRect();
            const containerRect: Rect2D = {
                x: rect.x,
                y: rect.y,
                width: rect.width,
                height: rect.height,
            };
            const surfacePoint = clientToSurface({ x: point.x, y: point.y }, viewport, containerRect);
            const layoutPatch = {
                x: Math.max(0, surfacePoint.x),
                y: Math.max(0, surfacePoint.y),
            };
            const element = documentService.createElement(surface.rootElementId, type, layoutPatch);
            stateService.setUIElementSelection({
                editor: "ui",
                surfaceId: surface.id,
                elementIds: [element.id],
                primaryId: element.id,
            });
            stateService.setTool({ kind: "select" });
        },
        [documentService, surface, stateService, viewport]
    );

    const handleCanvasContextMenu = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!surface || widgetModules.length === 0) {
                return;
            }
            event.preventDefault();
            event.stopPropagation();
            lastContextPoint.current = { x: event.clientX, y: event.clientY };
            const items: ContextMenuDef = widgetModules.map((mod: UIWidgetModule) => ({
                id: `insert-${mod.type}`,
                label: `Insert ${mod.displayName}`,
                onClick: () => {
                    const point = lastContextPoint.current;
                    if (!point) {
                        return;
                    }
                    createElementAtClientPoint(mod.type, point);
                },
            }));
            setMenuItems(items);
            showMenu(event);
        },
        [surface, widgetModules, showMenu, createElementAtClientPoint]
    );

    const updateCropDimming = useCallback(
        (override: InteractionOverride | null) => {
            const canvas = canvasRef.current;
            if (!canvas) {
                return;
            }
            const nodes = canvas.querySelectorAll<HTMLElement>(".ui-editor-node:not(.ui-editor-node-root)");
            nodes.forEach(node => {
                if (override?.kind === "imageCrop" && override.surfaceId === surfaceId) {
                    const isActive = node.dataset.uiElementId === override.elementId;
                    if (isActive) {
                        delete node.dataset.uiCropDim;
                    } else {
                        node.dataset.uiCropDim = "true";
                    }
                } else {
                    delete node.dataset.uiCropDim;
                }
            });
        },
        [surfaceId]
    );

    useEffect(() => {
        if (!stateService) {
            return;
        }
        const current = stateService.getInteractionOverride();
        updateCropDimming(current);
        const unsubscribe = stateService.on("interactionOverrideChanged", updateCropDimming);
        return () => {
            unsubscribe();
            updateCropDimming(null);
        };
    }, [stateService, updateCropDimming, documentVersion]);

    const handleSurfaceDoubleClick = useCallback(
        (event: React.MouseEvent<HTMLDivElement>) => {
            if (!stateService || !documentService || !surfaceId) {
                return;
            }
            if (tool.kind !== "select") {
                return;
            }
            const target = event.target as HTMLElement | null;
            if (!target) {
                return;
            }
            if (
                target.closest(
                    ".moveable, .moveable-control, .moveable-line, .moveable-rotation, .moveable-rotation-handle, .moveable-area"
                )
            ) {
                return;
            }
            const elementNode = target.closest(SELECTABLE_TARGET) as HTMLElement | null;
            if (!elementNode) {
                return;
            }
            const elementId = elementNode.dataset.uiElementId;
            if (!elementId) {
                return;
            }
            const selection = stateService.getSelection();
            const selectionData = selection.type === "element" ? selection.data : null;
            if (
                !selectionData ||
                selectionData.surfaceId !== surfaceId ||
                selectionData.elementIds.length !== 1 ||
                selectionData.elementIds[0] !== elementId
            ) {
                return;
            }
            const element = documentService.getDocument().elements[elementId];
            if (!element) {
                return;
            }
            if (element.type === "nl.text") {
                event.preventDefault();
                stateService.setInteractionOverride({
                    kind: "textEdit",
                    surfaceId,
                    elementId,
                });
                return;
            }
            const isContainer = element.type === "nl.container";
            const isImageWidget = element.type === "nl.image";
            if (!isContainer && !isImageWidget) {
                return;
            }
            const props = isImageWidget ? getImageWidgetRectangleProps(element) : getRectangleLikeProps(element);
            if (props.fillType !== "image") {
                return;
            }
            const fill = normalizeImageFill(props);
            const hasImageSource = Boolean(fill?.assetId) || Boolean(props.backgroundImage?.trim());
            if (!hasImageSource) {
                return;
            }
            if (fill?.mode !== "crop") {
                const nextFill: ImageFill = {
                    ...(fill ?? { mode: "cover", assetId: null }),
                    mode: "crop",
                };
                documentService.updateElementProps(elementId, {
                    ...(element.props ?? {}),
                    fillType: "image",
                    imageFill: nextFill,
                });
            }
            stateService.setInteractionOverride({
                kind: "imageCrop",
                surfaceId,
                elementId,
                source: "surfaceDoubleClick",
            });
        },
        [documentService, stateService, surfaceId, tool.kind]
    );

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
            <div className="relative flex-1 bg-[#050f10]" onContextMenu={handleCanvasContextMenu}>
                <SurfaceOutlinePanel surfaceId={surface.id} />

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
                <div ref={viewportRef} className="absolute inset-0 overflow-hidden" onDoubleClick={handleSurfaceDoubleClick}>
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
        </div>
    );
}

function SurfaceLayoutDiagnosticMarkers(props: { document: UIDocument; hints: { elementId: string; label: string }[] }) {
    const { document, hints } = props;
    if (hints.length === 0) {
        return null;
    }
    return (
        <div className="pointer-events-none absolute inset-0 z-[5]">
            {hints.map(h => {
                const el = document.elements[h.elementId];
                if (!el) {
                    return null;
                }
                const { x, y, width, height } = el.layout;
                return (
                    <div
                        key={h.elementId}
                        className="absolute rounded-sm border border-amber-500/45 bg-amber-500/[0.07]"
                        style={{ left: x, top: y, width: Math.max(width, 2), height: Math.max(height, 2) }}
                    >
                        <span className="absolute left-0 top-full z-10 mt-0.5 max-w-[240px] truncate rounded bg-black/75 px-1 py-0.5 text-[9px] leading-tight text-amber-100/95 shadow-sm">
                            {h.label}
                        </span>
                    </div>
                );
            })}
        </div>
    );
}

function SurfaceOutlinePanel({ surfaceId }: { surfaceId: string }) {
    const [isCollapsed, setCollapsed] = useState(false);

    if (!surfaceId) {
        return null;
    }

    const panelClasses = `absolute inset-y-0 left-0 z-10 w-64 border-r border-white/5 bg-[#080a0e] transition-transform duration-200 ease-out ${
        isCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100 pointer-events-auto"
    }`;

    return (
        <>
            <div className={panelClasses}>
                <div className="px-3 py-2 border-b border-white/10 text-xs uppercase text-gray-500 flex items-center justify-between">
                    <span>UI Outline</span>
                    <button
                        type="button"
                        className="text-gray-400 hover:text-white transition-colors"
                        onClick={() => setCollapsed(value => !value)}
                        title={isCollapsed ? "Expand outline panel" : "Collapse outline panel"}
                    >
                        {isCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                    </button>
                </div>
                {!isCollapsed && (
                    <div className="h-full">
                        <UILayersPanel surfaceId={surfaceId} />
                    </div>
                )}
            </div>
            {isCollapsed && (
                <button
                    type="button"
                    className="absolute left-3 top-3 z-20 h-10 w-10 flex items-center justify-center rounded-full border border-white/20 bg-[#05060a]/80 text-gray-300 hover:text-white focus:outline-none"
                    onClick={() => setCollapsed(false)}
                    title="Expand outline panel"
                >
                    <ChevronDown className="w-4 h-4" />
                </button>
            )}
        </>
    );
}

type UISurfaceEditorServicesBundle = ReturnType<typeof useUISurfaceEditorServices>;
type EditorStateService = UISurfaceEditorServicesBundle["stateService"];
type EditorDocumentService = UISurfaceEditorServicesBundle["documentService"];
type EditorUIService = UISurfaceEditorServicesBundle["uiService"];

function useEditorToolState(stateService: EditorStateService) {
    const [tool, setToolState] = useState<UITool>(() => stateService?.getTool() ?? { kind: "select" });

    useEffect(() => {
        if (!stateService) return;
        setToolState(stateService.getTool());
        const unsubscribe = stateService.on("toolChanged", setToolState);
        return () => unsubscribe();
    }, [stateService]);

    return tool;
}

function useViewportTransform(stateService: EditorStateService) {
    const [viewport, setViewport] = useState<ViewportTransform>(DEFAULT_VIEWPORT);

    useEffect(() => {
        if (!stateService) return;
        setViewport(stateService.getViewportTransform());
        const unsub = stateService.on("viewportChanged", setViewport);
        return unsub;
    }, [stateService]);

    return viewport;
}

function useSurfaceDocument(
    surfaceId: string | undefined,
    stateService: EditorStateService,
    documentService: EditorDocumentService
) {
    const [documentVersion, setDocumentVersion] = useState(0);

    useEffect(() => {
        if (!documentService) return;
        const unsubscribe = documentService.onDocumentChanged(() => {
            setDocumentVersion(version => version + 1);
        });
        return () => unsubscribe();
    }, [documentService]);

    const document = stateService?.getDocument();
    const surface = surfaceId && document ? document.surfaces.find((s: UISurface) => s.id === surfaceId) : undefined;

    return { surface, documentVersion };
}

function useDocumentDirtyIndicator(
    documentService: EditorDocumentService,
    uiService: EditorUIService,
    tabId?: string
) {
    useEffect(() => {
        if (!documentService || !uiService || !tabId) {
            return undefined;
        }
        uiService.editor.setModified(tabId, documentService.isDirty());
        const unsubscribe = documentService.onDirtyChanged((dirty: boolean) => {
            uiService.editor.setModified(tabId, dirty);
        });
        return () => unsubscribe();
    }, [documentService, uiService, tabId]);
}
