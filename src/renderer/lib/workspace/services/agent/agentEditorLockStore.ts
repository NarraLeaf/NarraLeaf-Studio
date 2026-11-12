import type { AgentLockArea } from "@shared/agent/editorLock";

/**
 * The editor locks an agent holds in this window, as a module-level store.
 *
 * `AgentFollowService` owns them and publishes here; the freeze guard reads them. Module-level for
 * the reason the write-freeze latch is: a window is one project, and the guard is rendered by
 * surfaces and tests with no workspace around them, which must not have to import the workspace to
 * learn that nothing is locked.
 *
 * Comments in English per project convention.
 */

export type AgentEditorLocks = Readonly<Partial<Record<AgentLockArea, { overridden: boolean }>>>;

export const NO_AGENT_EDITOR_LOCKS: AgentEditorLocks = Object.freeze({});

let current: AgentEditorLocks = NO_AGENT_EDITOR_LOCKS;
const listeners = new Set<() => void>();

export function getAgentEditorLocks(): AgentEditorLocks {
    return current;
}

export function setAgentEditorLocks(next: AgentEditorLocks): void {
    if (next === current) {
        return;
    }
    current = next;
    for (const listener of [...listeners]) {
        listener();
    }
}

export function subscribeAgentEditorLocks(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}
