import type { AgentClientConfigKind } from "./settings";

/**
 * The agent applications Studio knows how to connect, and for each one where its MCP configuration
 * goes and how it is given the skill.
 *
 * One table, read by first-run setup (which walks an author through connecting the one they use)
 * and by the main process (which installs the skill into the folder named here). Kept apart from
 * `./settings.ts` because nothing here is a setting: it is a fact about other programs, and it
 * changes when they change.
 *
 * Comments in English per project convention.
 */

export type AgentClientId = "claudeCode" | "codex" | "opencode" | "claudeDesktop" | "cursor" | "geminiCli" | "other";

/**
 * How an agent comes to have the skill.
 *
 * - `folder`: it reads skill folders from a directory in the home folder, and Studio copies the
 *   bundled skills there.
 * - `upload`: it takes a skill as a zip uploaded in its own settings, and Studio writes that zip.
 * - `served`: it has no skill folder Studio can rely on, and reads the same guide from Studio's MCP
 *   server instead (the `make_game` prompt, `agent_guide`, `narraleaf://guide/*`).
 */
export type AgentSkillMode = "folder" | "upload" | "served";

export type AgentClientDescriptor = {
    id: AgentClientId;
    /** The product's own name, which is not translated. Null for the catch-all row. */
    name: string | null;
    /** The configuration this client reads. */
    configKind: AgentClientConfigKind;
    /**
     * Whether the configuration is a command run in a terminal rather than text merged into a file.
     * A command is run once; a file entry is merged into whatever the file already holds.
     */
    configIsCommand: boolean;
    /** Where the configuration goes, as the author would find it. Null when it is a command. */
    configFile: string | null;
    skill: AgentSkillMode;
    /**
     * For `folder`: the directory under the home folder that the client reads skills from, as path
     * segments, so main can join it with the platform's separator.
     */
    skillDir?: readonly string[];
};

/**
 * The skill folders Studio installs, from `resources/agent/skills`. The porting skill relies on
 * the first, so the two go together.
 */
export const AGENT_INSTALLED_SKILLS = ["narraleaf-make-game", "narraleaf-port-renpy"] as const;

/** The file name of the zip written for clients that take an uploaded skill. */
export const AGENT_SKILL_ZIP_NAME = "narraleaf-make-game.zip";

/**
 * In the order setup lists them. Codex and opencode share `~/.agents/skills`, which both read; an
 * opencode that also finds the same skill under `~/.claude/skills` reads one copy of the same text.
 */
export const AGENT_CLIENTS: readonly AgentClientDescriptor[] = [
    {
        id: "claudeCode",
        name: "Claude Code",
        configKind: "claudeCode",
        configIsCommand: true,
        configFile: null,
        skill: "folder",
        skillDir: [".claude", "skills"],
    },
    {
        id: "codex",
        name: "Codex",
        configKind: "codex",
        configIsCommand: false,
        configFile: "~/.codex/config.toml",
        skill: "folder",
        skillDir: [".agents", "skills"],
    },
    {
        id: "opencode",
        name: "opencode",
        configKind: "opencode",
        configIsCommand: false,
        configFile: "~/.config/opencode/opencode.json",
        skill: "folder",
        skillDir: [".agents", "skills"],
    },
    {
        id: "claudeDesktop",
        name: "Claude Desktop",
        configKind: "stdio",
        configIsCommand: false,
        configFile: "claude_desktop_config.json",
        skill: "upload",
    },
    {
        id: "cursor",
        name: "Cursor",
        configKind: "json",
        configIsCommand: false,
        configFile: "~/.cursor/mcp.json",
        skill: "served",
    },
    {
        id: "geminiCli",
        name: "Gemini CLI",
        configKind: "gemini",
        configIsCommand: false,
        configFile: "~/.gemini/settings.json",
        skill: "served",
    },
    {
        id: "other",
        name: null,
        configKind: "json",
        configIsCommand: false,
        configFile: null,
        skill: "served",
    },
];

export function findAgentClient(id: unknown): AgentClientDescriptor | null {
    return AGENT_CLIENTS.find(client => client.id === id) ?? null;
}

/** Where one client's skills are installed, and whether the main skill is already there. */
export type AgentSkillTarget = {
    /** The directory, with the home folder written as `~`. */
    displayPath: string;
    installed: boolean;
};

/**
 * What first-run setup is shown to connect an agent. No token: setup shows each configuration with
 * the token masked, and copying it is done by main straight onto the clipboard.
 */
export type AgentClientSetupInfo = {
    /** The endpoint a client connects to. */
    url: string;
    /** The command a stdio-only client runs; see `AgentStdioCommand`. */
    stdio: { command: string; args: string[] };
    /** Keyed by client, for the clients whose skill mode is `folder`. */
    skillTargets: Partial<Record<AgentClientId, AgentSkillTarget>>;
};

/** What installing the skill for one client answered. */
export type AgentSkillInstallResult =
    | { canceled: true }
    | { canceled: false; path: string };

/** Stands for the token in a configuration shown on screen. */
export const AGENT_MASKED_TOKEN = "••••••••";
