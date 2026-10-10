import { useCallback, useSyncExternalStore } from "react";
import { Services } from "@/lib/workspace/services/services";
import type { AgentFollowService, AgentFollowState } from "@/lib/workspace/services/agent/AgentFollowService";
import type { AgentQuickState } from "@shared/agent/workspaceAccess";
import { useWorkspace } from "../../context/WorkspaceContext";
import { agentAccessOff, useAgentQuickState } from "./useAgentQuickState";

const NO_SUBSCRIPTION = () => () => {};

/**
 * Whether the status bar takes the agent wash: an agent is at work (see `AgentFollowState.active`)
 * and the author has not paused it. The wash reads as "an agent is working", which a paused agent
 * is not; its status cell says it is paused, in the bar's ordinary colours. With agent access off
 * there is no agent at all, whatever the session last saw.
 */
export function agentWashesStatusBar(state: Pick<AgentFollowState, "active" | "paused">, quick: AgentQuickState | null): boolean {
    return !agentAccessOff(quick) && state.active && !state.paused;
}

/**
 * Whether the status bar shows the agent's cell: from an agent's first call in this session on, or
 * while the author holds it paused - but never while agent access is off. Off, there is no agent to
 * name or pause, and the menu bar's Agent menu is where access is turned back on.
 */
export function agentStatusCellShown(
    state: Pick<AgentFollowState, "lastCallAt" | "activity" | "paused">,
    quick: AgentQuickState | null,
): boolean {
    if (agentAccessOff(quick)) {
        return false;
    }
    return state.lastCallAt !== null || state.activity !== null || state.paused;
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
    const quick = useAgentQuickState();
    const subscribe = useCallback(
        (listener: () => void) => (follow ? follow.onChanged(listener) : NO_SUBSCRIPTION()),
        [follow],
    );
    return useSyncExternalStore(subscribe, () => (follow ? agentWashesStatusBar(follow.getState(), quick) : false));
}
