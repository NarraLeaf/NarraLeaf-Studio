import React from "react";
import type { CSSProperties } from "react";
import { type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { ElementRendererRegistry, ElementRendererDefinition } from "../../../ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "../../../ui-editor/runtime/builtin";
import type {
    UIHostAdapter,
    RenderComponentOptions,
    RenderDocumentSurfaceOptions,
    RenderSurfaceOptions,
} from "../../../ui-editor/runtime/types";
import { resolveSurfaceRootElementId } from "../../../ui-editor/runtime/resolveSurfaceRoot";
import { SurfaceBackgroundImageLayer } from "../../../ui-editor/runtime/surface/SurfaceBackgroundImageLayer";
import { SurfaceElementTree } from "../../../ui-editor/runtime/surface/SurfaceElementTree";
import { getSurfaceBackgroundColor } from "../../../ui-editor/runtime/surfaceBackground";
import { useBrandPaletteRevision } from "../../../ui-editor/runtime/useBrandPaletteRevision";
import { usePluginElementRenderers } from "../../../ui-editor/widget-modules/pluginElementRenderers";
import { Service } from "../Service";
import { IUIRuntimeBridgeService, Services, WorkspaceContext } from "../services";
import { UIDocumentService } from "./UIDocumentService";

/**
 * The canvas frame, and the surface fill painted on it.
 *
 * A component rather than a plain `<div>` in `renderSurface` because that is a service method, not
 * a React render: the element it returns is built once by whoever called it, so the fill it carries
 * only changes when that caller happens to re-render. With a `nlbrand:` background that is the
 * difference between "the canvas follows the palette" and "the canvas follows it the next time you
 * switch tabs". Subscribing here fixes every caller of `renderSurface` at once, the editing canvas
 * and the panel thumbnails alike.
 *
 * The plugin widget types are the second thing that moves under a drawing that was already built,
 * and for the same reason: an author can switch a plugin on or off with a page open, and the
 * plugins finish loading after a restored page has already drawn once. Both subscriptions belong to
 * the frame rather than to the service, because a service has no way to make React draw again.
 *
 * The element tree arrives as a callback rather than as `children`, and that is load-bearing: an
 * element built by the service before the frame renders is referentially the same element on the
 * frame's next render, so React bails out of the subtree and the redraw reaches the frame's own div
 * and nothing else. Built here, the tree is a new element each time and the redraw lands on it.
 */
function BrandedSurfaceFrame({
    surface,
    className,
    style,
    backgroundColor,
    rendererRegistry,
    renderContent,
}: {
    surface: UISurface;
    className: string;
    style: CSSProperties;
    /** Overrides the surface's own fill; the component preview draws on nothing. */
    backgroundColor?: string;
    rendererRegistry: ElementRendererRegistry;
    renderContent: () => React.ReactNode;
}): React.ReactElement {
    useBrandPaletteRevision();
    usePluginElementRenderers(rendererRegistry);
    return (
        <div
            className={className}
            data-ui-surface-id={surface.id}
            data-ui-surface-kind={surface.kind}
            style={{ ...style, backgroundColor: backgroundColor ?? getSurfaceBackgroundColor(surface) }}
        >
            {renderContent()}
        </div>
    );
}

export class UIRuntimeBridgeService extends Service<UIRuntimeBridgeService> implements IUIRuntimeBridgeService {
    private readonly rendererRegistry = new ElementRendererRegistry(BuiltinElementRenderers);
    private documentService: UIDocumentService | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const uidocumentService = ctx.services.get<UIDocumentService>(Services.UIDocument);
        await depend([uidocumentService]);
        this.documentService = uidocumentService;
    }

    public renderSurface(options: RenderSurfaceOptions): React.ReactElement | null {
        const document = this.ensureDocument();
        return this.renderDocumentSurface({ ...options, document });
    }

    public renderDocumentSurface(options: RenderDocumentSurfaceOptions): React.ReactElement | null {
        const { document } = options;
        const surface = document.surfaces.find(surf => surf.id === options.surfaceId);
        if (!surface) {
            return null;
        }

        const rootElementId = resolveSurfaceRootElementId(document, surface.id);
        if (!rootElementId) {
            return null;
        }
        const rootElement = document.elements[rootElementId];
        if (!rootElement) {
            return null;
        }

        const surfaceStyle: CSSProperties = {
            position: "relative",
            width: surface.designSize.width,
            height: surface.designSize.height,
            overflow: "hidden",
            ...options.style,
        };

        return (
            <BrandedSurfaceFrame
                surface={surface}
                className={`ui-editor-surface ${options.className ?? ""}`}
                style={surfaceStyle}
                rendererRegistry={this.rendererRegistry}
                renderContent={() => (
                    <>
                        <SurfaceBackgroundImageLayer surface={surface} />
                        <SurfaceElementTree
                            document={document}
                            surface={surface}
                            rootElement={rootElement}
                            rendererRegistry={this.rendererRegistry}
                            hostAdapter={options.hostAdapter}
                            useAppearanceInspectorPreview
                            editorChrome={options.editorChrome}
                        />
                    </>
                )}
            />
        );
    }

    public renderComponent(options: RenderComponentOptions): React.ReactElement | null {
        const document = this.ensureDocument();
        const component = (document.components ?? []).find(item => item.id === options.componentId);
        if (!component) {
            return null;
        }
        const root = component.elements[component.rootElementId];
        if (!root) {
            return null;
        }

        const rootWidth = Math.max(1, Math.abs(root.layout.width));
        const rootHeight = Math.max(1, Math.abs(root.layout.height));
        const surface: UISurface = {
            id: `component:${component.id}`,
            name: component.name,
            host: "app",
            kind: "appSurface",
            designSize: { width: rootWidth, height: rootHeight },
            rootElementId: root.id,
        };
        const rootSnapshot: UIElement = {
            ...root,
            parentId: null,
            childrenIds: [...root.childrenIds],
            layout: {
                ...root.layout,
                x: 0,
                y: 0,
            },
            props: root.props ? { ...root.props } : undefined,
            style: root.style ? { ...root.style } : undefined,
            valueBindings: root.valueBindings ? { ...root.valueBindings } : undefined,
            extra: root.extra ? { ...root.extra } : undefined,
        };
        const virtualDocument: UIDocument = {
            ...document,
            surfaces: [surface],
            elements: {
                ...document.elements,
                ...component.elements,
                [root.id]: rootSnapshot,
            },
        };
        const surfaceStyle: CSSProperties = {
            position: "relative",
            width: rootWidth,
            height: rootHeight,
            overflow: "hidden",
            ...options.style,
        };

        return (
            <BrandedSurfaceFrame
                surface={surface}
                className={`ui-editor-surface ${options.className ?? ""}`}
                style={surfaceStyle}
                backgroundColor="transparent"
                rendererRegistry={this.rendererRegistry}
                renderContent={() => (
                    <SurfaceElementTree
                        document={virtualDocument}
                        surface={surface}
                        rootElement={rootSnapshot}
                        rendererRegistry={this.rendererRegistry}
                        hostAdapter={options.hostAdapter}
                        useAppearanceInspectorPreview
                        editorChrome={options.editorChrome ?? false}
                    />
                )}
            />
        );
    }

    public registerElementRenderer(definition: ElementRendererDefinition): void {
        this.rendererRegistry.register(definition);
    }

    private ensureDocument(): UIDocument {
        const documentService = this.documentService;
        if (!documentService) {
            throw new Error("UI document service is not initialized");
        }

        return documentService.getDocument();
    }
}
