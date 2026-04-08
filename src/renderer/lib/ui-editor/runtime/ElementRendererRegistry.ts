import type { ReactElement, ReactNode } from "react";
import type { UIDocument, UISurface, UIElement } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "./types";

export type ElementRendererProps = {
    element: UIElement;
    surface: UISurface;
    document: UIDocument;
    hostAdapter: UIHostAdapter;
    children?: ReactNode;
    /** Passed by the workspace editor bridge; omitted in Dev Mode and other hosts. */
    useAppearanceInspectorPreview?: boolean;
};

export type ElementRendererDefinition = {
    type: string;
    render: (props: ElementRendererProps) => ReactElement | null;
};

export class ElementRendererRegistry {
    private readonly renderers = new Map<string, ElementRendererDefinition>();

    public constructor(definitions: ElementRendererDefinition[] = []) {
        this.registerMany(definitions);
    }

    public register(definition: ElementRendererDefinition): void {
        this.renderers.set(definition.type, definition);
    }

    public registerMany(definitions: ElementRendererDefinition[]): void {
        for (const definition of definitions) {
            this.register(definition);
        }
    }

    public get(type: string): ElementRendererDefinition | undefined {
        return this.renderers.get(type);
    }

    public list(): ElementRendererDefinition[] {
        return Array.from(this.renderers.values());
    }
}
