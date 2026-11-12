import { useEffect, useRef } from "react";
import { FileText, FileInput } from "lucide-react";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { CommandService } from "@/lib/workspace/services/ui/CommandService";
import { StoryService } from "@/lib/workspace/services/story/StoryService";
import { Services } from "@/lib/workspace/services/services";
import { useWorkspace } from "../../../context";
import { useManuscriptIo } from "./useManuscriptIo";

/**
 * The script document flows in the command palette, mounted once by the workspace shell beside
 * `StoryScriptCommands` and registered the same way. Story-scoped: the target is the project's
 * default story.
 */
export function ManuscriptCommands() {
    const { context } = useWorkspace();
    const io = useManuscriptIo();
    const ioRef = useRef(io);
    ioRef.current = io;

    useEffect(() => {
        if (!context) {
            return;
        }
        const commandService = context.services.get<CommandService>(Services.Command);
        const storyService = context.services.get<StoryService>(Services.Story);
        const targetStoryId = (): string | null =>
            storyService.getDefaultStoryId() ?? storyService.listStories()[0]?.id ?? null;

        // Development builds only: lets an acceptance script open the wizard on a file without
        // driving the native picker, which no automation can do without taking the foreground.
        if (__NLS_STUDIO_DEV__) {
            (window as unknown as { __nlsManuscript?: unknown }).__nlsManuscript = {
                importPath: (filePath: string) => {
                    const storyId = targetStoryId();
                    return storyId ? ioRef.current.importPath(storyId, filePath) : undefined;
                },
                exportTo: (choice: Parameters<typeof ioRef.current.exportTo>[1], targetPath: string) => {
                    const storyId = targetStoryId();
                    return storyId ? ioRef.current.exportTo(storyId, choice, targetPath) : undefined;
                },
                beginExport: (sceneIds: string[] | null = null) => {
                    const storyId = targetStoryId();
                    if (storyId) {
                        ioRef.current.beginExport({ storyId, sceneIds });
                    }
                },
            };
        }

        return commandService.registerMany([
            {
                id: "story:export-manuscript",
                titleKey: "manuscript.exportCommand",
                categoryKey: "workspace.shell.commandPalette.categoryStory",
                icon: <FileText className="w-4 h-4" />,
                when: () => targetStoryId() !== null,
                run: () => {
                    const storyId = targetStoryId();
                    if (storyId) {
                        ioRef.current.beginExport({ storyId, sceneIds: null });
                    }
                },
            },
            {
                id: "story:import-manuscript",
                titleKey: "manuscript.importCommand",
                categoryKey: "workspace.shell.commandPalette.categoryStory",
                icon: <FileInput className="w-4 h-4" />,
                // Registered commands are exempt from the palette's own freeze filter, so the gate
                // is here - see `StoryScriptCommands`.
                when: () => getProjectWriteFreeze() === null && targetStoryId() !== null,
                run: () => {
                    const storyId = targetStoryId();
                    if (storyId) {
                        ioRef.current.beginImport(storyId);
                    }
                },
            },
        ]);
    }, [context]);

    return <>{io.dialogs}</>;
}
