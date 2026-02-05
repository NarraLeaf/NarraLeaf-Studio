import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EditorComponentProps } from "../../types";
import { Services } from "@/lib/workspace/services/services";
import { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { UIEditorInteractionLayer, UILayersPanel } from "@/lib/ui-editor/interaction";
import { UIEditorDockerBar } from "@/lib/ui-editor/docker";
import { useWorkspace } from "@/apps/workspace/context";
import { MousePointer2, Move, ChevronUp, ChevronDown } from "lucide-react";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { UITool } from "@/lib/ui-editor/editor/types";
import { clientToSurface, Rect2D } from "@/lib/ui-editor/geometry";
import { ContextMenu, ContextMenuDef, useContextMenu } from "@/lib/components/elements/ContextMenu";

type ViewportTransform = {
    scale: number;
    offsetX: number;
    offsetY: number;
};

const DEFAULT_VIEWPORT: ViewportTransform = { scale: 1, offsetX: 0, offsetY: 0 };

export function UISurfaceEditorTab({ tabId, payload }: EditorComponentProps<{ surfaceId: string }>) {
    const { context } = useWorkspace();
    const surfaceId = payload?.surfaceId;
    const [viewport, setViewport] = useState<ViewportTransform>(DEFAULT_VIEWPORT);

    const runtimeBridge = useMemo(() => {
        if (!context) return null;
        return context.services.get<UIRuntimeBridgeService>(Services.RuntimeBridge);
    }, [context]);

    const stateService = useMemo(() => {
        if (!context) return null;
        return context.services.get<UIEditorStateService>(Services.UIEditorState);
    }, [context]);
    const documentService = useMemo<UIDocumentService | null>(() => {
        if (!context) return null;
        return context.services.get<UIDocumentService>(Services.UIDocument);
    }, [context]);
    const uiService = useMemo<UIService | null>(() => {
        if (!context) return null;
        return context.services.get<UIService>(Services.UI);
    }, [context]);
    const widgetModules = useMemo(() => widgetModuleRegistry.list(), []);
    const [tool, setToolState] = useState<UITool>(() => stateService?.getTool() ?? { kind: "select" });
    const [documentVersion, setDocumentVersion] = useState(0);
    const [outlineVisible, setOutlineVisible] = useState(true);
    const [outlineCollapsed, setOutlineCollapsed] = useState(false);
    const { menuState, showMenu, hideMenu } = useContextMenu();
    const [menuItems, setMenuItems] = useState<ContextMenuDef>([]);
    const lastContextPoint = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
        if (!stateService) return;
        setToolState(stateService.getTool());
        const unsubscribe = stateService.on("toolChanged", setToolState);
        return () => unsubscribe();
    }, [stateService]);

    useEffect(() => {
        if (!documentService) return;
        const unsubscribe = documentService.onDocumentChanged(() => {
            setDocumentVersion(version => version + 1);
        });
        return () => unsubscribe();
    }, [documentService]);

    const document = stateService?.getDocument();
    const surface = surfaceId && document ? document.surfaces.find(s => s.id === surfaceId) : undefined;

    const canvasRef = useRef<HTMLDivElement | null>(null);
    const viewportRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!stateService) return;
        setViewport(stateService.getViewportTransform());
        const unsub = stateService.on("viewportChanged", setViewport);
        return unsub;
    }, [stateService]);

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

    const applyTool = (nextTool: UITool) => {
        if (!stateService) return;
        stateService.setTool(nextTool);
    };

    const handleSelectTool = () => applyTool({ kind: "select" });
    const handlePanTool = () => applyTool({ kind: "pan" });

    const toolButtonClass = (active: boolean) =>
        `w-9 h-9 rounded-md border flex items-center justify-center text-xs transition-colors ${
            active
                ? "border-primary bg-primary/20 text-white"
                : "border-white/10 text-gray-400 hover:border-primary hover:text-white hover:bg-white/10"
        } disabled:opacity-50 disabled:cursor-not-allowed`;

    const createElementAtCenter = useCallback((type: string) => {
        if (!documentService || !surface || !stateService) {
            return;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
            return;
        }
        // Place element at the center of the current viewport
        const rect = canvas.getBoundingClientRect();
        const containerRect: Rect2D = {
            x: rect.x,
            y: rect.y,
            width: rect.width,
            height: rect.height,
        };
        const centerClient = {
            x: rect.x + rect.width / 2,
            y: rect.y + rect.height / 2,
        };
        const surfacePoint = clientToSurface(centerClient, viewport, containerRect);

        // Look up the module to get default size
        const mod = widgetModuleRegistry.get(type);
        const defaultEl = mod?.createDefaultElement();
        const defaultWidth = defaultEl?.layout?.width ?? 100;
        const defaultHeight = defaultEl?.layout?.height ?? 100;

        const layoutPatch = {
            x: Math.max(0, surfacePoint.x - defaultWidth / 2),
            y: Math.max(0, surfacePoint.y - defaultHeight / 2),
        };
        const element = documentService.createElement(surface.rootElementId, type, layoutPatch);
        stateService.setUIElementSelection({
            editor: "ui",
            surfaceId: surface.id,
            elementIds: [element.id],
            primaryId: element.id,
        });
        stateService.setTool({ kind: "select" });
    }, [documentService, surface, stateService, viewport]);

    const createElementAtClientPoint = useCallback((type: string, point: { x: number; y: number }) => {
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
    }, [documentService, surface, stateService, viewport]);

    const handleCanvasContextMenu = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
        if (!surface || widgetModules.length === 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        lastContextPoint.current = { x: event.clientX, y: event.clientY };
        const items: ContextMenuDef = widgetModules.map(mod => ({
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
    }, [surface, widgetModules, showMenu, createElementAtClientPoint]);

    useEffect(() => {
        if (!documentService || !uiService || !tabId) {
            return undefined;
        }
        uiService.editor.setModified(tabId, documentService.isDirty());
        const unsubscribe = documentService.onDirtyChanged(dirty => {
            uiService.editor.setModified(tabId, dirty);
        });
        return () => unsubscribe();
    }, [documentService, uiService, tabId]);

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

    const outlinePanelClasses = `absolute inset-y-0 left-0 z-10 w-64 border-r border-white/5 bg-[#080a0e] transition-transform duration-200 ease-out ${outlineCollapsed ? "-translate-x-full opacity-0 pointer-events-none" : "translate-x-0 opacity-100 pointer-events-auto"}`;

    return (
        <div className="h-full flex overflow-hidden border border-white/10">
            <div className="relative flex-1 bg-[#05060a]" onContextMenu={handleCanvasContextMenu}>
                {/* Outline panel */}
                <div className={outlinePanelClasses}>
                    <div className="px-3 py-2 border-b border-white/10 text-xs uppercase text-gray-500 flex items-center justify-between">
                        <span>UI Outline</span>
                        <button
                            type="button"
                            className="text-gray-400 hover:text-white transition-colors"
                            onClick={() => setOutlineCollapsed(value => !value)}
                            title={outlineCollapsed ? "Expand outline panel" : "Collapse outline panel"}
                        >
                            {outlineCollapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                        </button>
                    </div>
                    {!outlineCollapsed && (
                        <div className="h-full">
                            <UILayersPanel surfaceId={surface.id} />
                        </div>
                    )}
                </div>
                {outlineCollapsed && (
                    <button
                        type="button"
                        className="absolute left-3 top-3 z-20 h-10 w-10 flex items-center justify-center rounded-full border border-white/20 bg-[#05060a]/80 text-gray-300 hover:text-white focus:outline-none"
                        onClick={() => setOutlineCollapsed(false)}
                        title="Expand outline panel"
                    >
                        <ChevronDown className="w-4 h-4" />
                    </button>
                )}

                {/* Top toolbar */}
                <div className="absolute top-3 right-3 z-20 flex items-center gap-2 rounded-md border border-white/20 bg-[#05060a]/80 px-2 py-1">
                    <button type="button" className={toolButtonClass(tool.kind === "select")} onClick={handleSelectTool} title="Select tool">
                        <MousePointer2 className="w-4 h-4" />
                    </button>
                    <button type="button" className={toolButtonClass(tool.kind === "pan")} onClick={handlePanTool} title="Pan tool">
                        <Move className="w-4 h-4" />
                    </button>
                </div>

                {/* Viewport / Canvas */}
                <div ref={viewportRef} className="absolute inset-0 overflow-hidden">
                    <div ref={canvasRef} className="relative h-full w-full" style={transformStyle}>
                        {surfaceContent}
                    </div>
                </div>

                {/* Interaction layer */}
                <UIEditorInteractionLayer
                    surfaceId={surface.id}
                    containerRef={viewportRef}
                    showOutlines={outlineVisible}
                />

                {/* Docker bar */}
                {stateService && documentService && (
                    <UIEditorDockerBar
                        surfaceId={surface.id}
                        stateService={stateService}
                        documentService={documentService}
                        onInsertElement={createElementAtCenter}
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
