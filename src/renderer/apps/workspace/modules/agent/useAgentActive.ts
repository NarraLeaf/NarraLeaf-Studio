import { useCallback, useSyncExternalStore } from "react";
import { Services } from "@/lib/workspace/services/services";
import type { AgentFollowService, AgentFollowState } from "@/lib/workspace/services/agent/AgentFollowService";
import { useWorkspace } from "../../context/WorkspaceContext";

const NO_SUBSCRIPTION = () => () => {};

/**
 * Whether the status bar takes the agent wash: an agent is at work (see `AgentFollowState.active`)
 * and the author has not paused it. The wash reads as "an agent is working", which a paused agent
 * is not; its status cell says it is paused, in the bar's ordinary colours.
 */
export function agentWashesStatusBar(state: Pick<AgentFollowState, "active" | "paused">): boolean {
    return state.active && !state.paused;
}

/**
 * Whether an agent connected over MCP is at work in this workspace right now - the signal the status
 * bar washes itself in. See {@link agentWashesStatusBar}.
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
    return useSyncExternalStore(subscribe, () => (follow ? agentWashesStatusBar(follow.getState()) : false));
}
