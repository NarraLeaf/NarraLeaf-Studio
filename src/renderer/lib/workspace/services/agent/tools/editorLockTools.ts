import { AGENT_LOCK_AREAS, isAgentLockArea, type AgentLockArea } from "@shared/agent/editorLock";
import { answer, refuse, type AgentToolHandler } from "../agentCall";

/**
 * `editor_lock` / `editor_unlock`: the agent sets one of Studio's editors read-only for the author
 * while it works there (`@shared/agent/editorLock`).
 *
 * The answers never say whether the author switched the editor back to read-write: that switch is
 * the author's own, and the agent's work does not depend on it.
 *
 * Comments in English per project convention.
 */

function readArea(args: Record<string, unknown>, required: boolean): AgentLockArea | undefined {
    const value = args.editor;
    if (value === undefined && !required) {
        return undefined;
    }
    if (!isAgentLockArea(value)) {
        throw refuse("invalid_args", `\`editor\` must be one of: ${AGENT_LOCK_AREAS.join(", ")}.`);
    }
    return value;
}

export const editorLock: AgentToolHandler = async (args, { follow }) => {
    const area = readArea(args, true) as AgentLockArea;
    follow.lockEditor(area);
    return answer(
        `The ${area} editor is read-only for the author. Call editor_unlock when you are done; it also lifts after 5 minutes without a call from you.`,
        { editor: area, locked: true },
    );
};

export const editorUnlock: AgentToolHandler = async (args, { follow }) => {
    const area = readArea(args, false);
    const released = area ? [area] : AGENT_LOCK_AREAS.filter(each => follow.getState().editorLocks[each]);
    for (const each of released) {
        follow.unlockEditor(each);
    }
    return answer(
        area ? `The ${area} editor is the author's again.` : "Every editor you locked is the author's again.",
        { unlocked: released },
    );
};
