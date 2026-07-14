import { useEffect, useMemo, useState } from "react";
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
