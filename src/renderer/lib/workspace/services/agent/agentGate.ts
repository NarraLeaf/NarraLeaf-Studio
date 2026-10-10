/**
 * Whether an agent's call may run at all, decided before any handler sees it.
 *
 * Pure, so the order of the refusals is a tested fact rather than an accident of the handler. The
 * order is the order of the remedies: the first refusal an agent hears is the one whose fix comes
 * first - an author who has not switched writes on will not be helped by being told the project is
 * frozen as well.
 *
 * Reads are never gated here. A paused agent may still look at the project (that is how it learns
 * what the author changed while it waited), and a frozen workspace is still readable.
 *
 * Comments in English per project convention.
 */

import { agentRefusal, type AgentCallResult, type AgentSessionPolicy } from "@shared/agent/protocol";
import type { WorkspaceFreeze } from "@/lib/app/writeFreeze";

export type AgentGateInput = {
    /** The tool's `write` flag from the tool table. */
    write: boolean;
    policy: AgentSessionPolicy;
    /** The author paused agents from the status bar. */
    paused: boolean;
    /** `getProjectWriteFreeze()` at the moment of the call. */
    freeze: WorkspaceFreeze | null;
    /** A Team live session is running in this window, or being entered or left. */
    liveSession: boolean;
};

/** Null when the call may run; otherwise the refusal to answer with. */
export function gateAgentCall(input: AgentGateInput): AgentCallResult | null {
    if (!input.write) {
        return null;
    }
    if (!input.policy.writesEnabled) {
        return agentRefusal(
            "writes_disabled",
            "Write access for agents is switched off in Studio.",
            "Ask the author to turn on \"Allow agents to change projects\" in Studio's settings, then try again. Read tools keep working meanwhile.",
        );
    }
    if (input.paused) {
        return agentRefusal(
            "paused",
            "The author paused the agent from Studio's status bar.",
            "Wait for the author to resume, then read the page or scene again before writing - they may have changed it.",
        );
    }
    // A live session arms a freeze of its own, a partial one; it is reported as the session rather
    // than as a freeze, because the remedy is different (leave the session) and so is the sentence.
    if (input.liveSession || input.freeze?.reason.kind === "live-session") {
        return agentRefusal(
            "live_session",
            "A Team live session is running in this project, so agent writes would race the room.",
            "Ask the author to leave the live session, or work read-only until it ends.",
        );
    }
    if (input.freeze) {
        return agentRefusal(
            "frozen",
            `The project is not accepting changes right now (${describeFreeze(input.freeze)}).`,
            "Wait for the operation to finish, then try again.",
        );
    }
    return null;
}

function describeFreeze(freeze: WorkspaceFreeze): string {
    switch (freeze.reason.kind) {
        case "revision":
            return "a past version is open for viewing";
        case "manual":
            return "the author froze the project";
        case "merge":
            return "a version-control merge is unfinished";
        case "recovery":
            return "Studio is in recovery mode";
        case "taken-over":
            return "another Studio window has taken the project over";
        default:
            return freeze.reason.kind;
    }
}
