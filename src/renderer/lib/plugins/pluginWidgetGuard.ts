import { sanitizeContributedWidgetPartSlots } from "@shared/types/ui-editor/contributedWidgets";
import { sanitizeContributedWidgetLogicApi, type WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { scriptEventsOfContributedLogicApi } from "@/lib/ui-editor/blueprint-runtime/script/scriptEventDispatch";
import type { RuntimePluginGame } from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import type { RuntimeWidgetRendererProps } from "@/lib/ui-editor/runtime/plugins/runtimePluginApi";
import { narrowWidgetEventDispatchForPlugin } from "@/lib/ui-editor/runtime/widgetEventDispatch";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { appendWidgetLogicTab } from "@/lib/ui-editor/widget-modules/shared/blueprint/widgetLogicTab";
import type {
    UIInspectorData,
    UIWidgetModule,
    WidgetRendererProps,
} from "@/lib/ui-editor/widget-modules/types";
import type { UIDocumentService } from "@/lib/workspace/services/ui-editor/UIDocumentService";
import type { UIEditorStateService } from "@/lib/workspace/services/ui-editor/UIEditorStateService";
import type {
    PluginWidgetDocumentApi,
    PluginWidgetEditorStateApi,
    PluginWidgetModule,
} from "./pluginWidgetApi";

/**
 * The interface-editor half of {@link import("./pluginWorkspaceGuard")}.
 *
 * A plugin contributes a widget type with `app.services.widgets.register(module)`, and Studio then
 * calls that module back from the canvas, the properties panel, the docker bar, the context menus
 * and the floating toolbar. Every one of those callbacks was handed a *live* service - the
 * `UIDocumentService` and `UIEditorStateService` the workspace itself uses, and on the renderer
 * props the whole `UIHostAdapter`. `Service.getContext()` is public, so
 * `documentService.getContext().services.get(Services.FileSystem)` returned the workspace service
 * registry and with it a file system speaking under the window's default privileged facade:
 * recursive read and write over the author's entire project, authorised as the window rather than as
 * the plugin, with no permission in the manifest saying so. It is the escalation
 * `pluginWorkspaceGuard` closed on `ActionDefinition.onClick`, reached through a different door.
 *
 * **Why a hand-built table and not a wrapper over the service.** Trapping `getContext` alone would
 * not do it. A service is a class instance: `service.constructor` is the class, `Service` extends
 * `Singleton`, and `Singleton.instances` is a plain static property holding every service ever
 * constructed. Any object that keeps that prototype chain hands the registry over however many
 * members are trapped in front of it. So what a plugin gets is a plain object carrying bound
 * methods, with no prototype chain and no route back to the class - the shape
 * `createReadOnlyDocumentService` already established for the comparison inspector.
 *
 * **What it may still do, and why.** A widget's whole job is to draw and edit an element, so the
 * table is the interface document: read it, write this widget's props, layout, animation, extra and
 * list-item wiring, and group a burst of those into one undo step. That is measured from what the
 * built-in widgets do rather than from what the old object happened to expose. Nothing on it reaches
 * outside `uidoc.json`; a plugin that legitimately needs a file still goes through
 * `app.privileged.fs.*`, where the grant check lives.
 *
 * **Unknown members refuse rather than return undefined**, so a plugin written against the old
 * surface fails loudly with a sentence naming the API it should use, instead of silently doing
 * nothing halfway through an edit.
 */

/** Members of the live `UIDocumentService` a plugin widget may call. */
const DOCUMENT_MEMBERS = [
    "getDocument",
    "generateId",
    "getComponent",
    "createElement",
    "updateElementProps",
    "updateElementExtra",
    "updateElementLayout",
    "updateElementAnimation",
    "runSurfaceHistoryTransaction",
    "setListItemStructFields",
    "setElementListItemFieldBinding",
    "ensureElementBlueprintValueBinding",
    "clearElementBlueprintValueBinding",
] as const satisfies readonly (keyof PluginWidgetDocumentApi)[];

/** Members of the live `UIEditorStateService` a plugin widget may call. */
const EDITOR_STATE_MEMBERS = [
    "getSelection",
    "setUIElementSelection",
    "getEnteredState",
    "setEnteredState",
] as const satisfies readonly (keyof PluginWidgetEditorStateApi)[];

/**
 * Both tables name members that must exist on the real services. A rename there would otherwise
 * leave the facade quietly missing a method until a plugin called it.
 */
type _DocumentMembersExist = (typeof DOCUMENT_MEMBERS)[number] extends keyof UIDocumentService ? true : never;
type _EditorStateMembersExist = (typeof EDITOR_STATE_MEMBERS)[number] extends keyof UIEditorStateService ? true : never;
const _documentMembersExist: _DocumentMembersExist = true;
const _editorStateMembersExist: _EditorStateMembersExist = true;
void _documentMembersExist;
void _editorStateMembersExist;

function denialMessage(pluginId: string, kind: string, member: string): string {
    return (
        `Plugin "${pluginId}" called ${kind}.${member}, which widget modules do not get. ` +
        "A widget may read the interface document and write the elements it draws; for anything " +
        "else use the curated app.services.* API, or app.privileged.* for permission-checked file " +
        "system and elevated operations."
    );
}

/**
 * Build the plugin-facing view of one service: bound copies of the members named above, and a
 * refusal for everything else.
 *
 * The proxy target is a fresh plain object, so `getPrototypeOf` leads to `Object.prototype` and
 * `constructor` is `Object` - neither of which leads back to the workspace.
 */
function createServiceFacade<TFacade extends object>(
    pluginId: string,
    kind: string,
    live: object,
    members: readonly string[],
): TFacade {
    const table: Record<string, unknown> = Object.create(null);
    for (const member of members) {
        const value = (live as Record<string, unknown>)[member];
        if (typeof value === "function") {
            table[member] = (value as (...args: unknown[]) => unknown).bind(live);
        }
    }
    return new Proxy(table, {
        get(target, key) {
            if (typeof key !== "string") {
                // Symbols are how the language probes an object - `Symbol.toPrimitive`,
                // `Symbol.iterator`. A thrower there turns a stray coercion into a crash, which is a
                // worse answer than "this object has no such thing".
                return undefined;
            }
            if (key in target) {
                return target[key];
            }
            if (key === "then") {
                // Anything that awaits this object would otherwise call the refusal and reject.
                return undefined;
            }
            return (): never => {
                throw new Error(denialMessage(pluginId, kind, key));
            };
        },
        set(_target, key) {
            throw new Error(denialMessage(pluginId, kind, String(key)));
        },
        getPrototypeOf() {
            return null;
        },
    }) as unknown as TFacade;
}

export function createPluginWidgetDocumentApi(pluginId: string, live: UIDocumentService): PluginWidgetDocumentApi {
    return createServiceFacade<PluginWidgetDocumentApi>(pluginId, "documentService", live, DOCUMENT_MEMBERS);
}

export function createPluginWidgetEditorStateApi(
    pluginId: string,
    live: UIEditorStateService,
): PluginWidgetEditorStateApi {
    return createServiceFacade<PluginWidgetEditorStateApi>(pluginId, "stateService", live, EDITOR_STATE_MEMBERS);
}

/**
 * The props a plugin's `render` is given: exactly what the game hands a plugin widget renderer.
 *
 * No `hostAdapter`, so the editor services and the blueprint host API are simply not there. What is
 * left is the drawing itself - the element, the surface, the document around it, its children and
 * the row it is being drawn in - plus the two optional members the game side already established:
 * `dispatchEvent`, the only route a plugin widget has to the author's graph, bound to this element
 * and this row; and `game`, the same capability-gated object `setup(app)` received.
 *
 * Using the runtime's own props type here is what makes the documented "one render function, two
 * entries" pattern literal rather than merely type-compatible.
 */
export function narrowPluginWidgetRendererProps(
    props: WidgetRendererProps,
    game: RuntimePluginGame,
): RuntimeWidgetRendererProps {
    return {
        element: props.element,
        surface: props.surface,
        document: props.document,
        children: props.children,
        instanceKey: props.instanceKey,
        listItemScope: props.listItemScope ?? null,
        renderChildren: props.renderChildren,
        runtimeData: props.runtimeData,
        // The element tree's own binding - the row and the component placement this element is in -
        // rather than one rebuilt here from the host's runtime: rebuilt, it knew the row and not the
        // placement, so a plugin widget inside a card raised its events on a page with no such
        // element, and they were dropped.
        dispatchEvent: narrowWidgetEventDispatchForPlugin(props.dispatchEvent),
        game,
    };
}

/**
 * The inspector data a plugin widget's property fields read.
 *
 * Handed to the fields by the properties panel rather than by the module, so this is the one part of
 * the surface that registration cannot wrap: the panel builds one data object and every field in the
 * merged schema - Studio's layout rows and the widget's own - reads it. Called from the panel with
 * the inspected element, and a no-op unless that element's type belongs to a plugin.
 */
export function guardInspectorDataForPluginWidget(data: UIInspectorData): UIInspectorData {
    const pluginId = widgetModuleRegistry.getOwner(data.element.type);
    if (!pluginId) {
        return data;
    }
    return {
        ...data,
        documentService: createPluginWidgetDocumentApi(
            pluginId,
            data.documentService,
        ) as unknown as UIDocumentService,
    };
}

/**
 * A plugin widget's declared events, held to the heads a graph can start on for it.
 *
 * What is dropped is said on the console with the plugin and the event named, because the author of
 * the plugin is the only one who can fix it and a dropped event is otherwise just a row that is not
 * in the properties panel. See `sanitizeContributedWidgetLogicApi` for what is dropped and why.
 */
export function sanitizePluginWidgetLogicApi(
    pluginId: string,
    widgetType: string,
    logicApi: WidgetLogicApi | undefined,
): WidgetLogicApi | undefined {
    const result = sanitizeContributedWidgetLogicApi(pluginId, logicApi);
    for (const problem of result.problems) {
        console.warn(
            `[plugin:${pluginId}] widget ${widgetType}, event "${problem.eventId}": ${problem.message}. `
                + "A widget event names the head nodes that start on it in `headNodeTypes`: a built-in "
                + "widget event head, or a node type this plugin registers.",
        );
    }
    return result.logicApi;
}

/** What a plugin widget declares about itself, held to what the host can honour. */
export type PluginWidgetDeclaration = {
    logicApi: WidgetLogicApi | undefined;
    acceptsChildren: boolean;
    partSlots: readonly string[];
};

/**
 * The three declarations every shared capability lookup answers a plugin widget from - its events,
 * and which kind of parent it is - through the same checks wherever a plugin widget is registered.
 *
 * Read by the workspace's registration below and by the interface command line when it is handed a
 * plugin (`ui-cli/plugins.ts`), so the tool and the editor cannot disagree about what a widget
 * holds. What is set aside is said on the console, naming the plugin and the widget, because the
 * plugin's author is the only one who can fix it.
 */
export function sanitizePluginWidgetDeclaration(
    pluginId: string,
    module: Pick<PluginWidgetModule, "type" | "logicApi" | "acceptsChildren" | "partSlots">,
): PluginWidgetDeclaration {
    const logicApi = sanitizePluginWidgetLogicApi(pluginId, module.type, module.logicApi);
    for (const problem of scriptEventsOfContributedLogicApi(logicApi).problems) {
        console.warn(`[plugin:${pluginId}] widget ${module.type}, event "${problem.eventId}": ${problem.message}.`);
    }
    const structure = sanitizeContributedWidgetPartSlots(module.partSlots, module.acceptsChildren === true);
    for (const problem of structure.problems) {
        console.warn(`[plugin:${pluginId}] widget ${module.type}: ${problem.message}.`);
    }
    return { logicApi, acceptsChildren: structure.acceptsChildren, partSlots: structure.partSlots };
}

/**
 * Wrap a plugin's widget module so every callback the host makes into it is handed the narrowed
 * surface.
 *
 * The registry never stores the plugin's own object, only this binding - the same rule the runtime
 * widget loader follows, and for the same reason: the narrowing has to already be in place before
 * anything can reach what the registry holds.
 */
export function guardPluginWidgetModule(
    pluginId: string,
    module: PluginWidgetModule,
    game: RuntimePluginGame,
    services: { documentService: UIDocumentService; stateService: UIEditorStateService },
): UIWidgetModule {
    const doc = (): PluginWidgetDocumentApi => createPluginWidgetDocumentApi(pluginId, services.documentService);
    const state = (): PluginWidgetEditorStateApi =>
        createPluginWidgetEditorStateApi(pluginId, services.stateService);

    // What the registry holds is what the shared lookups answer with (`contributedWidgets.ts`), so
    // the declaration is held to the plugin's own heads here, once, before anything reads it.
    const { logicApi, acceptsChildren, partSlots } = sanitizePluginWidgetDeclaration(pluginId, module);
    const guarded: UIWidgetModule = {
        type: module.type,
        extends: module.extends,
        logicApi,
        acceptsChildren,
        ...(partSlots.length > 0 ? { partSlots } : {}),
        displayName: module.displayName,
        icon: module.icon,
        createDefaultElement: () => module.createDefaultElement(),
        render: props => module.render(narrowPluginWidgetRendererProps(props, game)),
    };

    // Optional members are attached only when the plugin declared them: the host tests for their
    // presence (`mod.createInspector` decides whether an element has fields at all), so a wrapper
    // standing in for a member the plugin never wrote would change what Studio draws.
    if (module.createDefaultChildElements) {
        guarded.createDefaultChildElements = context => module.createDefaultChildElements!(context);
    }
    if (module.listEditorStates) {
        guarded.listEditorStates = element => module.listEditorStates!(element);
    }
    if (module.createInspector || logicApi?.supportsPrivateBlueprint) {
        guarded.createInspector = context => {
            const own = module.createInspector?.({ element: context.element, documentService: doc() }) as unknown as
                ReturnType<NonNullable<UIWidgetModule["createInspector"]>>;
            // The way into the widget's blueprint is a host section no plugin can build; see
            // `appendWidgetLogicTab`. It reads the workspace, never the plugin's facade.
            return logicApi?.supportsPrivateBlueprint ? appendWidgetLogicTab(own, context.element) : own;
        };
    }
    if (module.createDockerBarItems) {
        guarded.createDockerBarItems = context =>
            module.createDockerBarItems!({
                element: context.element,
                documentService: doc(),
                stateService: context.stateService ? state() : undefined,
                surfaceId: context.surfaceId,
            });
    }
    if (module.createMultiSelectDockerBarItems) {
        guarded.createMultiSelectDockerBarItems = context =>
            module.createMultiSelectDockerBarItems!({
                element: context.element,
                documentService: doc(),
                stateService: context.stateService ? state() : undefined,
                surfaceId: context.surfaceId,
            });
    }
    if (module.createContextMenuItems) {
        guarded.createContextMenuItems = context =>
            module.createContextMenuItems!({
                element: context.element,
                documentService: doc(),
                surfaceId: context.surfaceId,
            });
    }
    if (module.createFloatingToolbarItems) {
        guarded.createFloatingToolbarItems = context =>
            module.createFloatingToolbarItems!({
                element: context.element,
                documentService: doc(),
                surfaceId: context.surfaceId,
                openSurfaceEditor: context.openSurfaceEditor,
            });
    }
    if (module.createLayoutSizeField) {
        guarded.createLayoutSizeField = context =>
            module.createLayoutSizeField!({
                element: context.element,
                documentService: doc(),
                surfaceId: context.surfaceId,
                primaryId: context.primaryId,
            }) as unknown as ReturnType<NonNullable<UIWidgetModule["createLayoutSizeField"]>>;
    }
    return guarded;
}
