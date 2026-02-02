import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent } from "react";
import { EditorComponentProps } from "../../types";
import { Services } from "@/lib/workspace/services/services";
import { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import { UIService } from "@/lib/workspace/services/core/UIService";
import { UIEditorInteractionLayer, UILayersPanel } from "@/lib/ui-editor/interaction";
import { useWorkspace } from "@/apps/workspace/context";
import { MousePointer2, Move, SquarePlus, Eye, EyeOff, ChevronUp, ChevronDown } from "lucide-react";
import { elementTypeRegistry } from "@/lib/ui-editor/element-types/registryInstance";
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
    const elementTypes = useMemo(() => elementTypeRegistry.list(), []);
    const [insertType, setInsertType] = useState(elementTypes[0]?.type ?? "");
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
    const handleInsertTool = () => {
        if (!insertType) return;
        applyTool({ kind: "insert", nodeType: insertType });
    };

    const handleInsertTypeChange = (event: ChangeEvent<HTMLSelectElement>) => {
        const nextType = event.target.value;
        setInsertType(nextType);
        if (tool.kind === "insert" && nextType) {
            applyTool({ kind: "insert", nodeType: nextType });
        }
    };

    const toolButtonClass = (active: boolean) =>
        `w-9 h-9 rounded-md border flex items-center justify-center text-xs transition-colors ${
            active
                ? "border-primary bg-primary/20 text-white"
                : "border-white/10 text-gray-400 hover:border-primary hover:text-white hover:bg-white/10"
        } disabled:opacity-50 disabled:cursor-not-allowed`;

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
        if (tool.kind !== "insert" || !surface || elementTypes.length === 0) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        lastContextPoint.current = { x: event.clientX, y: event.clientY };
        const items: ContextMenuDef = elementTypes.map(type => ({
            id: `insert-${type.type}`,
            label: type.displayName,
            onClick: () => {
                const point = lastContextPoint.current;
                if (!point) {
                    return;
                }
                setInsertType(type.type);
                createElementAtClientPoint(type.type, point);
            },
        }));
        setMenuItems(items);
        showMenu(event);
    }, [tool.kind, surface, elementTypes, showMenu, createElementAtClientPoint]);

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

    return (
        <div className="h-full flex overflow-hidden border border-white/10">
            <div className="w-64 border-r border-white/5 bg-[#080a0e] flex flex-col">
                <div className="px-3 py-2 border-b border-white/10 text-xs uppercase text-gray-500 flex items-center justify-between">
                    <span>UI Outline</span>
                    <button
                        type="button"
                        className="text-gray-400 hover:text-white transition-colors"
                        onClick={() => setOutlineCollapsed(value => !value)}
                        title="Toggle outline panel"
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
            <div className="flex-1 relative overflow-hidden bg-[#05060a]" onContextMenu={handleCanvasContextMenu}>
                <div className="absolute top-3 right-3 z-20 flex items-center gap-2 rounded-md border border-white/20 bg-[#05060a]/80 px-2 py-1">
                    <button type="button" className={toolButtonClass(tool.kind === "select")} onClick={handleSelectTool} title="Select tool">
                        <MousePointer2 className="w-4 h-4" />
                    </button>
                    <button type="button" className={toolButtonClass(tool.kind === "pan")} onClick={handlePanTool} title="Pan tool">
                        <Move className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        className={toolButtonClass(tool.kind === "insert")}
                        onClick={handleInsertTool}
                        disabled={!insertType}
                        title="Insert tool"
                    >
                        <SquarePlus className="w-4 h-4" />
                    </button>
                    <button
                        type="button"
                        className={toolButtonClass(outlineVisible)}
                        onClick={() => setOutlineVisible(v => !v)}
                        title="Toggle outlines"
                    >
                        {outlineVisible ? <Eye className="w-4 h-4" /> : <EyeOff className="w-4 h-4" />}
                    </button>
                    <select
                        value={insertType}
                        onChange={handleInsertTypeChange}
                        disabled={elementTypes.length === 0}
                        className="h-9 min-w-[110px] rounded-md border border-white/20 bg-[#0b0d12] px-2 text-xs font-medium text-white outline-none transition-colors focus:border-primary"
                    >
                        {elementTypes.map(type => (
                            <option key={type.type} value={type.type}>
                                {type.displayName}
                            </option>
                        ))}
                    </select>
                </div>
                <div className="absolute inset-0 overflow-hidden">
                    <div ref={canvasRef} className="relative h-full w-full" style={transformStyle}>
                        {surfaceContent}
                    </div>
                </div>
                <UIEditorInteractionLayer
                    surfaceId={surface.id}
                    containerRef={canvasRef}
                    showOutlines={outlineVisible}
                />
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
