import { AGENT_MCP_DEFAULT_PORT, AGENT_MCP_LEGACY_DEFAULT_PORT, AGENT_MCP_PATH } from "./protocol";

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
 * There is no port setting. Which port the endpoint is on is not something an author should need to
 * know to fill in, so Studio picks it: the profile's port, then a fixed run of fallbacks, then any
 * free one, and whichever binds becomes the profile's port - see `AgentManager.startServer`.
 *
 * Comments in English per project convention.
 */

/** The name the file has under the profile's user data directory. */
export const AGENT_SETTINGS_FILE_NAME = "agent-mcp.json";

/**
 * 2: the default port moved from {@link AGENT_MCP_LEGACY_DEFAULT_PORT} to {@link AGENT_MCP_DEFAULT_PORT}.
 * A file from before that names the old default is moved to the new one when it is read.
 */
export const AGENT_SETTINGS_SCHEMA_VERSION = 2;

/** One directory agents may read files from (`assets_import`, a PSD for a layered character). */
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
    /**
     * Full access: write tools are let through whatever {@link allowWrites} says, and an agent may
     * read any folder without being asked - except Studio's own folders (its settings and the app
     * itself), the home folder as a whole and a file-system root, which stay closed. Off by default,
     * and switched on only after the author confirms it in Studio's own window. Kept apart from `allowWrites` so that
     * switching it off again leaves the author's own write setting as it was.
     */
    fullAccess: boolean;
    /**
     * The port the endpoint is tried on first. Rewritten to the port it actually bound whenever it
     * starts, so the next launch lands on the same one and configurations copied with it keep working.
     */
    port: number;
    /** The bearer token every request must carry. */
    token: string;
    /** The endpoint as it is being served right now, or null while it is not. */
    url: string | null;
    allowedImportRoots: AgentImportRoot[];
    /**
     * Plugins whose agent tools the author switched off. A deny list rather than an allow list:
     * a plugin's tools are on unless the author says otherwise, because the install prompt already
     * told them the plugin offers tools (`contributes.agentTools`, with how many change the project).
     *
     * What the switches above hold a plugin tool to is what the plugin declared about it. A tool
     * declared `write: true` is refused unless `allowWrites` (or `fullAccess`) is on, and while the
     * agent is paused, the project frozen or a live session running. A tool declared `write: false`
     * is not gated by any of them: while it runs, the host refuses only the plugin's own storage
     * writes (`services.storage.writeJson`). Anything else the plugin's `app` can do, its handler
     * can do too, so how far a reading tool reaches is how far the plugin itself is trusted - which
     * is the question the install prompt asked, not this switch.
     */
    blockedPluginTools: string[];
};

/** One installed plugin that offers agent tools, as Settings lists it. */
export type AgentPluginToolsSetting = {
    pluginId: string;
    /** The manifest's name; the panel shows the plugin's `localized` name for the editor language. */
    name: string;
    localized?: Record<string, { name?: string; description?: string }>;
    /** How many tools it declares, and how many of them change the project. */
    tools: number;
    writeTools: number;
    /** The author has not switched them off. */
    allowed: boolean;
    builtIn: boolean;
};

/** What the Settings window is shown. */
export type AgentSettingsSnapshot = {
    enabled: boolean;
    allowWrites: boolean;
    /** See {@link AgentSettingsFile.fullAccess}. */
    fullAccess: boolean;
    token: string;
    allowedImportRoots: string[];
    /** Whether the endpoint is listening. */
    running: boolean;
    /** The endpoint a client connects to: the live one while running, else the one the profile's port gives. */
    url: string;
    /** Why the endpoint is not running although it is enabled, when it failed to start. */
    error: string | null;
    /**
     * The port the endpoint moved to when it last started, while configurations copied before still
     * name the port it had; null once a configuration has been copied since, or when it did not move.
     * A stdio bridge reads the live address itself and is not affected.
     */
    movedToPort: number | null;
    /** The command a stdio-only client runs to reach the endpoint through {@link AGENT_MCP_STDIO_FLAG}. */
    stdio: AgentStdioCommand;
    /** Installed, enabled plugins that offer agent tools, with whether the author allows them. */
    pluginTools: AgentPluginToolsSetting[];
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
    /** Turning it on is confirmed in the agent access window first; see `AgentManager`. */
    fullAccess?: boolean;
    /** The author copied a configuration with the current address, so {@link AgentSettingsSnapshot.movedToPort} is answered. */
    acknowledgeMovedPort?: true;
    /** Remove this directory from the allowed list. Adding one goes through the folder picker. */
    removeImportRoot?: string;
    /** Allow or switch off one plugin's agent tools. */
    pluginTools?: { pluginId: string; allowed: boolean };
};

/** Lowest port the file may name; below it are ports that need privileges on most systems. */
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
            // `--scope user`: an author asks for a game from whatever folder their terminal is in, and
            // without it the server is registered for the one folder the command happened to run in.
            return `claude mcp add --scope user --transport http ${AGENT_CLIENT_SERVER_KEY} ${url} --header "Authorization: Bearer ${token}"`;
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
        fullAccess: false,
        port: AGENT_MCP_DEFAULT_PORT,
        token,
        url: null,
        allowedImportRoots: [],
        blockedPluginTools: [],
    };
}

/**
 * Whether the file was written before schema 2 and names the old default port. Such a profile is
 * moved to the new default once: the port was editable then, so a profile that picked 54080 by hand
 * cannot be told apart from one that never touched it, and the old default sits in the range where
 * Windows reserves ports. Schema 2 records that the move was made, so a profile that lands on 54080
 * later (a port the system handed out) keeps it.
 */
export function namesLegacyDefaultPort(value: unknown): boolean {
    const record = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
    const schemaVersion = typeof record.schemaVersion === "number" ? record.schemaVersion : 1;
    return schemaVersion < 2 && record.port === AGENT_MCP_LEGACY_DEFAULT_PORT;
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
        fullAccess: record.fullAccess === true,
        port: isUsableAgentPort(record.port) && !namesLegacyDefaultPort(record) ? record.port : AGENT_MCP_DEFAULT_PORT,
        token,
        url: typeof record.url === "string" ? record.url : null,
        allowedImportRoots: roots,
        blockedPluginTools: Array.isArray(record.blockedPluginTools)
            ? [...new Set(record.blockedPluginTools.filter((id): id is string => typeof id === "string" && id.length > 0 && id.length <= 200))]
            : [],
    };
}
