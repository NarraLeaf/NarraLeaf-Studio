import type { AgentErrorCode } from "./protocol";
import type { AgentClientConfigKind, AgentSettingsSnapshot } from "./settings";

/**
 * The narrow hold a workspace window has on agent access: what its Agent menu shows and the few
 * switches it offers, and the line main sends it after each call main answered itself.
 *
 * Everything in `./settings.ts` that the Settings window sees - the token above all, and the address
 * that pairs with it - stays there. A workspace shows project content and runs plugin code, so it is
 * given exactly three booleans and a set of actions whose results carry no secret: copying a client
 * configuration is done by main, straight onto the system clipboard, and the answer is only that it
 * happened.
 *
 * Comments in English per project convention.
 */

/** What the Agent menu shows of agent access. Never more than these three fields. */
export type AgentQuickState = {
    /** The author switched the endpoint on. */
    enabled: boolean;
    /** Write tools are let through. */
    allowWrites: boolean;
    /** The endpoint is listening right now (it can be enabled and have failed to start). */
    running: boolean;
};

/** The switches the Agent menu may flip. Anything absent is left as it is. */
export type AgentQuickTogglePatch = {
    enabled?: boolean;
    allowWrites?: boolean;
};

/** The client configurations the Agent menu can copy; the same kinds the Settings panel offers. */
export type AgentCopyConfigKind = AgentClientConfigKind;

export const AGENT_COPY_CONFIG_KINDS: readonly AgentCopyConfigKind[] = ["claudeCode", "opencode", "json", "stdio"];

/** The folder an exported skill is written into, inside the directory the author picked. */
export const AGENT_SKILL_EXPORT_FOLDER = "NarraLeaf-Skills";

/**
 * Project a Settings snapshot down to what a workspace may see.
 *
 * Built field by field rather than by deleting the secret ones, so that a field added to the
 * snapshot later is withheld from the workspace until someone decides otherwise.
 */
export function toAgentQuickState(snapshot: Pick<AgentSettingsSnapshot, "enabled" | "allowWrites" | "running">): AgentQuickState {
    return {
        enabled: snapshot.enabled === true,
        allowWrites: snapshot.allowWrites === true,
        running: snapshot.running === true,
    };
}

/**
 * One call main answered itself (a main-side tool, or a refusal main made before routing), as the
 * workspace's Agent log records it.
 *
 * Deliberately not the call: no arguments, no answer text, no token - only what a log row shows.
 * `summary` is the one thing the call was about (a project name, a test id, a build target), chosen
 * by main from a fixed list per tool.
 */
export type AgentMainActivity = {
    tool: string;
    clientName: string | null;
    ok: boolean;
    /** Present when `ok` is false. */
    code?: AgentErrorCode;
    /** The refusal's message, when `ok` is false: Studio's own wording, which may name a path the call gave. */
    message?: string;
    hint?: string;
    durationMs: number;
    summary: string | null;
    /** The plugin whose tool it was, for a call to a plugin tool. */
    pluginId?: string;
    /** That tool's own title, which the log shows in place of a Studio translation. */
    title?: string;
    /** Whether that tool writes; Studio's own tools are looked up in the tool table instead. */
    write?: boolean;
};
