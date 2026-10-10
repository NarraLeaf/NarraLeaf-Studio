import type { AgentFolderAccessAnswer, AgentFolderRefusalReason } from "./protocol";

/**
 * How an answer about folder access is put to the agent, in one place for both hops: main's
 * `request_folder_access` and the workspace's `path_not_allowed` refusals say the same thing in the
 * same words, so an agent that met one recognises the other.
 *
 * English, because it is read by a model, not by the author.
 *
 * Comments in English per project convention.
 */

export function describeAgentFolderRefusal(reason: AgentFolderRefusalReason): string {
    switch (reason) {
        case "root":
            return "a file-system root, or a folder holding the home folder, is never opened to agents";
        case "home":
            return "the home folder as a whole is never opened to agents; name the folder inside it that holds the files";
        case "studio":
            return "Studio's own folders (its settings and the application) are never opened to agents";
        case "tooMany":
            return "one dialog asks about at most 5 folders; ask again for this one";
        case "relative":
            return "not an absolute path";
    }
}

/** What to do next, given an answer that left something unreadable. Null when everything was granted. */
export function agentFolderAccessHint(answer: AgentFolderAccessAnswer): string | null {
    if (answer.pending.length > 0) {
        return `Studio is asking the author to allow ${answer.pending.join(", ")}; call again once they answer.`;
    }
    if (answer.denied.length > 0) {
        return `The author declined ${answer.denied.join(", ")}. Do not ask again for it; ask the author in your conversation, or have them copy the files into the project directory.`;
    }
    if (answer.refused.some(entry => entry.reason === "tooMany")) {
        return "Ask for at most 5 folders at a time: call request_folder_access for the rest, or import in smaller batches.";
    }
    if (answer.refused.length > 0) {
        return "Name the specific folder that holds the files, or have the author copy them into the project directory.";
    }
    return null;
}

/** The answer as lines an agent reads. */
export function describeAgentFolderAccess(answer: AgentFolderAccessAnswer): string[] {
    const hint = agentFolderAccessHint(answer);
    return [
        ...(answer.granted.length > 0 ? [`You may read: ${answer.granted.join(", ")}.`] : []),
        ...agentFolderAccessGaps(answer),
        ...(hint ? [hint] : []),
    ];
}

/** One line per folder that is not readable: waiting, declined, or never asked about. */
export function agentFolderAccessGaps(answer: AgentFolderAccessAnswer): string[] {
    const lines: string[] = [];
    if (answer.pending.length > 0) {
        lines.push(`Waiting for the author: ${answer.pending.join(", ")}.`);
    }
    if (answer.denied.length > 0) {
        lines.push(`Declined by the author: ${answer.denied.join(", ")}.`);
    }
    for (const entry of answer.refused) {
        lines.push(`Not allowed: ${entry.folder} (${describeAgentFolderRefusal(entry.reason)}).`);
    }
    return lines;
}
