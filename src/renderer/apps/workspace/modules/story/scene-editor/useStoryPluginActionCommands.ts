import { useCallback, useEffect, useMemo, useState } from "react";
import { useWorkspace } from "@/apps/workspace/context";
import { Services, type StoryPluginActionRegistration } from "@/lib/workspace/services/services";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { pluginActionToPaletteCommand, type PaletteActionCommand } from "./storyActionCommands";

/**
 * Live palette commands for plugin-registered story actions, shared by the
 * Action Creator panel and the insert-row slash chooser.
 */
export function useStoryPluginActionCommands(): PaletteActionCommand[] {
    const { context, isInitialized } = useWorkspace();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const [actions, setActions] = useState<StoryPluginActionRegistration[]>([]);

    useEffect(() => {
        if (!storyService) {
            return;
        }
        setActions(storyService.listPluginActions());
        return storyService.onPluginActionsChanged(setActions);
    }, [storyService]);

    return useMemo(() => actions.map(pluginActionToPaletteCommand), [actions]);
}

/**
 * The label a committed `{action:"plugin"}` row wears, from the live registration.
 *
 * Resolved here rather than stored on the block, for the reason the row projection's
 * `pluginActionLabel` documents: the label belongs to the plugin, so it follows the plugin's own
 * version and its language pack instead of freezing whatever it said the day the row was typed. The
 * row falls back to a generic word when the plugin is gone, which is the honest reading — the
 * behaviour is gone with it.
 */
export function useStoryPluginActionLabels(): (pluginId: string, actionId: string, params: Record<string, unknown>) => string | null {
    const { context, isInitialized } = useWorkspace();
    const storyService = useMemo(
        () => context && isInitialized ? context.services.get<StoryService>(Services.Story) : null,
        [context, isInitialized],
    );
    const [actions, setActions] = useState<StoryPluginActionRegistration[]>([]);

    useEffect(() => {
        if (!storyService) {
            setActions([]);
            return;
        }
        setActions(storyService.listPluginActions());
        return storyService.onPluginActionsChanged(setActions);
    }, [storyService]);

    const byId = useMemo(() => new Map(actions.map(action => [action.id, action])), [actions]);
    // Keyed by action id alone: the id is already namespaced by its plugin (`assertOwnedId` enforces
    // that at registration), so the pluginId the row also carries is a restatement of its prefix. It
    // stays in the signature because the payload holds both and a lookup that silently ignored half
    // its input would be the wrong thing to hand the next caller.
    return useCallback((_pluginId: string, actionId: string, params: Record<string, unknown>) => {
        const action = byId.get(actionId);
        return action ? describePluginActionRow(action, params) : null;
    }, [byId]);
}

/**
 * What one row of a plugin action reads as: the registration's `describe` over the row's params, or
 * its label.
 *
 * `describe` is the plugin's code, run while the scene editor draws a row, so a throw or a non-string
 * answer falls back to the label instead of taking the row - or the editor - down with it.
 */
export function describePluginActionRow(
    action: Pick<StoryPluginActionRegistration, "id" | "label" | "describe">,
    params: Record<string, unknown>,
): string {
    if (!action.describe) {
        return action.label;
    }
    try {
        const text = action.describe(params);
        return typeof text === "string" && text.trim() ? text : action.label;
    } catch (error) {
        console.warn(`[story] plugin action ${action.id} could not describe its row`, error);
        return action.label;
    }
}
