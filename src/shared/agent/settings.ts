import { AGENT_MCP_DEFAULT_PORT, AGENT_MCP_PATH } from "./protocol";

/**
 * The author's switches for agent access, and the connection details an MCP client needs.
 *
 * Owned by the main process and kept in `<userData>/agent-mcp.json` (mode 0600) rather than in the
 * global settings store, for three reasons. The token is a secret, and `global.json` is a file
 * people export and paste into issues. The import directories are paths on this machine, which mean
 * nothing on the next one a settings export lands on. And every renderer can write the global
 * store, while these switches decide whether an outside program may change a project - so only the
 * Settings window may change them, through handlers that refuse every other window.
 *
 * The same file is what a stdio bridge reads to find the endpoint, which is why the address it is
 * actually served on is written there too.
 *
 * Comments in English per project convention.
 */

/** The name the file has under the profile's user data directory. */
export const AGENT_SETTINGS_FILE_NAME = "agent-mcp.json";

export const AGENT_SETTINGS_SCHEMA_VERSION = 1;

/** One directory `assets_import` may read from. */
export type AgentImportRoot = {
    /** Absolute. */
    path: string;
    /** The macOS security-scoped bookmark the folder picker returned, when it returned one. */
    bookmark?: string;
};

/** The file on disk. */
export type AgentSettingsFile = {
    schemaVersion: typeof AGENT_SETTINGS_SCHEMA_VERSION;
    /** Serve the endpoint. Off by default: nothing listens until the author asks for it. */
    enabled: boolean;
    /** Let write tools through. Off by default. */
    allowWrites: boolean;
    /** The port asked for. The one actually served on may differ - see {@link url}. */
    port: number;
    /** The bearer token every request must carry. */
    token: string;
    /** The endpoint as it is being served right now, or null while it is not. */
    url: string | null;
    allowedImportRoots: AgentImportRoot[];
};

/** What the Settings window is shown. */
export type AgentSettingsSnapshot = {
    enabled: boolean;
    allowWrites: boolean;
    port: number;
    token: string;
    allowedImportRoots: string[];
    /** Whether the endpoint is listening. */
    running: boolean;
    /** The endpoint a client connects to: the live one while running, else the one the port setting gives. */
    url: string;
    /** Why the endpoint is not running although it is enabled, when it failed to start. */
    error: string | null;
    /** The command a stdio-only client runs to reach the endpoint through {@link AGENT_MCP_STDIO_FLAG}. */
    stdio: AgentStdioCommand;
};

/**
 * The command line that starts Studio as a stdio bridge: a process that opens no window, reads
 * JSON-RPC from its standard input and forwards each message to the live endpoint. For clients that
 * can only launch a local program (Claude Desktop without a bridge of its own, some IDEs).
 *
 * It carries no token: the bridge reads the token and the address from {@link AGENT_SETTINGS_FILE_NAME}
 * itself, so a pasted configuration keeps working after the token is replaced or the port moves.
 */
export type AgentStdioCommand = {
    /** Absolute path of the executable. */
    command: string;
    args: string[];
};

/** The command-line flag that turns a Studio launch into the stdio bridge. */
export const AGENT_MCP_STDIO_FLAG = "--mcp-stdio";

/** The changes the Settings window may ask for. Anything absent is left as it is. */
export type AgentSettingsPatch = {
    enabled?: boolean;
    allowWrites?: boolean;
    port?: number;
    /** Remove this directory from the allowed list. Adding one goes through the folder picker. */
    removeImportRoot?: string;
};

/** Lowest port the setting accepts; below it are ports that need privileges on most systems. */
export const AGENT_PORT_MIN = 1024;
export const AGENT_PORT_MAX = 65535;

export function isUsableAgentPort(value: unknown): value is number {
    return typeof value === "number" && Number.isInteger(value) && value >= AGENT_PORT_MIN && value <= AGENT_PORT_MAX;
}

export function agentEndpointUrl(port: number): string {
    return `http://127.0.0.1:${port}${AGENT_MCP_PATH}`;
}

/** The name a client registers the server under. Short, because some clients prefix tool names with it. */
export const AGENT_CLIENT_SERVER_KEY = "narraleaf";

export type AgentClientConfigKind = "claudeCode" | "json" | "opencode" | "stdio";

/**
 * Ready-to-paste configuration for one kind of client.
 *
 * Built in one place so the shapes cannot drift apart: Claude Code takes a command line, most
 * clients (Cursor, Gemini CLI, Claude Desktop through mcp-remote) read the `mcpServers` JSON shape,
 * opencode has its own `mcp` block with `type: "remote"`, and a client that only launches local
 * programs gets the same `mcpServers` shape naming Studio's own executable with
 * {@link AGENT_MCP_STDIO_FLAG}. That last one needs `stdio`, which only main can fill in.
 */
export function buildAgentClientConfig(kind: AgentClientConfigKind, url: string, token: string, stdio?: AgentStdioCommand): string {
    const headers = { Authorization: `Bearer ${token}` };
    switch (kind) {
        case "stdio":
            if (!stdio) {
                throw new Error("The stdio configuration needs the command that starts Studio");
            }
            return JSON.stringify({ mcpServers: { [AGENT_CLIENT_SERVER_KEY]: { command: stdio.command, args: stdio.args } } }, null, 2);
        case "claudeCode":
            return `claude mcp add --transport http ${AGENT_CLIENT_SERVER_KEY} ${url} --header "Authorization: Bearer ${token}"`;
        case "json":
            return JSON.stringify({ mcpServers: { [AGENT_CLIENT_SERVER_KEY]: { type: "http", url, headers } } }, null, 2);
        case "opencode":
            return JSON.stringify({ mcp: { [AGENT_CLIENT_SERVER_KEY]: { type: "remote", url, headers } } }, null, 2);
    }
}

/** Defaults for a profile that has never had agent access configured. The token is filled in by main. */
export function defaultAgentSettings(token: string): AgentSettingsFile {
    return {
        schemaVersion: AGENT_SETTINGS_SCHEMA_VERSION,
        enabled: false,
        allowWrites: false,
        port: AGENT_MCP_DEFAULT_PORT,
        token,
        url: null,
        allowedImportRoots: [],
    };
}

/**
 * Read the file defensively: it is on disk where anyone with the account can edit it, and a
 * malformed field falls back to its default rather than taking agent access down with it. A token
 * that is missing or too short to be a secret comes back empty, which tells main to mint one.
 */
export function normalizeAgentSettings(value: unknown, mintToken: () => string): AgentSettingsFile {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const token = typeof record.token === "string" && record.token.length >= 32 ? record.token : mintToken();
    const roots: AgentImportRoot[] = [];
    if (Array.isArray(record.allowedImportRoots)) {
        const seen = new Set<string>();
        for (const entry of record.allowedImportRoots) {
            const root = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
            const rootPath = typeof root?.path === "string" ? root.path : null;
            if (!rootPath || seen.has(rootPath)) {
                continue;
            }
            seen.add(rootPath);
            roots.push({
                path: rootPath,
                ...(typeof root?.bookmark === "string" && root.bookmark ? { bookmark: root.bookmark } : {}),
            });
        }
    }
    return {
        schemaVersion: AGENT_SETTINGS_SCHEMA_VERSION,
        enabled: record.enabled === true,
        allowWrites: record.allowWrites === true,
        port: isUsableAgentPort(record.port) ? record.port : AGENT_MCP_DEFAULT_PORT,
        token,
        url: typeof record.url === "string" ? record.url : null,
        allowedImportRoots: roots,
    };
}
