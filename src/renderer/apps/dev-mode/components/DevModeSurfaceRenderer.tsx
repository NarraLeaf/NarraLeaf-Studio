import type { CSSProperties, ReactNode } from "react";
import type { UIDocument, UISurface, UIElement } from "@shared/types/ui-editor/document";
import type { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { EditorNodeWrapper } from "@/lib/ui-editor/runtime/EditorNodeWrapper";
import { resolveSurfaceRootElementId } from "@/lib/ui-editor/runtime/resolveSurfaceRoot";

type DevModeSurfaceRendererProps = {
    document: UIDocument;
    surface: UISurface;
    rendererRegistry: ElementRendererRegistry;
    scale: number;
};

export function DevModeSurfaceRenderer(props: DevModeSurfaceRendererProps) {
    const { document, surface, rendererRegistry, scale } = props;
    const rootElementId = resolveSurfaceRootElementId(document, surface.id);
    if (!rootElementId) {
        return null;
    }

    const rootElement = document.elements[rootElementId];
    if (!rootElement) {
        return null;
    }

    const hostAdapter: UIHostAdapter = {
        host: surface.host,
        effects: {
            runEffect: () => {},
        },
    };

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
                {renderElementTree(rootElement, document, surface, hostAdapter, rendererRegistry)}
            </div>
        </div>
    );
}

function renderElementTree(
    element: UIElement,
    document: UIDocument,
    surface: UISurface,
    hostAdapter: UIHostAdapter,
    rendererRegistry: ElementRendererRegistry,
): ReactNode {
    if (element.layout.visible === false) {
        return null;
    }

    const children = element.childrenIds
        .map(childId => {
            const childElement = document.elements[childId];
            if (!childElement) {
                return null;
            }
            return renderElementTree(childElement, document, surface, hostAdapter, rendererRegistry);
        })
        .filter((node): node is ReactNode => node !== null);

    const renderer = rendererRegistry.get(element.type);
    const content = renderer
        ? renderer.render({ element, document, surface, hostAdapter, children })
        : renderFallback(element, children);

    const styleOverrides = extractStyleOverrides(element);
    return (
        <EditorNodeWrapper
            key={element.id}
            element={element}
            layout={element.layout}
            isRoot={element.parentId === null}
            styleOverrides={styleOverrides}
        >
            {content}
        </EditorNodeWrapper>
    );
}

function renderFallback(element: UIElement, children: ReactNode[]): ReactNode {
    if (children.length > 0) {
        return <>{children}</>;
    }
    const label = element.name ?? element.type;
    return (
        <div className="flex items-center justify-center w-full h-full text-[11px] text-white/60 border border-dashed border-white/40">
            {label}
        </div>
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
