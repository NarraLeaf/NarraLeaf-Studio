import { useEffect, useMemo, useState } from "react";
import type { StoryCustomCommand } from "@shared/types/story/customCommands";
import { useWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import type { StoryCustomCommandService } from "@/lib/workspace/services/story/StoryCustomCommandService";

/** The project's story command service and its commands, kept current. */
export function useStoryCustomCommands(): { service: StoryCustomCommandService | null; commands: StoryCustomCommand[] } {
    const { context, isInitialized } = useWorkspace();
    const service = useMemo(
        () => (context && isInitialized ? context.services.get<StoryCustomCommandService>(Services.StoryCustomCommands) : null),
        [context, isInitialized],
    );
    const [commands, setCommands] = useState<StoryCustomCommand[]>(() => service?.listCommands() ?? []);
    useEffect(() => {
        if (!service) {
            setCommands([]);
            return undefined;
        }
        setCommands(service.listCommands());
        return service.onCommandsChanged(setCommands);
    }, [service]);
    return { service, commands };
}
