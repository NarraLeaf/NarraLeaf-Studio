import type { ReactElement } from "react";
import type {
    UIDocument,
    UIElement,
    UIComponentDefinition,
    UIElementValueBindingValueType,
    UILayout,
} from "@shared/types/ui-editor/document";
import type { UIPageAnimationSettings } from "@shared/types/ui-editor/pageAnimation";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIStructField } from "@shared/types/ui-editor/struct";
import type { WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import type { LucideIcon } from "lucide-react";
import type { ContextMenuItemDef } from "@/lib/components/elements/ContextMenu";
import type {
    DefaultChildElementContext,
    DefaultChildElementResult,
    DockerBarItem,
    FloatingToolbarItem,
} from "@/lib/ui-editor/widget-modules/types";
import type { RuntimeWidgetRendererProps } from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import type { FieldDefinition, PropertyEditorSchema } from "@/apps/workspace/modules/properties/framework/types";
import type { SelectionState } from "@/lib/workspace/services/ui/UIStore";

/**
 * The interface-editor extension surface a plugin actually gets.
 *
 * Studio's own widgets are described by `UIWidgetModule`, whose callbacks are handed the live
 * `UIDocumentService` and `UIEditorStateService`. Those are `Service` instances, and `getContext()`
 * on a service is public - so `documentService.getContext().services.get(...)` returns the workspace
 * service registry, and with it a `FileSystemService` that speaks to the main process under the
 * window's default privileged facade: recursive read and write over the author's whole project,
 * authorised as the window rather than as the plugin. That is the same escalation
 * `pluginWorkspaceGuard` closed on `ActionDefinition.onClick`, reached through the widget door.
 *
 * A class instance cannot be made safe by wrapping one method, either: `service.constructor` is the
 * real class, `Service` extends `Singleton`, and `Singleton.instances` is an ordinary static
 * property holding every service that has ever been constructed. Anything with that prototype chain
 * hands over the registry however many members are trapped on the way past.
 *
 * So the types below are what a widget is handed instead - plain objects with named methods,
 * built by `pluginWidgetGuard` and enforced there rather than here. **These declarations state the
 * contract; they do not impose it.** A plugin ships compiled JavaScript and can cast anything to
 * anything; the guard is what makes the cast find nothing.
 *
 * The surface is derived from what the built-in widgets do, which is the only honest measure of what
 * a widget needs: read the interface document, write the element's own props, layout, animation,
 * extra and list-item wiring, group a burst of those into one undo step, and move the selection.
 * Nothing here reaches outside `uidoc.json`.
 */

/**
 * Interface-document access for a plugin widget.
 *
 * Whole-document reads are deliberate: a structural widget cannot resolve its own parts without
 * looking them up, which is why the game side hands plugin renderers the document too. The document
 * is authored content the editor is already drawing, not a host power - and it is one document, not
 * an index that leads to unrelated resources.
 *
 * Writes are element-scoped by signature. They are not restricted to the element being inspected: a
 * widget with parts edits its parts, exactly as the built-in switch and list do, and there is no
 * honest way to tell "my part" from "someone else's element" from here.
 */
export type PluginWidgetDocumentApi = {
    /** The whole interface document, as the editor currently holds it. */
    getDocument(): UIDocument;
    /** A fresh element id, for a widget that builds child elements of its own. */
    generateId(): string;
    /** One component definition by id, for a widget that draws a linked component instance. */
    getComponent(componentId: string): UIComponentDefinition | undefined;
    createElement(parentId: string, type: string, layoutPatch?: Partial<UILayout>): UIElement;
    updateElementProps(elementId: string, propsPatch: Record<string, unknown>): void;
    updateElementExtra(elementId: string, extraPatch: Record<string, unknown>): void;
    updateElementLayout(
        elementId: string,
        layoutPatch: Partial<UILayout>,
        options?: { skipHistory?: boolean },
    ): void;
    updateElementAnimation(
        elementId: string,
        animation: UIPageAnimationSettings | null,
        options?: { mergeKey?: string },
    ): void;
    /** Collapse everything the callback writes into one undo entry on that surface. */
    runSurfaceHistoryTransaction(surfaceId: string, action: () => void): void;
    setListItemStructFields(elementId: string, fields: readonly UIStructField[]): void;
    setElementListItemFieldBinding(elementId: string, propPath: string, fieldId: string | null): void;
    ensureElementBlueprintValueBinding(
        elementId: string,
        propPath: string,
        input: { valueType: UIElementValueBindingValueType; displayName?: string; literalValue?: unknown },
    ): { blueprintId: string };
    clearElementBlueprintValueBinding(elementId: string, propPath: string): void;
};

/**
 * Editor state a plugin widget's docker bar may read and move.
 *
 * Selection only. The interaction overrides (inline text edit, image crop) are not here because the
 * host honours them in built-in renderers alone - offering a plugin a switch that turns nothing on
 * would be worse than not having it.
 */
export type PluginWidgetEditorStateApi = {
    getSelection(): SelectionState;
    setUIElementSelection(selection: UIElementSelection): void;
    getEnteredState(): { surfaceId: string; elementId: string; variantId: string | null } | null;
    setEnteredState(next: { surfaceId: string; elementId: string; variantId: string | null } | null): void;
};

/** What a plugin widget's property fields read and write through. */
export type PluginWidgetInspectorData = {
    element: UIElement;
    elements: UIElement[];
    documentService: PluginWidgetDocumentApi;
    surfaceId?: string;
};

export type PluginWidgetInspectorContext = {
    element: UIElement;
    documentService: PluginWidgetDocumentApi;
};

export type PluginWidgetDockerBarContext = {
    element: UIElement;
    documentService: PluginWidgetDocumentApi;
    stateService?: PluginWidgetEditorStateApi;
    surfaceId?: string;
};

export type PluginWidgetContextMenuContext = {
    element: UIElement;
    documentService: PluginWidgetDocumentApi;
    surfaceId: string;
};

export type PluginWidgetFloatingToolbarContext = {
    element: UIElement;
    documentService: PluginWidgetDocumentApi;
    surfaceId: string;
    openSurfaceEditor?: (surfaceId: string) => void;
};

export type PluginWidgetLayoutSizeFieldContext = {
    element: UIElement;
    documentService: PluginWidgetDocumentApi;
    surfaceId?: string;
    primaryId: string;
};

/**
 * A widget type contributed by a plugin.
 *
 * `render` takes the same {@link RuntimeWidgetRendererProps} the game hands a plugin renderer,
 * rather than the editor's wider props: one render function, drawn the same way in both places, and
 * no `hostAdapter` on either side. See `create-plugin.md` for the shared-module pattern that relies
 * on it.
 *
 * `registerBlueprintNodes` is absent on purpose. It exists on the built-in module type and the host
 * only ever calls it for built-ins; a plugin registers nodes through `app.services.blueprintNodes`,
 * where the execute context is narrowed the same way this is.
 */
export type PluginWidgetModule = {
    /** Unique type id; must start with the plugin id and be declared in `contributes.widgets`. */
    readonly type: string;
    /** Widget type this one specialises. */
    readonly extends?: string;
    /** Event and effect capabilities, shared with the blueprint tooling. */
    readonly logicApi?: WidgetLogicApi;
    readonly displayName: string;
    readonly icon: LucideIcon;
    createDefaultElement(): Partial<UIElement>;
    createDefaultChildElements?(context: DefaultChildElementContext): DefaultChildElementResult;
    listEditorStates?(element: UIElement): { id: string | null; name: string }[];
    render(props: RuntimeWidgetRendererProps): ReactElement | null;
    createInspector?(
        context: PluginWidgetInspectorContext,
    ): PropertyEditorSchema<PluginWidgetInspectorData> | undefined;
    createDockerBarItems?(context: PluginWidgetDockerBarContext): DockerBarItem[];
    createMultiSelectDockerBarItems?(context: PluginWidgetDockerBarContext): DockerBarItem[];
    createContextMenuItems?(context: PluginWidgetContextMenuContext): ContextMenuItemDef[];
    createFloatingToolbarItems?(context: PluginWidgetFloatingToolbarContext): FloatingToolbarItem[];
    createLayoutSizeField?(
        context: PluginWidgetLayoutSizeFieldContext,
    ): FieldDefinition<PluginWidgetInspectorData> | null | undefined;
};
