/**
 * The project's cast groups, by id, in the order the Characters panel files them.
 *
 * One subscription per editor tab, published to the rows through `StoryCommandLineProvider`: a scene
 * is hundreds of rows and every one of them has a speaker picker behind its nametag, so a hook per
 * row would be a service subscription per row. The service's own change event covers a group
 * created, renamed or deleted as well as a character moved between groups.
 *
 * Comments in English per project convention.
 */

import { useEffect, useState } from "react";
import { useOptionalWorkspace } from "@/apps/workspace/context";
import { Services } from "@/lib/workspace/services/services";
import { CharacterService } from "@/lib/workspace/services/core/CharacterService";

/** No groups: what a project without cast groups, and anything outside a workspace, reads as. */
export const NO_CHARACTER_GROUPS: ReadonlyMap<string, string> = new Map();

export function useCharacterGroupNames(): ReadonlyMap<string, string> {
    // `useOptionalWorkspace`, because story rows render outside a workspace as well (the picker's own
    // tests do exactly that) and a group name is an enrichment: without a workspace there are no
    // groups to file anyone under, which is an answer rather than a mistake.
    const workspace = useOptionalWorkspace();
    const context = workspace?.context ?? null;
    const isInitialized = workspace?.isInitialized ?? false;
    const [groupNames, setGroupNames] = useState<ReadonlyMap<string, string>>(NO_CHARACTER_GROUPS);

    useEffect(() => {
        if (!context || !isInitialized) {
            setGroupNames(NO_CHARACTER_GROUPS);
            return;
        }
        const service = context.services.get<CharacterService>(Services.Character);
        const read = () => setGroupNames(new Map(service.listGroups().map(group => [group.id, group.name])));
        read();
        return service.subscribe(read);
    }, [context, isInitialized]);

    return groupNames;
}
