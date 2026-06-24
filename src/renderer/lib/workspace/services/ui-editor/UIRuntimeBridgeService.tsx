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
import { SurfaceElementTree } from "../../../ui-editor/runtime/surface/SurfaceElementTree";
import { Service } from "../Service";
import { IUIRuntimeBridgeService, Services, WorkspaceContext } from "../services";
import { UIDocumentService } from "./UIDocumentService";

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
            backgroundColor: surface.settings?.backgroundColor ?? "#ffffff",
            ...options.style,
        };

        return (
            <div
                className={`ui-editor-surface ${options.className ?? ""}`}
                data-ui-surface-id={surface.id}
                data-ui-surface-kind={surface.kind}
                style={surfaceStyle}
            >
                <SurfaceElementTree
                    document={document}
                    surface={surface}
                    rootElement={rootElement}
                    rendererRegistry={this.rendererRegistry}
                    hostAdapter={options.hostAdapter}
                    useAppearanceInspectorPreview
                    editorChrome={options.editorChrome}
                />
            </div>
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
            behavior: root.behavior ? { ...root.behavior } : undefined,
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
            backgroundColor: "transparent",
            ...options.style,
        };

        return (
            <div
                className={`ui-editor-surface ${options.className ?? ""}`}
                data-ui-surface-id={surface.id}
                data-ui-surface-kind={surface.kind}
                style={surfaceStyle}
            >
                <SurfaceElementTree
                    document={virtualDocument}
                    surface={surface}
                    rootElement={rootSnapshot}
                    rendererRegistry={this.rendererRegistry}
                    hostAdapter={options.hostAdapter}
                    useAppearanceInspectorPreview
                    editorChrome={options.editorChrome ?? false}
                />
            </div>
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
