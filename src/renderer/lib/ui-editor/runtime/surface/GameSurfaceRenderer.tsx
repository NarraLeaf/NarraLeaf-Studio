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
import { SurfaceBackgroundImageLayer } from "@/lib/ui-editor/runtime/surface/SurfaceBackgroundImageLayer";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { SurfacePassiveContext } from "@/lib/ui-editor/runtime/surface/SurfacePassiveContext";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { getSurfaceBackgroundColor } from "@/lib/ui-editor/runtime/surfaceBackground";
import { getSurfaceAnimationPlan } from "@/lib/ui-editor/runtime/surfaceAnimationPlan";
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
    /**
     * The surface is display-only: no widget inside it takes pointer events. Distinct from
     * `surfacePointerEvents`, which only makes the shell click-through and is defeated by the first
     * full-size container. See {@link SurfacePassiveContext}.
     */
    passive?: boolean;
    /**
     * Background the design-size layer paints, overriding the surface's authored colour.
     *
     * The app surface stack resolves the colour itself (an in-game overlay thins it, see
     * `getSurfaceLayerBackgroundColor`) and paints it on the animation layer. Repainting the authored
     * colour here would put an opaque sheet back over it one level down.
     */
    backgroundColor?: string;
    /**
     * Thins the Surface's background picture, for a page presented over a running game.
     *
     * Unlike `backgroundColor` this is a factor rather than a replacement: the picture is the
     * author's, and the presentation only decides how much of the scene behind it shows through.
     */
    backgroundImageOpacity?: number;
    /**
     * Passed straight through to {@link SurfaceElementTree}: the caller promises this `document` is a
     * snapshot nothing mutates in place, which is what lets the element tree be memoised. Both
     * runtime hosts (the app surface stack and the stage slots) render out of a compiled bundle and
     * do promise it; anything rendering over a live editor document must leave it unset.
     */
    staticDocument?: boolean;
    /**
     * Let the elements on this Surface play their own enter/exit animations.
     *
     * Off by default: the same renderer draws Surface previews and the editing canvas, and a widget
     * that animates itself in every time the author nudges it is unusable. Runtime hosts turn it on.
     * Requires `staticDocument` for the same reason the element tree's memo does - the timings are
     * cached against the element table's identity.
     */
    elementAnimations?: boolean;
    /** The player asked for less motion: no element animates, whatever the document says. */
    reducedMotion?: boolean;
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
        passive = false,
        backgroundColor,
        backgroundImageOpacity,
        staticDocument,
        elementAnimations = false,
        reducedMotion = false,
    } = props;
    // Kept as values, not write-only tick setters: the element tree is memoised on its inputs, and
    // "a store I subscribed to fired" is an input that does not show up in any prop.
    const [bindingRenderTick, setBindingRenderTick] = useState(0);
    const [runtimePatchRenderTick, setRuntimePatchRenderTick] = useState(0);
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

    const animationPlan =
        elementAnimations && !reducedMotion
            ? getSurfaceAnimationPlan({
                  elements: document.elements,
                  rootElementId,
                  rootSettings: surface.settings?.pageAnimation ?? null,
                  cache: staticDocument === true,
              })
            : null;

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
        backgroundColor: backgroundColor ?? getSurfaceBackgroundColor(surface),
        transform: `scale(${safeScale})`,
        transformOrigin: "top left",
        ...(surfacePointerEvents ? { pointerEvents: surfacePointerEvents } : {}),
    };

    return (
        <SurfacePassiveContext.Provider value={passive}>
        <div
            className="ui-editor-surface"
            data-ui-surface-id={surface.id}
            data-ui-surface-kind={surface.kind}
            style={shellStyle}
            onClick={interactive ? handleSurfaceClick : undefined}
            onContextMenu={interactive ? handleSurfaceRightClick : undefined}
        >
            <div style={surfaceStyle}>
                <SurfaceBackgroundImageLayer surface={surface} opacity={backgroundImageOpacity} />
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
                    staticDocument={staticDocument}
                    animationPlan={animationPlan}
                    hostRenderTick={bindingRenderTick + runtimePatchRenderTick}
                />
            </div>
        </div>
        </SurfacePassiveContext.Provider>
    );
}
