import type { ActionDefinition, ActionGroup, ActionMenuItem, ActionSeparator, PanelDefinition } from "@/apps/workspace/registry/types";
import { Workspace } from "@/lib/workspace/workspace";
import type { ServiceRegistry } from "@/lib/workspace/services/serviceRegistry";
import type { Services, WorkspaceContext } from "@/lib/workspace/services/services";

/**
 * A plugin registers actions and rail buttons through the same {@link ActionDefinition} /
 * {@link PanelDefinition} types Studio's own surfaces use, and the workspace hands those callbacks
 * the *live* {@link Workspace} / {@link WorkspaceContext} when they fire. That object's
 * `services.get(...)` returns the workspace service registry, and several of those services
 * (`FileSystem`, `Project`, `Assets`, …) speak to the main process through the window's **default**
 * privileged facade - recursive read and write over the whole project tree, authorised as the
 * window rather than as the plugin.
 *
 * That is precisely the power the plugin permission prompt says a plugin does not get. The curated
 * `app.services.*` surface is a deliberate whitelist that excludes the registry, and elevated file
 * system access is meant to travel through `app.privileged.*`, which is bound to the plugin's own
 * actor and checked against the permissions it was installed with. The registry handed to `onClick`
 * / `railAction` was the one path around that boundary.
 *
 * This module closes it: every {@link Workspace} / {@link WorkspaceContext} that reaches plugin code
 * is replaced with a guard whose `services` registry refuses `get`/`getAll`. `project` (a pure path
 * helper) is preserved, so a plugin that legitimately needs a file can still compute a path and hand
 * it to `app.privileged.fs.*`, where the grant check lives. Studio's own actions register straight
 * into the store and never pass through here, so they keep the live registry.
 */

function registryDenialMessage(pluginId: string): string {
    return (
        `Plugin "${pluginId}" tried to reach the workspace service registry, which plugins do not get. ` +
        "Use the curated app.services.* API, or app.privileged.* for permission-checked file system " +
        "and elevated operations."
    );
}

/**
 * A service registry that answers every lookup with a refusal. It holds no reference to the real
 * registry, so there is nothing on it a plugin can reach through to the services it stands in for.
 */
function createDeniedRegistry(pluginId: string): ServiceRegistry {
    const deny = (): never => {
        throw new Error(registryDenialMessage(pluginId));
    };
    return {
        get: (_service: Services) => deny(),
        getAll: () => deny(),
    } as unknown as ServiceRegistry;
}

/**
 * The plugin-facing view of a {@link WorkspaceContext}: same project path helper, a registry that
 * refuses. Built fresh each time a callback fires so it can never be cached past the workspace it
 * belongs to.
 */
export function guardWorkspaceContextForPlugin(pluginId: string, context: WorkspaceContext): WorkspaceContext {
    return {
        project: context.project,
        services: createDeniedRegistry(pluginId),
    };
}

/**
 * The plugin-facing view of a {@link Workspace}. A real {@link Workspace} whose `getContext()`
 * returns the guarded context, so the only thing a plugin can read off it is the refusing registry.
 */
export function guardWorkspaceForPlugin(pluginId: string, workspace: Workspace): Workspace {
    return Workspace.create(guardWorkspaceContextForPlugin(pluginId, workspace.getContext()));
}

function isSeparator(item: ActionMenuItem): item is ActionSeparator {
    return (item as ActionSeparator).separator === true;
}

function isAction(item: ActionMenuItem): item is ActionDefinition {
    return (item as ActionDefinition).onClick !== undefined;
}

/** Wrap one action so its `onClick` receives the guarded workspace rather than the live one. */
export function guardPluginAction(pluginId: string, action: ActionDefinition): ActionDefinition {
    const original = action.onClick;
    return {
        ...action,
        onClick: workspace => original(guardWorkspaceForPlugin(pluginId, workspace)),
    };
}

function guardPluginMenuItem(pluginId: string, item: ActionMenuItem): ActionMenuItem {
    if (isSeparator(item)) {
        return item;
    }
    if (isAction(item)) {
        return guardPluginAction(pluginId, item);
    }
    // A submenu: recurse into its rows. Every command underneath it reaches the same handout.
    return { ...item, items: item.items.map(child => guardPluginMenuItem(pluginId, child)) };
}

/**
 * Wrap every command a group carries - the flat `actions` list and the hierarchical `items` tree
 * alike - so none of them can be handed the live workspace.
 */
export function guardPluginActionGroup(pluginId: string, group: ActionGroup): ActionGroup {
    return {
        ...group,
        actions: group.actions?.map(item => (isSeparator(item) ? item : guardPluginAction(pluginId, item))),
        items: group.items?.map(item => guardPluginMenuItem(pluginId, item)),
    };
}

/**
 * Wrap a panel's `railAction`, the one place a panel definition is handed the context. The panel's
 * React `component` is left untouched: it is only ever given `{ panelId, payload }`, never the
 * workspace.
 */
export function guardPluginPanel<TPayload>(pluginId: string, panel: PanelDefinition<TPayload>): PanelDefinition<TPayload> {
    if (!panel.railAction) {
        return panel;
    }
    const original = panel.railAction;
    return {
        ...panel,
        railAction: context => original(guardWorkspaceContextForPlugin(pluginId, context)),
    };
}
