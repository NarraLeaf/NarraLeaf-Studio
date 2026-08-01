import { useEffect, useRef } from "react";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../../context";
import { useStoryScriptIo } from "./useStoryScriptIo";

/**
 * The Story Script flows, by name.
 *
 * Mounted once by the workspace shell beside {@link WorkspaceCommands} rather than by the story
 * panel, for the reason that module already records: registering from a panel would tie a command's
 * existence to whether its panel happens to be open. It carries UI where those do not - both flows
 * end in a dialog - so it mounts them itself rather than only registering callbacks.
 *
 * Story-scoped, like `story:new-scene`: from the palette there is no scene under the pointer, so the
 * whole story is the subject and the target is the project default. Export stays listed while the
 * workspace is frozen (it writes a file the author picks, outside the project); import does not.
 */
export function StoryScriptCommands() {
    const { context } = useWorkspace();
    const script = useStoryScriptIo();

    // The registration is made once and reads the current flow through this ref, so a re-render does
    // not churn the palette's registry.
    const scriptRef = useRef(script);
    scriptRef.current = script;

    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        const storyService = context.services.get<StoryService>(Services.Story);
        const targetStoryId = (): string | null =>
            storyService.getDefaultStoryId() ?? storyService.listStories()[0]?.id ?? null;

        return commandService.registerMany([
            {
                id: "story:export-script",
                titleKey: "story.script.exportStory",
                categoryKey: "workspace.shell.commandPalette.categoryStory",
                when: () => targetStoryId() !== null,
                run: () => {
                    const storyId = targetStoryId();
                    if (storyId) {
                        scriptRef.current.beginExport({ storyId, sceneIds: null });
                    }
                },
            },
            {
                id: "story:import-script",
                titleKey: "story.script.import",
                categoryKey: "workspace.shell.commandPalette.categoryStory",
                // Registered commands are exempt from the palette's own freeze filter by design, so
                // the gate has to be here - see `WorkspaceCommands`.
                when: () => getProjectWriteFreeze() === null && targetStoryId() !== null,
                run: () => {
                    const storyId = targetStoryId();
                    if (storyId) {
                        scriptRef.current.beginImport(storyId);
                    }
                },
            },
        ]);
    }, [context]);

    return <>{script.dialogs}</>;
}
