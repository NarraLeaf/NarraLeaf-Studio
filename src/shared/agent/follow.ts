/**
 * Follow mode: when an agent writes, the workspace opens the page, scene, blueprint or table the
 * write landed in, brings that tab to the front and outlines what changed.
 *
 * A Studio-wide preference, on unless the author turns it off: what an agent is doing to a project
 * has to be visible in the editor itself, not only in the agent's own transcript. It lives in global
 * state like the other renderer preferences - not in main's `agent-mcp.json`, which holds the token
 * and decides what an agent may do; this decides nothing about access, only what the author is shown.
 *
 * Shared because the global-state schema (`GLOBAL_STATE_DEFAULTS`) declares the key as well as its
 * Settings row. The one reader is the workspace's `AgentFollowService`; the Agent menu and the
 * status bar cell write it through that service.
 *
 * Comments in English per project convention.
 */

export const AGENT_FOLLOW_KEY = "agent.follow";

export const AGENT_FOLLOW_DEFAULT = true;

/** Persisted values are untrusted: anything that is not a boolean, including a reset, reads as the default. */
export function resolveAgentFollow(stored: unknown): boolean {
    return typeof stored === "boolean" ? stored : AGENT_FOLLOW_DEFAULT;
}
