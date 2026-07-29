import { useEffect, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import { useWorkspace } from "../context";

/**
 * Whether this window's project data is frozen right now, as React state.
 *
 * Read through `WorkspaceFreezeService` rather than the module latch directly, because the latch is
 * module-level while a freeze belongs to one project: the service is the workspace-scoped face of it
 * and is what thaws on a project switch. Components that only need affordance (a disabled button, a
 * reason on hover) belong on this side - correctness is the write boundary's job, not theirs.
 */
export function useWorkspaceFrozen(): boolean {
    const { context } = useWorkspace();
    const [frozen, setFrozen] = useState(false);

    useEffect(() => {
        if (!context) {
            setFrozen(false);
            return;
        }
        const freezeService = context.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        setFrozen(freezeService.isFrozen());
        return freezeService.onChanged(reason => setFrozen(reason !== null));
    }, [context]);

    return frozen;
}
