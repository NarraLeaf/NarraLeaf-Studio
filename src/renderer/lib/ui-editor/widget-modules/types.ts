import type { ReactElement, ReactNode, InputHTMLAttributes } from "react";
import type { UIElement, UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "../runtime/types";
import type { PropertyEditorSchema } from "@/apps/workspace/modules/properties/framework/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { LucideIcon } from "lucide-react";

// ─── Element Renderer ───────────────────────────────────────────────────────

/**
 * Props passed to an element renderer
 */
export type WidgetRendererProps = {
    element: UIElement;
    surface: UISurface;
    document: UIDocument;
    hostAdapter: UIHostAdapter;
    children?: ReactNode;
};

// ─── Property Inspector ─────────────────────────────────────────────────────

/**
 * Data object passed to the property inspector schema
 */
export type UIInspectorData = {
    element: UIElement;
    elements: UIElement[];
    /** Document mutations from inspector fields (stable custom components use this instead of per-schema closures). */
    documentService: UIDocumentService;
    /** Set when inspecting a canvas widget; required for Blueprint M2 binding UI. */
    surfaceId?: string;
};

/**
 * Context provided when building the property inspector
 */
export type InspectorContext = {
    element: UIElement;
    documentService: UIDocumentService;
};

// ─── Docker Bar ─────────────────────────────────────────────────────────────

/**
 * Individual docker bar item types
 */
export type DockerBarItem =
    | DockerBarButton
    | DockerBarSelect
    | DockerBarNumberInput
    | DockerBarSeparator;

export type DockerBarButton = {
    kind: "button";
    id: string;
    icon?: LucideIcon;
    label?: string;
    tooltip?: string;
    disabled?: boolean;
    active?: boolean;
    onClick: () => void;
};

export type DockerBarSelect = {
    kind: "select";
    id: string;
    label?: string;
    tooltip?: string;
    value: string | number;
    options: { value: string | number; label: string }[];
    onChange: (value: string | number) => void;
};

export type DockerBarNumberInput = {
    kind: "number";
    id: string;
    label?: string;
    tooltip?: string;
    value: number;
    min?: number;
    max?: number;
    step?: number;
    disabled?: boolean;
    readOnly?: boolean;
    onChange: (value: number) => void;
    placeholder?: string;
    inputProps?: InputHTMLAttributes<HTMLInputElement>;
};

export type DockerBarSeparator = {
    kind: "separator";
    id: string;
};

/**
 * Context provided when building docker bar items for a selected element
 */
export type DockerBarContext = {
    element: UIElement;
    documentService: UIDocumentService;
};

// ─── Widget Module ──────────────────────────────────────────────────────────

/**
 * Unified module interface for defining a UI widget type.
 *
 * A single module declaration controls:
 * - Type metadata and default element creation
 * - Canvas rendering
 * - Property inspector fields
 * - Docker bar items when selected
 * - Docker bar creation button appearance
 */
export interface UIWidgetModule {
    /** Unique type identifier (e.g. "nl.container") */
    readonly type: string;

    /**
     * When true, creating this widget triggers a `widgetMain` instance blueprint (Blueprint M2).
     */
    readonly supportsBlueprintLogic?: boolean;

    /** Human-readable display name */
    readonly displayName: string;

    /** Icon shown in the docker bar's element palette */
    readonly icon: LucideIcon;

    /**
     * Creates the default partial element when the user inserts this widget.
     * The returned object is merged with system defaults (id, parentId, etc.).
     */
    createDefaultElement(): Partial<UIElement>;

    /**
     * Renders the element on the editor canvas.
     */
    render(props: WidgetRendererProps): ReactElement | null;

    /**
     * Returns property inspector fields for the properties panel.
     * These fields are appended after the common layout fields.
     * Return `undefined` to show only layout fields.
     */
    createInspector?(context: InspectorContext): PropertyEditorSchema<UIInspectorData> | undefined;

    /**
     * Returns docker bar items shown when this element is selected.
     * Return `undefined` or empty array for no element-specific docker items.
     */
    createDockerBarItems?(context: DockerBarContext): DockerBarItem[];

    /**
     * Returns docker bar items used when multiple elements of this type are selected.
     * The final multi-select docker bar shows only the items whose `id` exists for every selected module.
     */
    createMultiSelectDockerBarItems?(context: DockerBarContext): DockerBarItem[];
}
