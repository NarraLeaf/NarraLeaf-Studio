import { useEffect, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
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
    return useWorkspaceFreezeReason() !== null;
}

/**
 * WHY this window's project data is frozen, or null when it is writable.
 *
 * Almost nothing needs this: to a control that writes, every freeze is the same freeze, and asking
 * which one invites a surface to carve itself an exception. There is exactly one place the
 * difference is real - the merge resolution panel. A merge freeze has no `thaw`; the only way out of
 * it is to finish or abandon the merge, so the panel that does those two things is the one surface
 * that must NOT be switched off by it. Everything else it offers is a choice recorded in memory,
 * which writes nothing and is never gated either way.
 */
export function useWorkspaceFreezeReason(): WorkspaceFreezeReason["kind"] | null {
    const { context } = useWorkspace();
    const [reason, setReason] = useState<WorkspaceFreezeReason["kind"] | null>(null);

    useEffect(() => {
        if (!context) {
            setReason(null);
            return;
        }
        const freezeService = context.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        setReason(freezeService.getReason()?.kind ?? null);
        return freezeService.onChanged(next => setReason(next?.kind ?? null));
    }, [context]);

    return reason;
}
