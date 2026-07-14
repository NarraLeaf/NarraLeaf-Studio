import { useCallback, useEffect, useLayoutEffect, useState, type CSSProperties, type MouseEvent as ReactMouseEvent } from "react";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type {
    NestedSurfaceRuntime,
    SurfaceBlueprintBindingContext,
    SurfaceLifecycleSignals,
} from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { useWidgetRuntimeStateStore } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";

export type GameSurfaceRendererProps = {
    document: UIDocument;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    hostAdapter: UIHostAdapter;
    blueprintBindingContext?: SurfaceBlueprintBindingContext | null;
    widgetRuntimePatches?: Record<string, DevModeWidgetRuntimePatch>;
    getWidgetRuntimePatches?: () => Record<string, DevModeWidgetRuntimePatch> | undefined;
    nestedSurfaceRuntime?: NestedSurfaceRuntime;
    surfaceLifecycleSignals?: SurfaceLifecycleSignals;
    blueprintLifecycleReady?: boolean;
    interactive?: boolean;
    keyboardInteractive?: boolean;
    onRuntimeSubscriptionsReady?: () => void;
    /**
     * When "none", the surface shell/scaler divs are click-through so empty areas do not block
     * whatever renders behind them. Widget elements re-enable pointer events themselves via their
     * node wrappers. Used by the On-Stage slot, whose NLR RootLayout host forces
     * `pointer-events: auto` on all descendants via a universal-selector CSS rule that only an
     * inline style can override.
     */
    surfacePointerEvents?: CSSProperties["pointerEvents"];
};

export function GameSurfaceRenderer(props: GameSurfaceRendererProps) {
    const {
        document,
        surface,
        rendererRegistry,
        scale,
        hostAdapter,
        blueprintBindingContext,
        widgetRuntimePatches,
        getWidgetRuntimePatches,
        nestedSurfaceRuntime,
        surfaceLifecycleSignals,
        blueprintLifecycleReady,
        interactive = true,
        keyboardInteractive = interactive,
        onRuntimeSubscriptionsReady,
        surfacePointerEvents,
    } = props;
    const [, setBindingRenderTick] = useState(0);
    const [, setRuntimePatchRenderTick] = useState(0);
    const widgetRuntimeStore = useWidgetRuntimeStateStore();

    useEffect(() => {
        const store = blueprintBindingContext?.surfaceState;
        if (!store) {
            return undefined;
        }
        return store.subscribe(() => setBindingRenderTick(tick => tick + 1));
    }, [blueprintBindingContext?.surfaceState]);

    useLayoutEffect(() => {
        if (!widgetRuntimeStore) {
            return undefined;
        }
        return widgetRuntimeStore.subscribeRuntimePatches(() => setRuntimePatchRenderTick(tick => tick + 1));
    }, [widgetRuntimeStore]);

    useEffect(() => {
        if (!onRuntimeSubscriptionsReady) {
            return undefined;
        }
        if (typeof requestAnimationFrame !== "function") {
            const timeoutId = setTimeout(onRuntimeSubscriptionsReady, 0);
            return () => clearTimeout(timeoutId);
        }
        const frameId = requestAnimationFrame(() => onRuntimeSubscriptionsReady());
        return () => cancelAnimationFrame(frameId);
    }, [onRuntimeSubscriptionsReady]);

    const rootElementId = resolveSurfaceRootElementId(document, surface.id);
    if (!rootElementId) {
        return null;
    }
    const rootElement = document.elements[rootElementId];
    if (!rootElement) {
        return null;
    }

    const safeScale = Number.isFinite(scale) && scale > 0 ? scale : 1;
    const scaledWidth = surface.designSize.width * safeScale;
    const scaledHeight = surface.designSize.height * safeScale;
    const dispatchSurfaceBlueprintEvent = hostAdapter.blueprintRuntime?.dispatchSurfaceBlueprintEvent;
    const effectiveWidgetRuntimePatches = getWidgetRuntimePatches?.() ?? widgetRuntimePatches;

    const handleSurfaceClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (!interactive || !dispatchSurfaceBlueprintEvent) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const scaleX = rect.width > 0 ? surface.designSize.width / rect.width : 1;
        const scaleY = rect.height > 0 ? surface.designSize.height / rect.height : 1;
        event.stopPropagation();
        void dispatchSurfaceBlueprintEvent("mouseClick", {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        });
    }, [dispatchSurfaceBlueprintEvent, interactive, surface.designSize.height, surface.designSize.width]);

    const handleSurfaceRightClick = useCallback((event: ReactMouseEvent<HTMLDivElement>) => {
        if (!interactive || !dispatchSurfaceBlueprintEvent) {
            return;
        }
        const rect = event.currentTarget.getBoundingClientRect();
        const scaleX = rect.width > 0 ? surface.designSize.width / rect.width : 1;
        const scaleY = rect.height > 0 ? surface.designSize.height / rect.height : 1;
        event.stopPropagation();
        event.preventDefault();
        void dispatchSurfaceBlueprintEvent("rightClick", {
            x: (event.clientX - rect.left) * scaleX,
            y: (event.clientY - rect.top) * scaleY,
        });
    }, [dispatchSurfaceBlueprintEvent, interactive, surface.designSize.height, surface.designSize.width]);

    const shellStyle: CSSProperties = {
        position: "relative",
        width: scaledWidth,
        height: scaledHeight,
        overflow: "hidden",
        ...(surfacePointerEvents ? { pointerEvents: surfacePointerEvents } : {}),
    };
    const surfaceStyle: CSSProperties = {
        position: "relative",
        width: surface.designSize.width,
        height: surface.designSize.height,
        overflow: "hidden",
        backgroundColor: getSurfaceBackgroundColor(surface),
        transform: `scale(${safeScale})`,
        transformOrigin: "top left",
        ...(surfacePointerEvents ? { pointerEvents: surfacePointerEvents } : {}),
    };

    return (
        <div
            className="ui-editor-surface"
            data-ui-surface-id={surface.id}
            data-ui-surface-kind={surface.kind}
            style={shellStyle}
            onClick={interactive ? handleSurfaceClick : undefined}
            onContextMenu={interactive ? handleSurfaceRightClick : undefined}
        >
            <div style={surfaceStyle}>
                <SurfaceElementTree
                    document={document}
                    surface={surface}
                    rootElement={rootElement}
                    rendererRegistry={rendererRegistry}
                    hostAdapter={hostAdapter}
                    blueprintBindingContext={blueprintBindingContext}
                    widgetRuntimePatches={effectiveWidgetRuntimePatches}
                    nestedSurfaceRuntime={nestedSurfaceRuntime}
                    surfaceLifecycleSignals={surfaceLifecycleSignals}
                    blueprintLifecycleReady={blueprintLifecycleReady}
                    interactive={interactive}
                    keyboardInteractive={keyboardInteractive}
                />
            </div>
        </div>
    );
}
