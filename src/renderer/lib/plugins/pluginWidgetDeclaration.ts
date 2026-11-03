import { sanitizeContributedWidgetPartSlots } from "@shared/types/ui-editor/contributedWidgets";
import { sanitizeContributedWidgetLogicApi, type WidgetLogicApi } from "@shared/types/ui-editor/widgetLogic";
import { scriptEventsOfContributedLogicApi } from "@/lib/ui-editor/blueprint-runtime/script/scriptEventDispatch";
import type { PluginWidgetModule } from "./pluginWidgetApi";

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
