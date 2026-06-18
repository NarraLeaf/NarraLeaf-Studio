import type { ReactElement, ReactNode, InputHTMLAttributes } from "react";
import type { UIElement, UIDocument, UISurface } from "@shared/types/ui-editor/document";
import type { UIListItemScope } from "@shared/types/ui-editor/list";
import type { WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { UIHostAdapter } from "../runtime/types";
import type { FieldDefinition, PropertyEditorSchema } from "@/apps/workspace/modules/properties/framework/types";
import type { ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
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
    /** Stable suffix for repeated structural renderers such as list item previews. */
    instanceKey?: string;
    /**
     * Structural widgets may render children lazily with an instance scope.
     * `nl.list` uses this to repeat one authored item template without cloning UIDocument elements.
     */
    renderChildren?: (options?: {
        childrenIds?: string[];
        listItemScope?: UIListItemScope | null;
        instanceKey?: string;
        elementOverrides?: Record<string, UIElement>;
    }) => ReactNode[];
    /**
     * Render another Page surface inside the current element without using an iframe.
     * Runtime hosts may isolate state/lifecycle by frame instance.
     */
    renderSurface?: (options: {
        targetSurfaceId: string | null;
        frameElement: UIElement;
        params?: Record<string, unknown>;
        instanceKey?: string;
    }) => ReactNode;
    /** Runtime state readers exposed to structural widgets that resolve their own data source. */
    runtimeData?: {
        surfaceState?: { get(key: string): unknown };
        globalState?: { get(key: string): unknown };
    };
    /**
     * When true, canvas appearance resolves the variant from the inspector cache (editing-area preview).
     * Dev Mode and other hosts omit this so runtime/blueprint variant overrides stay authoritative.
     */
    useAppearanceInspectorPreview?: boolean;
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

/** Optional element entries for canvas / outline context menus. */
export type WidgetContextMenuContext = {
    element: UIElement;
    documentService: UIDocumentService;
    surfaceId: string;
};

export type FloatingToolbarButton = {
    kind: "button";
    id: string;
    icon?: LucideIcon;
    label?: string;
    tooltip?: string;
    disabled?: boolean;
    onClick: () => void;
};

export type FloatingToolbarItem = FloatingToolbarButton;

export type FloatingToolbarContext = {
    element: UIElement;
    documentService: UIDocumentService;
    surfaceId: string;
    openSurfaceEditor?: (surfaceId: string) => void;
};

export type LayoutSizeFieldContext = {
    element: UIElement;
    documentService: UIDocumentService;
    surfaceId?: string;
    primaryId: string;
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

    /** Shared logic capability schema for editor, runtime, and blueprint tooling. */
    readonly logicApi?: WidgetLogicApi;

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

    /**
     * Extra context menu items when this element is the sole selection (canvas or outline).
     */
    createContextMenuItems?(context: WidgetContextMenuContext): ContextMenuItemDef[];

    /**
     * Returns icon actions rendered as one floating toolbar above the selected element's transform box.
     * Keep actions concise; all modules share the same group renderer.
     */
    createFloatingToolbarItems?(context: FloatingToolbarContext): FloatingToolbarItem[];

    /**
     * Override the common Width / Height row in the layout inspector.
     * Return `undefined` to use the default row, or `null` to hide the row.
     */
    createLayoutSizeField?(context: LayoutSizeFieldContext): FieldDefinition<UIInspectorData> | null | undefined;

    /**
     * Optional hook to register additional blueprint nodes (via `defineBlueprintNode`) when the module loads.
     * Keep side effects idempotent — the host may call this once per session.
     */
    registerBlueprintNodes?(): void;
}
