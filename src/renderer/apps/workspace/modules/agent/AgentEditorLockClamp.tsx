import type { ReactNode } from "react";
import type { AgentLockArea } from "@shared/agent/editorLock";
import { useAgentEditorLocks } from "./useAgentEditorLocks";

/**
 * Switches every form control under it off while an agent holds a read-only lock on `area` and the
 * author has not switched it back to read-write. For a surface whose controls do not route through a
 * scoped freeze guard (`agentLockBlocking` reaches those): a `<fieldset disabled>` takes them all,
 * whoever wrote them.
 *
 * Comments in English per project convention.
 */
export function AgentEditorLockClamp({ area, children }: { area: AgentLockArea; children: ReactNode }): ReactNode {
    const lock = useAgentEditorLocks()[area];
    if (!lock || lock.overridden) {
        return children;
    }
    return (
        <fieldset disabled aria-readonly style={{ display: "contents" }}>
            {children}
        </fieldset>
    );
}
