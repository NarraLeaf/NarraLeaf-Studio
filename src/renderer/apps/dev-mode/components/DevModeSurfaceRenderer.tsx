import type { CSSProperties, ReactNode } from "react";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { type UIDocument, type UISurface, type UIElement, isUIElementFlowLayoutChild } from "@shared/types/ui-editor/document";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";
import { mergeElementWithBlueprintBindings } from "@/lib/ui-editor/blueprint-runtime/BindingEvaluator";
import type { SurfaceStateStore } from "@/lib/ui-editor/blueprint-runtime/SurfaceStateStore";
import type { DebugBridge } from "@/lib/ui-editor/blueprint-runtime/DebugBridge";
import type { BindingDebugCoalescer } from "@/lib/ui-editor/blueprint-runtime/BindingDebugCoalescer";
import type { DevModeWidgetRuntimePatch } from "@/lib/ui-editor/blueprint-runtime/BlueprintHostApiBridge";
import { renderUnknownWidgetTypeContent } from "@/lib/ui-editor/runtime/unknownWidgetTypeUi";

type DevModeSurfaceRendererProps = {
    document: UIDocument;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
    hostAdapter: UIHostAdapter;
    /** When set, widgetProp bindings are evaluated against surface runtime state. */
    blueprintBindingContext?: {
        blueprintDocument: BlueprintDocument;
        surfaceState: SurfaceStateStore;
        debug: DebugBridge;
        coalescer: BindingDebugCoalescer;
    } | null;
    /** Runtime-only widget patches from Host API (M3-full); not persisted. */
    widgetRuntimePatches?: Record<string, DevModeWidgetRuntimePatch>;
};

export function DevModeSurfaceRenderer(props: DevModeSurfaceRendererProps) {
    const { document, surface, rendererRegistry, scale, hostAdapter, blueprintBindingContext, widgetRuntimePatches } =
        props;
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
                {renderElementTree(
                    rootElement,
                    document,
                    surface,
                    hostAdapter,
                    rendererRegistry,
                    blueprintBindingContext,
                    widgetRuntimePatches,
                )}
            </div>
        </div>
    );
}

function applyWidgetRuntimePatches(element: UIElement, patches: Record<string, DevModeWidgetRuntimePatch>): UIElement {
    const patch = patches[element.id];
    if (!patch) {
        return element;
    }
    const next: UIElement = {
        ...element,
        layout: { ...element.layout },
        props: { ...(element.props ?? {}) },
    };
    if (patch.visible !== undefined) {
        next.layout.visible = patch.visible;
    }
    if (patch.enabled !== undefined) {
        (next.props as Record<string, unknown>).interactionDisabled = !patch.enabled;
    }
    return next;
}

function renderElementTree(
    element: UIElement,
    document: UIDocument,
    surface: UISurface,
    hostAdapter: UIHostAdapter,
    rendererRegistry: ElementRendererRegistry,
    blueprintBindingContext: DevModeSurfaceRendererProps["blueprintBindingContext"],
    widgetRuntimePatches?: Record<string, DevModeWidgetRuntimePatch>,
): ReactNode {
    const patched = applyWidgetRuntimePatches(element, widgetRuntimePatches ?? {});
    const resolved =
        blueprintBindingContext != null
            ? mergeElementWithBlueprintBindings(
                  patched,
                  surface.id,
                  blueprintBindingContext.blueprintDocument,
                  blueprintBindingContext.surfaceState,
                  e => blueprintBindingContext.debug.emit(e),
                  blueprintBindingContext.coalescer,
              )
            : patched;

    if (resolved.layout.visible === false) {
        return null;
    }

    const children = resolved.childrenIds
        .map(childId => {
            const childElement = document.elements[childId];
            if (!childElement) {
                return null;
            }
            return renderElementTree(
                childElement,
                document,
                surface,
                hostAdapter,
                rendererRegistry,
                blueprintBindingContext,
                widgetRuntimePatches,
            );
        })
        .filter((node): node is ReactNode => node !== null);

    const renderer = rendererRegistry.get(resolved.type);
    const content = renderer
        ? renderer.render({ element: resolved, document, surface, hostAdapter, children })
        : renderUnknownWidgetTypeContent(resolved, children);

    const styleOverrides = extractStyleOverrides(resolved);
    const layoutMode =
        resolved.parentId === null
            ? "absolute"
            : isUIElementFlowLayoutChild(document, resolved)
              ? "flow"
              : "absolute";
    return (
        <EditorNodeWrapper
            key={resolved.id}
            element={resolved}
            layout={resolved.layout}
            isRoot={resolved.parentId === null}
            layoutMode={layoutMode}
            styleOverrides={styleOverrides}
        >
            {content}
        </EditorNodeWrapper>
    );
}

function extractStyleOverrides(element: UIElement): CSSProperties | undefined {
    const style = element.style;
    if (!style) {
        return undefined;
    }
    const overrides: CSSProperties = {};
    for (const [key, value] of Object.entries(style)) {
        if (typeof value === "number" || typeof value === "string") {
            (overrides as Record<string, string | number>)[key] = value;
        }
    }
    return Object.keys(overrides).length > 0 ? overrides : undefined;
}
