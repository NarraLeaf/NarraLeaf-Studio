/**
 * What an agent connected to Studio's MCP endpoint and the workspace that carries out its calls say
 * to each other.
 *
 * Two hops, one vocabulary. An MCP client talks JSON-RPC to the main process (`AgentMcpServer`);
 * main answers the calls it owns itself - opening and creating projects, building, the session's
 * state - and hands every other call to the workspace window whose project the call names, over one
 * IPC request (`workspaceAgentCall`). The renderer's `AgentBridgeService` answers it through the same
 * services the editor commits through, so an agent's edit is an edit like any other: on the canvas
 * at once, one step of undo, saved by the same auto-save.
 *
 * Everything that crosses either hop is in this file, so that the two halves cannot disagree about
 * the shape of an answer. The tool table itself is `./tools.ts`.
 *
 * Comments in English per project convention.
 */

/** One piece of an answer, in MCP's own content shapes. */
export type AgentContent =
    | { type: "text"; text: string }
    /** A PNG or JPEG, base64 without the `data:` prefix. */
    | { type: "image"; mimeType: "image/png" | "image/jpeg"; data: string };

/**
 * Why a call was not carried out.
 *
 * Each code is something the agent can act on, and the message says how. A refusal is an answer,
 * not a crash: it reaches the client as a tool result with `isError: true`, so the model reads it and
 * corrects course instead of the client reporting a transport failure.
 */
export type AgentErrorCode =
    /** The arguments do not fit the tool's schema. */
    | "invalid_args"
    /** No tool by that name. */
    | "unknown_tool"
    /** No workspace window has the project open, or more than one does and none was named. */
    | "no_workspace"
    /** The author has not switched on write access for agents. */
    | "writes_disabled"
    /** The author paused the agent from the status bar. */
    | "paused"
    /** The project is frozen for writing (a version-control operation, a recovery, a reload). */
    | "frozen"
    /** A Team live session is running; agent writes would race the room. */
    | "live_session"
    /** The page or scene changed since the agent read it - read it again and redo the edit. */
    | "stale_revision"
    /** The source did not compile, or the check found something at error severity. Nothing was written. */
    | "check_failed"
    /** A surface, scene, element, asset or character the call names does not exist. */
    | "not_found"
    /** A file path outside the directories the author allowed agents to read. */
    | "path_not_allowed"
    /** The project is not trusted, so its code may not run (play-test, build). */
    | "untrusted"
    /** The call is valid but the operation is not possible in this state. */
    | "unavailable"
    /** Something broke that is not the agent's fault. */
    | "internal";

export type AgentError = {
    code: AgentErrorCode;
    message: string;
    /** What to do next, when there is something better to say than the message. */
    hint?: string;
};

export type AgentCallResult =
    | {
          ok: true;
          content: AgentContent[];
          /** The same answer as data, for clients that read MCP's `structuredContent`. */
          structured?: Record<string, unknown>;
      }
    | { ok: false; error: AgentError };

/** Main → workspace renderer: carry out one call. */
export type AgentCallRequest = {
    /** Unique per call; the renderer echoes it in its console channel. */
    callId: string;
    tool: string;
    args: Record<string, unknown>;
    /** The name the MCP client gave in `initialize` (`clientInfo.name`), for the status bar. */
    clientName: string | null;
    /** The author's switches as they are at the moment of the call. */
    policy: AgentSessionPolicy;
};

/**
 * Calls main makes to a workspace that are not tools an agent can name. They travel on the same
 * IPC request so there is one channel to keep in step; the leading `__` keeps them out of any name
 * the tool table could ever use.
 */
export const AGENT_INTERNAL_TOOL_STATE = "__state";

/**
 * Run one registered project test in a workspace that already has the project open.
 *
 * `test` is a main tool because a project nobody has open is tested headlessly, through the same
 * background workspace `--test` opens. One project is one window, though, so a project the author
 * has open cannot be given a second, hidden one: main hands the test to the window that has it,
 * which runs it through its own `TestRunService` exactly as the Run > Test picker would.
 *
 * Args: `{ id: string; parameters?: Record<string, string> }`. Answer: an ordinary
 * {@link AgentCallResult}; `structured` should carry `{ testId, status, ... }` where `status` is the
 * test's terminal status (`passed` / `failed` / `skipped` / `errored`).
 */
export const AGENT_INTERNAL_TOOL_TEST = "__test";

/**
 * Build the project in a workspace that already has it open, through its own `BuildService` - the
 * pipeline the Build menu runs, checks and all. Main has already refused an untrusted project.
 *
 * Args: `{ target: "current" | "windows" | "macos" | "linux" | "web"; output?: string }`. Answer: an
 * ordinary {@link AgentCallResult}; `structured` should carry `{ outputDir, artifacts }` on success.
 */
export const AGENT_INTERNAL_TOOL_BUILD = "__build";

/**
 * The author's switches, as the workspace needs to know them. Main owns the settings; the renderer
 * gets a copy with every call so that a switch flipped in the settings window takes effect on the
 * next call without a second channel.
 */
export type AgentSessionPolicy = {
    /** Write tools are allowed. Off by default. */
    writesEnabled: boolean;
    /** Directories `assets_import` may read from (absolute, normalised). The project directory is always allowed. */
    allowedImportRoots: string[];
    /**
     * Plugins whose agent tools the author switched off in Settings > Agent access. Main already
     * refuses their calls; the workspace refuses them again, so the list holds on both hops.
     */
    blockedPluginIds?: string[];
};

/** The workspace's own state, reported to main for `agent_status` and the status bar. */
export type AgentWorkspaceState = {
    paused: boolean;
    follow: boolean;
};

export function agentText(text: string, structured?: Record<string, unknown>): AgentCallResult {
    return { ok: true, content: [{ type: "text", text }], structured };
}

export function agentRefusal(code: AgentErrorCode, message: string, hint?: string): AgentCallResult {
    return { ok: false, error: { code, message, hint } };
}

/** MCP protocol revision this server speaks. Older clients that ask for 2025-03-26 are answered in it too. */
export const AGENT_MCP_PROTOCOL_VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"] as const;

export const AGENT_MCP_SERVER_NAME = "narraleaf-studio";

/** Where the endpoint is served on 127.0.0.1. */
export const AGENT_MCP_PATH = "/mcp";

/** Default port; the setting may pick another. */
export const AGENT_MCP_DEFAULT_PORT = 54080;
