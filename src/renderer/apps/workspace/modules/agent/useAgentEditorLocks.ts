import { useSyncExternalStore } from "react";
import { resolveDocumentSpecForPath } from "@shared/documents/registry";
import { agentLockAreaOfDocumentKind, type AgentLockArea } from "@shared/agent/editorLock";
import {
    getAgentEditorLocks,
    subscribeAgentEditorLocks,
    type AgentEditorLocks,
} from "@/lib/workspace/services/agent/agentEditorLockStore";

/** The editor locks an agent holds in this window (`AgentFollowService.editorLocks`). */
export function useAgentEditorLocks(): AgentEditorLocks {
    return useSyncExternalStore(subscribeAgentEditorLocks, getAgentEditorLocks, getAgentEditorLocks);
}

/**
 * The locked editor a control that writes `scope` belongs to, or null when the author may use it.
 *
 * Only a control that names what it writes can be locked: the scope is the same project-relative
 * path the freeze policy takes, and the document it names decides the editor. A control with no
 * scope is never locked, which errs toward leaving the author a working control rather than a dead
 * one that no switch brings back.
 */
export function agentLockBlocking(locks: AgentEditorLocks, scope: string | readonly string[] | undefined): AgentLockArea | null {
    if (scope === undefined) {
        return null;
    }
    const paths = typeof scope === "string" ? [scope] : scope;
    for (const path of paths) {
        const kind = resolveDocumentSpecForPath(path)?.spec.kind;
        const area = kind ? agentLockAreaOfDocumentKind(kind) : null;
        if (area && locks[area] && !locks[area]!.overridden) {
            return area;
        }
    }
    return null;
}
