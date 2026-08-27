import { useEffect, useState } from "react";
import { Services } from "@/lib/workspace/services/services";
import { WorkspaceFreezeService } from "@/lib/workspace/services/core/WorkspaceFreezeService";
import { refusesOperations } from "@shared/types/workspaceFreeze";
import type { WorkspaceFreezeReason } from "@/lib/app/writeFreeze";
import { useWorkspace } from "../context";

/**
 * Whether this window's project data is frozen right now, as React state.
 *
 * Read through `WorkspaceFreezeService` rather than the module latch directly, because the latch is
 * module-level while a freeze belongs to one project: the service is the workspace-scoped face of it
 * and is what thaws on a project switch. Components that only need affordance (a disabled button, a
 * reason on hover) belong on this side - correctness is the write boundary's job, not theirs.
 *
 * Answers "is ANY freeze armed", which is the conservative answer and the right one for a control
 * that does not say which document it edits. A surface that knows goes through
 * `components/ui/freezeGuard`'s scope instead, so that both halves of the policy end up asking
 * `freezeAllowsWrite` about the same path.
 */
export function useWorkspaceFrozen(): boolean {
    return useWorkspaceFreeze() !== null;
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
 *
 * The top bar's action policy takes the kind too, but never to compare it against a name of its own:
 * it hands it straight to `refusesOperations`, which is also what main asks. See
 * `components/ui/freezeActionPolicy`.
 */
export function useWorkspaceFreezeReason(): WorkspaceFreezeReason["kind"] | null {
    return useWorkspaceFreeze()?.kind ?? null;
}

/**
 * Whether the freeze is one that stops Studio *starting* things - the production build, the preview,
 * a patch export, a test's game.
 *
 * A different question from {@link useWorkspaceFrozen}, and the difference is not cosmetic. Main
 * runs all four during a live session, because a session's working tree IS what everybody in it is
 * looking at, so a control that greyed itself out on "something is frozen" would be dead while the
 * process behind it would have said yes. Which kinds refuse is `refusesOperations`' answer and
 * nothing here restates it.
 */
export function useWorkspaceOperationsFrozen(): boolean {
    const kind = useWorkspaceFreezeReason();
    return kind !== null && refusesOperations(kind);
}

/**
 * The whole freeze reason, or null when this window's project data is writable.
 *
 * The base every hook above is derived from, and the input `freezeAllowsWrite` takes: a partial
 * freeze carries the paths it still allows, so a surface that can name the document it edits needs
 * the reason itself rather than its kind. Only `components/ui/freezeGuard` should reach for it -
 * everything else wants one of the narrower questions above.
 */
export function useWorkspaceFreeze(): WorkspaceFreezeReason | null {
    const { context } = useWorkspace();
    const [reason, setReason] = useState<WorkspaceFreezeReason | null>(null);

    useEffect(() => {
        if (!context) {
            setReason(null);
            return;
        }
        const freezeService = context.services.get<WorkspaceFreezeService>(Services.WorkspaceFreeze);
        setReason(freezeService.getReason());
        return freezeService.onChanged(next => setReason(next));
    }, [context]);

    return reason;
}
