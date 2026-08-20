import { useEffect, useRef } from "react";
import { FileUp } from "lucide-react";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../../context";
import { useNarralangExport } from "./useNarralangExport";

/**
 * The NarraLang export, by name.
 *
 * Mounted beside {@link StoryScriptCommands} and registered the same way, for the same reason that
 * module records: a command registered from a panel exists only while its panel is open. Story-scoped
 * from the palette, where there is no scene under the pointer, and listed while the workspace is
 * frozen - it writes a file the author picks, outside the project.
 */
export function NarralangCommands() {
    const { context } = useWorkspace();
    const narralang = useNarralangExport();

    // The registration is made once and reads the current flow through this ref, so a re-render does
    // not churn the palette's registry.
    const exportRef = useRef(narralang);
    exportRef.current = narralang;

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
                id: "story:export-narralang",
                titleKey: "story.narralang.exportStory",
                categoryKey: "workspace.shell.commandPalette.categoryStory",
                icon: <FileUp className="w-4 h-4" />,
                when: () => targetStoryId() !== null,
                run: () => {
                    const storyId = targetStoryId();
                    if (storyId) {
                        exportRef.current.beginExport({ storyId, sceneId: null });
                    }
                },
            },
        ]);
    }, [context]);

    return <>{narralang.dialogs}</>;
}
