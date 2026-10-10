/**
 * {@link ensureAgentMayRead} bound to main, for tool handlers: the one call a tool that reads the
 * author's files makes before reading any of them.
 *
 * Kept apart from `agentPaths.ts` so that file stays free of the bridge and can be tested as it is.
 *
 * Comments in English per project convention.
 */

import { getAgentBridgeInterface } from "@/lib/app/bridge";
import type { AgentFolderAccessAnswer, AgentFolderAccessRequest } from "@shared/agent/protocol";
import type { AgentToolContext } from "./agentCall";
import { ensureAgentMayRead } from "./agentPaths";

async function askMain(request: AgentFolderAccessRequest): Promise<AgentFolderAccessAnswer | null> {
    let bridge: ReturnType<typeof getAgentBridgeInterface>;
    try {
        bridge = getAgentBridgeInterface();
    } catch {
        // No preload bridge (a unit test): nothing to ask.
        return null;
    }
    const result = await bridge.requestFolderAccess(request);
    return result.success ? result.data : null;
}

/**
 * Refuse with `path_not_allowed` unless the agent may read every path - asking the author, through
 * main, about folders outside the project and the allowed ones.
 */
export function ensureAgentMayReadPaths(paths: readonly string[], { ctx, request }: Pick<AgentToolContext, "ctx" | "request">): Promise<void> {
    return ensureAgentMayRead(paths, {
        projectPath: ctx.project.getConfig().projectPath,
        policy: request.policy,
        callId: request.callId,
        ask: askMain,
    });
}
