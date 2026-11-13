/**
 * An agent's read-only lock on one of Studio's editors.
 *
 * While an agent rewrites a scene or a page, an author typing into the same editor produces a
 * document neither of them expects: the agent's next read does not match what it wrote. A lock
 * switches the author's controls in that editor off - and nothing else. The write boundary stays
 * open, so the agent's own edits land as before, and the author may switch the editor back to
 * read-write at any time; the agent is neither told nor affected.
 *
 * Comments in English per project convention.
 */

/** The editors an agent may lock. `story`: scenes and the story outline. `interface`: pages, layers and their blueprints. */
export const AGENT_LOCK_AREAS = ["story", "interface"] as const;

export type AgentLockArea = (typeof AGENT_LOCK_AREAS)[number];

export function isAgentLockArea(value: unknown): value is AgentLockArea {
    return typeof value === "string" && (AGENT_LOCK_AREAS as readonly string[]).includes(value);
}

/**
 * How long a lock outlives the agent's last call, in milliseconds. A lock the agent forgot to lift
 * would otherwise leave an editor read-only with nobody working in it.
 */
export const AGENT_EDITOR_LOCK_IDLE_MS = 5 * 60_000;

/** Which document kinds (`DocumentSpec.kind`) each area's editor writes. */
const AREA_DOCUMENT_KINDS: Record<AgentLockArea, readonly string[]> = {
    story: ["story", "story-index"],
    interface: ["ui-document", "ui-graphs"],
};

/** The area whose editor writes a document of this kind, or null when no lockable editor does. */
export function agentLockAreaOfDocumentKind(kind: string): AgentLockArea | null {
    for (const area of AGENT_LOCK_AREAS) {
        if (AREA_DOCUMENT_KINDS[area].includes(kind)) {
            return area;
        }
    }
    return null;
}
