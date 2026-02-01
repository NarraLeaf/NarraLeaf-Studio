import { useEffect, useMemo, useRef, useState } from "react";
import { EditorComponentProps } from "../../types";
import { Services } from "@/lib/workspace/services/services";
import { UIRuntimeBridgeService } from "@/lib/workspace/services/ui-editor/UIRuntimeBridgeService";
import { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import { UIEditorInteractionLayer, UILayersPanel } from "@/lib/ui-editor/interaction";
import { useWorkspace } from "@/apps/workspace/context";

type ViewportTransform = {
    scale: number;
    offsetX: number;
    offsetY: number;
};

const DEFAULT_VIEWPORT: ViewportTransform = { scale: 1, offsetX: 0, offsetY: 0 };

export function UISurfaceEditorTab({ payload }: EditorComponentProps<{ surfaceId: string }>) {
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
    }, [runtimeBridge, surfaceId, hostAdapter]);

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
            <div className="w-64 border-r border-white/5 bg-[#080a0e]">
                <div className="px-3 py-2 border-b border-white/10 text-xs uppercase text-gray-500">
                    UI Outline
                </div>
                <div className="h-full">
                    <UILayersPanel surfaceId={surface.id} />
                </div>
            </div>
            <div className="flex-1 relative overflow-hidden bg-[#05060a]">
                <div className="absolute inset-0 overflow-hidden">
                    <div ref={canvasRef} className="relative h-full w-full" style={transformStyle}>
                        {surfaceContent}
                    </div>
                </div>
                <UIEditorInteractionLayer surfaceId={surface.id} containerRef={canvasRef} />
            </div>
        </div>
    );
}
