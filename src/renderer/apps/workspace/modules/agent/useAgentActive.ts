import { useCallback, useSyncExternalStore } from "react";
import { Services } from "@/lib/workspace/services/services";
import type { AgentFollowService } from "@/lib/workspace/services/agent/AgentFollowService";
import { useWorkspace } from "../../context/WorkspaceContext";

const NO_SUBSCRIPTION = () => () => {};

/**
 * Whether an agent connected over MCP is at work in this workspace right now - the signal the status
 * bar washes itself in. See `AgentFollowState.active` for what "at work" counts.
 *
 * Comments in English per project convention.
 */
export function useAgentActive(): boolean {
    const { context } = useWorkspace();
    const follow = context ? context.services.get<AgentFollowService>(Services.AgentFollow) : null;
    const subscribe = useCallback(
        (listener: () => void) => (follow ? follow.onChanged(listener) : NO_SUBSCRIPTION()),
        [follow],
    );
    return useSyncExternalStore(subscribe, () => follow?.getState().active ?? false);
}
