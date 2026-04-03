import React from "react";
import type { CSSProperties, ReactNode } from "react";
import {
    type UIDocument,
    type UISurface,
    type UIElement,
    isUIElementFlowLayoutChild,
} from "@shared/types/ui-editor/document";
import { EditorNodeWrapper } from "../../../ui-editor/runtime/EditorNodeWrapper";
import { ElementRendererRegistry, ElementRendererDefinition } from "../../../ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "../../../ui-editor/runtime/builtin";
import type { UIHostAdapter, RenderSurfaceOptions } from "../../../ui-editor/runtime/types";
import { resolveSurfaceRootElementId } from "../../../ui-editor/runtime/resolveSurfaceRoot";
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
                {this.renderElementTree(rootElement, document, surface, options.hostAdapter)}
            </div>
        );
    }

    public registerElementRenderer(definition: ElementRendererDefinition): void {
        this.rendererRegistry.register(definition);
    }

    private renderElementTree(
        element: UIElement,
        document: UIDocument,
        surface: UISurface,
        hostAdapter: UIHostAdapter
    ): React.ReactNode {
        if (element.layout.visible === false) {
            return null;
        }

        const children = element.childrenIds
            .map(childId => {
                const childElement = document.elements[childId];
                if (!childElement) {
                    return null;
                }
                return this.renderElementTree(childElement, document, surface, hostAdapter);
            })
            .filter((node): node is ReactNode => node !== null);

        const renderer = this.rendererRegistry.get(element.type);
        const content = renderer
            ? renderer.render({ element, document, surface, hostAdapter, children })
            : this.renderFallback(element, children);

        const styleOverrides = this.extractStyleOverrides(element);
        const layoutMode =
            element.parentId === null ? "absolute" : isUIElementFlowLayoutChild(document, element) ? "flow" : "absolute";
        return (
            <EditorNodeWrapper
                key={element.id}
                element={element}
                layout={element.layout}
                isRoot={element.parentId === null}
                layoutMode={layoutMode}
                styleOverrides={styleOverrides}
            >
                {content}
            </EditorNodeWrapper>
        );
    }

    private renderFallback(element: UIElement, children: React.ReactNode[]): React.ReactNode {
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

    private extractStyleOverrides(element: UIElement): CSSProperties | undefined {
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

    private ensureDocument(): UIDocument {
        const documentService = this.documentService;
        if (!documentService) {
            throw new Error("UI document service is not initialized");
        }

        return documentService.getDocument();
    }
}
