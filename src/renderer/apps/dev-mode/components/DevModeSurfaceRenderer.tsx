import { useEffect, useState, type CSSProperties } from "react";
import type { UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import type { SurfaceBlueprintBindingContext } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import { SurfaceElementTree } from "@/lib/ui-editor/runtime/surface/SurfaceElementTree";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";

type DevModeSurfaceRendererProps = {
    document: UIDocument;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    hostAdapter: UIHostAdapter;
    blueprintBindingContext?: SurfaceBlueprintBindingContext | null;
    widgetRuntimePatches?: Record<string, DevModeWidgetRuntimePatch>;
};

export function DevModeSurfaceRenderer(props: DevModeSurfaceRendererProps) {
    const { document, surface, rendererRegistry, scale, hostAdapter, blueprintBindingContext, widgetRuntimePatches } =
        props;
    const [, setBindingRenderTick] = useState(0);
    useEffect(() => {
        const store = blueprintBindingContext?.surfaceState;
        if (!store) {
            return undefined;
        }
        return store.subscribe(() => {
            setBindingRenderTick(n => n + 1);
        });
    }, [blueprintBindingContext?.surfaceState]);

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

    const surfaceShellStyle: CSSProperties = {
        position: "relative",
        width: scaledWidth,
        height: scaledHeight,
        overflow: "hidden",
    };

    const surfaceStyle: CSSProperties = {
        position: "relative",
        width: surface.designSize.width,
        height: surface.designSize.height,
        overflow: "hidden",
        backgroundColor: surface.settings?.backgroundColor ?? "#ffffff",
        transform: `scale(${safeScale})`,
        transformOrigin: "top left",
    };

    return (
        <div
            className="ui-editor-surface"
            data-ui-surface-id={surface.id}
            data-ui-surface-kind={surface.kind}
            style={surfaceShellStyle}
        >
            <div style={surfaceStyle}>
                <SurfaceElementTree
                    document={document}
                    surface={surface}
                    rootElement={rootElement}
                    rendererRegistry={rendererRegistry}
                    hostAdapter={hostAdapter}
                    blueprintBindingContext={blueprintBindingContext}
                    widgetRuntimePatches={widgetRuntimePatches}
                />
            </div>
        </div>
    );
}
