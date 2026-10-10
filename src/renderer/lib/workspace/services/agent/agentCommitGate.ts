/**
 * The gate again, right before a write lands.
 *
 * The bridge asks {@link gateAgentCall} once, when a call arrives. A tool that awaits between then
 * and its write - baking and importing a PSD, a folder prompt the author has to answer, measuring
 * voice clips, reading every story for a check - can still be writing seconds or minutes later, by
 * which time the author may have paused agents, frozen the project, or started a Team live session.
 * Committing then would be a write the author had just said no to, and inside a live session it
 * would reach the room as the author's own edit. So such a tool asks again here, immediately before
 * each commit, and is refused with nothing written.
 *
 * Comments in English per project convention.
 */

import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { Services, type WorkspaceContext } from "../services";
import type { LiveSessionService } from "../live/LiveSessionService";
import { AgentRefusal, refuse, type AgentToolContext } from "./agentCall";
import { gateAgentCall } from "./agentGate";

/** Whether a Team live session is running in this window, or being entered or left. */
export function agentLiveSessionActive(ctx: WorkspaceContext): boolean {
    try {
        return ctx.services.get<LiveSessionService>(Services.Live).getView().phase !== "idle";
    } catch {
        return false;
    }
}

/**
 * The refusal a write about to commit gets now, or null when it may go ahead. `nothingWritten` ends
 * the message: what the call has and has not written by this point.
 */
export function agentWriteBlocked(
    tool: Pick<AgentToolContext, "ctx" | "request" | "follow">,
    nothingWritten = "Nothing was written.",
): AgentRefusal | null {
    const refused = gateAgentCall({
        write: true,
        policy: tool.request.policy,
        paused: tool.follow.getState().paused,
        freeze: getProjectWriteFreeze(),
        liveSession: agentLiveSessionActive(tool.ctx),
    });
    if (!refused || refused.ok) {
        return null;
    }
    return refuse(refused.error.code, `${refused.error.message} ${nothingWritten}`, refused.error.hint);
}

/** Throw {@link agentWriteBlocked}'s refusal, if there is one. Call it immediately before committing. */
export function assertAgentMayStillWrite(
    tool: Pick<AgentToolContext, "ctx" | "request" | "follow">,
    nothingWritten?: string,
): void {
    const blocked = agentWriteBlocked(tool, nothingWritten);
    if (blocked) {
        throw blocked;
    }
}
