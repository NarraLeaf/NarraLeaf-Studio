import crypto from "crypto";
import path from "path";
import { shell } from "electron";
import { unpatchedFs, unpatchedFsPromises as fs } from "../../../../utils/unpatchedFs";
import { IPCEventType } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { findProjectConfigFileName } from "@shared/utils/nlproj";
import { PROJECT_TEMPLATES_DIR } from "@shared/constants/projectTemplate";
import type { CommandLineRunEvent, CommandLineRunJob, CommandLineRunLogLine } from "@shared/types/commandLineRun";
import type { AppEventToken } from "@shared/types/app";
import {
    AGENT_INTERNAL_TOOL_STATE,
    AGENT_INTERNAL_TOOL_TEST,
    agentRefusal,
    agentText,
    type AgentCallRequest,
    type AgentCallResult,
    type AgentFolderAccessAnswer,
    type AgentFolderAccessRequest,
    type AgentSessionPolicy,
    type AgentWorkspaceState,
} from "@shared/agent/protocol";
import { AGENT_TOOLS, AGENT_TOOLS_BY_NAME, type AgentGuideChapter, type AgentToolDescriptor } from "@shared/agent/tools";
import {
    isAgentPluginToolDescriptor,
    looksLikeAgentPluginToolName,
    readAgentPluginToolDescriptor,
    type AgentPluginToolDescriptor,
} from "@shared/agent/pluginTools";
import {
    agentEndpointUrl,
    buildAgentClientConfig,
    isUsableAgentPort,
    AGENT_PORT_MAX,
    AGENT_PORT_MIN,
    type AgentPluginToolsSetting,
    type AgentSettingsPatch,
    type AgentSettingsSnapshot,
} from "@shared/agent/settings";
import {
    AGENT_SKILL_EXPORT_FOLDER,
    toAgentQuickState,
    type AgentCopyConfigKind,
    type AgentQuickTogglePatch,
} from "@shared/agent/workspaceAccess";
import type { App } from "../../../app";
import type { AppWindow } from "../window/appWindow";
import { IPC_PAGE_GONE } from "../window/ipcHost";
import { dialogTranslator, showOpenDialog } from "../window/fileDialog";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import { defaultTestEdition } from "../../utils/testEdition";
import { resolveDefaultProjectDirectory } from "../../defaultProjectDirectory";
import { AgentMcpServer, type AgentCallContext, type AgentMcpHost } from "./agentMcpServer";
import { AgentSettingsStore, mintAgentToken } from "./agentSettingsStore";
import { agentStdioCommand } from "./agentStdioMain";
import { chooseAgentWorkspace, writeNeedsNamedProject, type AgentRoutingChoice } from "./agentRouting";
import {
    AGENT_MAIN_TOOL_HANDLERS,
    noWorkspace,
    type AgentMainToolHost,
    type AgentOpenProjectOutcome,
    type AgentPluginGuideEntry,
    type AgentWorkspaceHandle,
} from "./agentMainTools";
import { writeAgentProject, type AgentProjectCreateInput } from "./agentProjectCreate";
import { guideFileCandidates, pluginGuideFile, stripFrontMatter, AGENT_PLUGIN_GUIDE_MAX_BYTES } from "./agentGuide";
import { agentCallTimeoutMs } from "./agentCallTimeout";
import { activityProjectPath, copySkillTree, isNonEmptyDirectory, mainActivity } from "./agentWorkspaceAccess";
import { AgentFolderAccess, type AgentFolderPrompt, type AgentFolderRules } from "./agentFolderAccess";
import type { AgentAccessPromptProps } from "@shared/types/agentAccess";

/**
 * Agent access, as the rest of Studio sees it: the author's switches, the MCP endpoint they control,
 * and the hop from a tool call to the workspace window that carries it out.
 *
 * Everything an agent can reach goes through {@link callTool}: arguments have already been checked
 * against the tool's schema by the server, so what is decided here is the author's say - write
 * access - and where the call goes. Main-side tools are answered by `agentMainTools.ts`; everything
 * else travels to a workspace on `workspaceAgentCall`, with the author's switches attached so the
 * renderer can re-check them without a second channel.
 *
 * One manager per app. Started after Electron is ready, and never in a command-line run - a job
 * leaves nothing listening on the machine.
 */
export class AgentManager implements AgentMainToolHost {
    private readonly store: AgentSettingsStore;
    private server: AgentMcpServer | null = null;
    private lastError: string | null = null;
    private readonly focusedAt = new WeakMap<AppWindow, number>();
    /** Import roots already granted to each workspace, so a grant is not stacked on every call. */
    private readonly grantedRoots = new WeakMap<AppWindow, Set<string>>();
    private readonly projectNames = new Map<string, string | null>();
    /** What the last skill export from each window wrote, so "show in folder" needs no path from the renderer. */
    private readonly exportedSkillDirs = new WeakMap<AppWindow, string>();
    /** Serializes start/stop so two quick toggles cannot leave two servers or none. */
    private lifecycle: Promise<void> = Promise.resolve();
    private initialized = false;
    /** The plugin tools each workspace last reported, already checked. */
    private readonly reportedPluginTools = new Map<AppWindow<WindowAppType.Workspace>, AgentPluginToolDescriptor[]>();
    private readonly pluginToolWindowsWatched = new WeakSet<AppWindow>();
    /** What `tools/list` last answered, as a comparable string, so a report that changes nothing notifies nobody. */
    private advertisedPluginTools = "";
    /** Calls sent to a workspace and not answered yet, by call id: what a folder request is checked against. */
    private readonly inFlight = new Map<string, InFlightCall>();
    private readonly folderAccess = new AgentFolderAccess<AppWindow>({
        rules: () => this.folderRules(),
        allowedFolders: window => this.allowedFolders(window),
        fullAccess: () => this.store.current.fullAccess,
        isClosed: window => window.isClosed(),
        ask: (window, folders, prompt) => this.askFolderAccess(window, folders, prompt),
        remember: folders => this.rememberImportRoots(folders),
        grant: (window, folders) => this.grantFolders(window, folders),
        now: () => Date.now(),
        warn: message => this.app.logger.warn(`[Agent] ${message}`),
    });

    constructor(private readonly app: App) {
        this.store = new AgentSettingsStore(app.getUserDataDir());
    }

    public async initialize(): Promise<void> {
        if (this.initialized) {
            return;
        }
        this.initialized = true;
        const settings = await this.store.load();
        this.app.electronApp.on("browser-window-focus", (_event, browserWindow) => {
            const window = this.app.windowManager.getWindowByWebContents(browserWindow.webContents);
            if (window) {
                this.focusedAt.set(window, Date.now());
            }
        });
        this.app.electronApp.on("before-quit", () => {
            void this.server?.stop();
        });
        if (settings.enabled) {
            await this.serialize(() => this.startServer());
        }
    }

    // ── Settings ─────────────────────────────────────────────────────────────────────────────────

    public async snapshot(): Promise<AgentSettingsSnapshot> {
        const settings = await this.store.load();
        const livePort = this.server?.port ?? null;
        return {
            enabled: settings.enabled,
            allowWrites: settings.allowWrites,
            fullAccess: settings.fullAccess,
            port: settings.port,
            token: settings.token,
            allowedImportRoots: settings.allowedImportRoots.map(root => root.path),
            running: livePort !== null,
            url: agentEndpointUrl(livePort ?? settings.port),
            error: settings.enabled && livePort === null ? this.lastError : null,
            stdio: agentStdioCommand(this.app.electronApp),
            pluginTools: await this.pluginToolSettings(settings.blockedPluginTools),
        };
    }

    /** Installed, enabled plugins that declare agent tools, for the Settings list. */
    private async pluginToolSettings(blocked: readonly string[]): Promise<AgentPluginToolsSetting[]> {
        try {
            const plugins = await this.app.pluginManager.listPlugins();
            return plugins
                .filter(plugin => plugin.enabled && (plugin.manifest.contributes.agentTools ?? []).length > 0)
                .map(plugin => {
                    const tools = plugin.manifest.contributes.agentTools ?? [];
                    return {
                        pluginId: plugin.pluginId,
                        name: plugin.manifest.name,
                        ...(plugin.manifest.localized ? { localized: plugin.manifest.localized } : {}),
                        tools: tools.length,
                        writeTools: tools.filter(tool => tool.write).length,
                        allowed: !blocked.includes(plugin.pluginId),
                        builtIn: plugin.builtIn,
                    };
                })
                .sort((a, b) => Number(b.builtIn) - Number(a.builtIn) || a.name.localeCompare(b.name));
        } catch (error) {
            this.app.logger.warn(`[Agent] Could not list plugins with agent tools: ${describe(error)}`);
            return [];
        }
    }

    /**
     * Apply a change from the Settings window or the Agent menu. `confirmWith` is the window asking:
     * turning full access on is put to the author in the agent access window over it first, and the
     * rest of the patch still applies when they decline.
     */
    public async updateSettings(patch: AgentSettingsPatch, confirmWith?: AppWindow): Promise<AgentSettingsSnapshot> {
        if (patch.port !== undefined && !isUsableAgentPort(patch.port)) {
            throw new Error(`The port must be a whole number from ${AGENT_PORT_MIN} to ${AGENT_PORT_MAX}.`);
        }
        const before = await this.store.load();
        if (patch.fullAccess === true && !before.fullAccess && confirmWith && !(await this.confirmFullAccess(confirmWith))) {
            patch = { ...patch, fullAccess: undefined };
        }
        const wasEnabled = before.enabled;
        const previousPort = before.port;
        const after = await this.store.update(draft => {
            if (typeof patch.enabled === "boolean") {
                draft.enabled = patch.enabled;
            }
            if (typeof patch.allowWrites === "boolean") {
                draft.allowWrites = patch.allowWrites;
            }
            if (typeof patch.fullAccess === "boolean") {
                draft.fullAccess = patch.fullAccess;
            }
            if (patch.port !== undefined) {
                draft.port = patch.port;
            }
            if (typeof patch.removeImportRoot === "string") {
                const target = normalizeProjectPath(path.resolve(patch.removeImportRoot));
                draft.allowedImportRoots = draft.allowedImportRoots.filter(root =>
                    normalizeProjectPath(path.resolve(root.path)) !== target,
                );
            }
            const pluginTools = patch.pluginTools;
            if (pluginTools && typeof pluginTools.pluginId === "string" && pluginTools.pluginId && typeof pluginTools.allowed === "boolean") {
                const others = draft.blockedPluginTools.filter(id => id !== pluginTools.pluginId);
                draft.blockedPluginTools = pluginTools.allowed ? others : [...others, pluginTools.pluginId];
            }
        });
        if (after.blockedPluginTools.join() !== before.blockedPluginTools.join()) {
            this.app.logger.info(`[Agent] Plugin tools switched off for: ${after.blockedPluginTools.join(", ") || "none"}`);
            this.pluginToolsMaybeChanged();
        }
        if (after.allowWrites !== before.allowWrites) {
            this.app.logger.info(`[Agent] Write access ${after.allowWrites ? "allowed" : "withdrawn"}`);
        }
        if (after.fullAccess !== before.fullAccess) {
            this.app.logger.info(`[Agent] Full access ${after.fullAccess ? "allowed" : "withdrawn"}`);
        }
        if (after.enabled && (!wasEnabled || after.port !== previousPort || !this.server)) {
            await this.serialize(async () => {
                await this.stopServer();
                await this.startServer();
            });
        } else if (!after.enabled && wasEnabled) {
            await this.serialize(() => this.stopServer());
        }
        const snapshot = await this.snapshot();
        this.broadcastQuickState(snapshot);
        return snapshot;
    }

    public async regenerateToken(): Promise<AgentSettingsSnapshot> {
        await this.store.update(draft => {
            draft.token = mintAgentToken();
        });
        this.app.logger.info("[Agent] Token replaced; clients with the old one are no longer let in");
        return this.snapshot();
    }

    public async addImportRoot(window: AppWindow): Promise<AgentSettingsSnapshot> {
        const { t } = dialogTranslator(window);
        const result = await showOpenDialog(window, {
            title: t("dialogs.file.title.selectFolder"),
            properties: ["openDirectory"],
            buttonLabel: t("dialogs.file.button.open"),
            securityScopedBookmarks: true,
        });
        if (!result.canceled && result.filePaths[0]) {
            const chosen = path.resolve(result.filePaths[0]);
            const bookmark = result.bookmarks?.[0];
            await this.store.update(draft => {
                const identity = normalizeProjectPath(chosen);
                if (!draft.allowedImportRoots.some(root => normalizeProjectPath(path.resolve(root.path)) === identity)) {
                    draft.allowedImportRoots.push({ path: chosen, ...(bookmark ? { bookmark } : {}) });
                }
            });
        }
        return this.snapshot();
    }

    public policy(): AgentSessionPolicy {
        const settings = this.store.current;
        return {
            // Full access lets writes through without rewriting the author's own write switch, so
            // switching it off again leaves that switch as they set it.
            writesEnabled: settings.allowWrites || settings.fullAccess,
            allowedImportRoots: settings.allowedImportRoots.map(root => path.resolve(root.path)),
            blockedPluginIds: [...settings.blockedPluginTools],
            fullAccess: settings.fullAccess,
        };
    }

    // ── Plugin tools ─────────────────────────────────────────────────────────────────────────────
    //
    // A workspace reports the agent tools its plugins registered, the whole set on every change;
    // `tools/list` is the built-in table plus the union of what the open workspaces reported, less
    // the plugins the author switched off. Reports are read as untrusted - a workspace runs plugin
    // code - so each descriptor is checked, and a window's tools are forgotten when it closes.

    /** A workspace's report. Called by the IPC handler; `tools` is whatever the window sent. */
    public reportPluginTools(window: AppWindow<WindowAppType.Workspace>, tools: unknown): void {
        const checked = Array.isArray(tools)
            ? tools.slice(0, 500).map(readAgentPluginToolDescriptor).filter((tool): tool is AgentPluginToolDescriptor => tool !== null)
            : [];
        if (checked.length > 0) {
            this.reportedPluginTools.set(window, checked);
        } else {
            this.reportedPluginTools.delete(window);
        }
        if (!this.pluginToolWindowsWatched.has(window)) {
            this.pluginToolWindowsWatched.add(window);
            // "closed", not onClose: a close request a workspace's guard cancels must not take the
            // window's tools away while it stays open.
            window.onEvent("closed", () => {
                this.reportedPluginTools.delete(window);
                this.pluginToolsMaybeChanged();
            });
        }
        this.pluginToolsMaybeChanged();
    }

    /** The plugin tools `tools/list` offers: open workspaces' reports, first report wins a name, blocked plugins left out. */
    private pluginTools(): AgentPluginToolDescriptor[] {
        const blocked = new Set(this.store.current.blockedPluginTools);
        const byName = new Map<string, AgentPluginToolDescriptor>();
        for (const window of this.workspaceWindows()) {
            for (const tool of this.reportedPluginTools.get(window) ?? []) {
                if (!blocked.has(tool.pluginId) && !byName.has(tool.name)) {
                    byName.set(tool.name, tool);
                }
            }
        }
        return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
    }

    public listTools(): readonly AgentToolDescriptor[] {
        return [...AGENT_TOOLS, ...this.pluginTools()];
    }

    public findTool(name: string): AgentToolDescriptor | null {
        return AGENT_TOOLS_BY_NAME.get(name) ?? this.pluginTools().find(tool => tool.name === name) ?? null;
    }

    /** Why a plugin-shaped name is no tool right now, in words the agent can act on. */
    public unknownTool(name: string): AgentCallResult | null {
        if (!looksLikeAgentPluginToolName(name)) {
            return null;
        }
        const offered = [...this.reportedPluginTools.values()].flat().find(tool => tool.name === name);
        if (offered && this.store.current.blockedPluginTools.includes(offered.pluginId)) {
            return agentRefusal(
                "unavailable",
                `The author switched off the agent tools of the plugin ${offered.pluginId}.`,
                "Ask the author to allow them in Studio's Settings > Agent access, or do the work in Studio's own tools.",
            );
        }
        return agentRefusal(
            "unknown_tool",
            `No project open in Studio has a plugin offering "${name}" - the plugin is not loaded in any open project.`,
            "Plugin tools come from the plugins an open project loads. Open the project (project_open), check agent_status, then call tools/list again.",
        );
    }

    public pluginToolsOf(handle: AgentWorkspaceHandle): string[] {
        const window = (handle as AgentWorkspaceHandle & { window?: AppWindow<WindowAppType.Workspace> }).window;
        const blocked = new Set(this.store.current.blockedPluginTools);
        return (window ? this.reportedPluginTools.get(window) ?? [] : [])
            .filter(tool => !blocked.has(tool.pluginId))
            .map(tool => tool.name)
            .sort();
    }

    private pluginToolsMaybeChanged(): void {
        const signature = JSON.stringify(this.pluginTools().map(tool => [tool.name, tool.write, tool.title, tool.description, tool.inputSchema]));
        if (signature === this.advertisedPluginTools) {
            return;
        }
        this.advertisedPluginTools = signature;
        this.server?.notifyToolsChanged();
    }

    public endpointUrl(): string | null {
        const port = this.server?.port;
        return port ? agentEndpointUrl(port) : null;
    }

    // ── The workspace's Agent menu ───────────────────────────────────────────────────────────────
    //
    // A narrower door onto the same switches, for workspace windows. Nothing here hands the token
    // or the address to the caller: the handlers project every answer through `toAgentQuickState`.

    /**
     * Flip agent access or write access on behalf of a workspace's menu.
     *
     * Turning agent access ON, and turning write access ON, are each confirmed in the agent access
     * window over the asking one. A workspace runs plugin code, and a plugin must not be able to
     * open the endpoint - or grant every connected agent write access - by calling this; a window of
     * Studio's own is something it cannot draw or answer. Agent access is confirmed as well as
     * writes because reading is not harmless either: a plugin that switched the endpoint on could
     * copy the client configuration to the clipboard and read the token back, and with it read
     * every project open in Studio through the endpoint. Switching off needs no confirmation -
     * withdrawing access is always safe.
     *
     * The Settings window's switches go through `updateSettings` directly, unconfirmed: that window
     * is Studio's own and runs no plugin code, so its switch is already the author's answer.
     */
    public async quickToggle(window: AppWindow, patch: AgentQuickTogglePatch): Promise<AgentSettingsSnapshot> {
        const current = await this.store.load();
        const next: AgentSettingsPatch = {};
        if (typeof patch.enabled === "boolean") {
            if (patch.enabled && !current.enabled && !(await this.confirmEnable(window))) {
                return this.snapshot();
            }
            next.enabled = patch.enabled;
        }
        if (typeof patch.allowWrites === "boolean") {
            if (patch.allowWrites && !current.allowWrites && !(await this.confirmAllowWrites(window))) {
                return this.snapshot();
            }
            next.allowWrites = patch.allowWrites;
        }
        if (typeof patch.fullAccess === "boolean") {
            // Confirmed by `updateSettings`, against the same window.
            next.fullAccess = patch.fullAccess;
        }
        if (next.enabled === undefined && next.allowWrites === undefined && next.fullAccess === undefined) {
            return this.snapshot();
        }
        return this.updateSettings(next, window);
    }

    private async confirmEnable(window: AppWindow): Promise<boolean> {
        window.refuseUnattendedPrompt("Agent access asked whether to turn agent access on");
        return this.askInStudioWindow(window, { kind: "enable" }, true);
    }

    private async confirmAllowWrites(window: AppWindow): Promise<boolean> {
        window.refuseUnattendedPrompt("Agent access asked whether agents may make changes");
        return this.askInStudioWindow(window, { kind: "allowWrites" }, true);
    }

    /**
     * Full access is the widest thing agent access can hand out - writes, and every folder but
     * Studio's own without asking - so it is confirmed from the Settings window as well as
     * from a workspace's menu, unlike write access alone, which the Settings switch turns on directly.
     */
    private async confirmFullAccess(window: AppWindow): Promise<boolean> {
        window.refuseUnattendedPrompt("Agent access asked whether agents may have full access");
        return this.askInStudioWindow(window, { kind: "fullAccess" }, true);
    }

    /**
     * Every question agent access puts to the author goes through here, into Studio's own agent
     * access window (`AgentAccessApp`) rather than a native message box: the same look as the rest
     * of Studio, and still out of reach of the workspace that asked, which runs plugin code. What the
     * window shows is these props, held by main; it sends back only the answer. Anything but an
     * explicit "Allow" - Escape, closing it, its parent going away - is "no".
     */
    private async askInStudioWindow(window: AppWindow, props: AgentAccessPromptProps, activate: boolean): Promise<boolean> {
        const result = await this.app.askAgentAccess(window, props, { activate });
        return result?.allowed === true;
    }

    /** One client configuration with the endpoint and token filled in. Main only: it goes to the clipboard from here. */
    public async clientConfig(kind: AgentCopyConfigKind): Promise<string> {
        const snapshot = await this.snapshot();
        return buildAgentClientConfig(kind, snapshot.url, snapshot.token, snapshot.stdio);
    }

    /**
     * Copy the bundled skill (`resources/agent/skills`: the skill folder, README, AGENTS.md and the
     * client configurations) into `<picked>/NarraLeaf-Skills`. Writing into a folder that already
     * holds something is confirmed first; files of the same name are replaced and nothing else in
     * it is removed.
     */
    public async exportSkill(window: AppWindow): Promise<{ canceled: true } | { canceled: false; path: string }> {
        const { t } = dialogTranslator(window);
        const source = this.app.resolveResource(path.join("agent", "skills"));
        const picked = await showOpenDialog(window, {
            title: t("workspace.agent.confirm.exportSkill.title"),
            properties: ["openDirectory", "createDirectory"],
            buttonLabel: t("dialogs.file.button.exportHere"),
        });
        if (picked.canceled || !picked.filePaths[0]) {
            return { canceled: true };
        }
        const target = path.join(path.resolve(picked.filePaths[0]), AGENT_SKILL_EXPORT_FOLDER);
        if (await isNonEmptyDirectory(fs, target)) {
            window.refuseUnattendedPrompt("Agent skill export asked whether to write into an existing folder");
            const replace = await this.askInStudioWindow(
                window,
                { kind: "exportOverwrite", folder: AGENT_SKILL_EXPORT_FOLDER, path: target },
                true,
            );
            if (!replace) {
                return { canceled: true };
            }
        }
        const copied = await copySkillTree(fs, source, target);
        this.exportedSkillDirs.set(window, target);
        this.app.logger.info(`[Agent] Exported the agent skill to ${target} (${copied} files)`);
        return { canceled: false, path: target };
    }

    /** Show what the last export from this window wrote. False when it exported nothing yet. */
    public revealExportedSkill(window: AppWindow): boolean {
        const target = this.exportedSkillDirs.get(window);
        if (!target) {
            return false;
        }
        shell.showItemInFolder(target);
        return true;
    }

    /**
     * Tell every workspace's Agent menu what agent access looks like now - and the Settings window,
     * whose panel reads its full snapshot again when a menu changed something behind it.
     */
    private broadcastQuickState(snapshot: AgentSettingsSnapshot): void {
        const state = toAgentQuickState(snapshot);
        const settingsWindows = this.app.windowManager.getWindows().filter(window =>
            window.getWindowType() === WindowAppType.Settings && !window.isClosed(),
        );
        for (const window of [...this.workspaceWindows(), ...settingsWindows]) {
            try {
                window.sendIpcEvent(IPCEventType.agentQuickStateChanged, state);
            } catch {
                // A window going away between the list and the send has nothing to update.
            }
        }
    }

    // ── Server lifecycle ─────────────────────────────────────────────────────────────────────────

    private serialize(run: () => Promise<void>): Promise<void> {
        const next = this.lifecycle.then(run, run);
        this.lifecycle = next.catch(() => undefined);
        return next;
    }

    private async startServer(): Promise<void> {
        if (this.server) {
            return;
        }
        const server = new AgentMcpServer({
            port: this.store.current.port,
            token: () => this.store.current.token,
            host: this.serverHost(),
        });
        try {
            const port = await server.start();
            this.server = server;
            this.lastError = null;
            const url = agentEndpointUrl(port);
            await this.store.update(draft => {
                draft.url = url;
            });
            this.app.logger.info(`[Agent] MCP endpoint listening on ${url}`);
        } catch (error) {
            this.lastError = describe(error);
            this.app.logger.warn(`[Agent] MCP endpoint could not start: ${this.lastError}`);
        }
    }

    private async stopServer(): Promise<void> {
        const server = this.server;
        this.server = null;
        if (!server) {
            return;
        }
        await server.stop();
        await this.store.update(draft => {
            draft.url = null;
        });
        this.app.logger.info("[Agent] MCP endpoint stopped");
    }

    private serverHost(): AgentMcpHost {
        return {
            callTool: (tool, args, context) => this.callTool(tool, args, context),
            readGuide: chapter => this.readGuide(chapter),
            listTools: () => this.listTools(),
            findTool: name => this.findTool(name),
            unknownTool: name => this.unknownTool(name),
            listPluginGuides: () => this.listPluginGuides(),
            readPluginGuide: pluginId => this.readPluginGuide(pluginId),
            version: () => {
                try {
                    return this.app.getAppInfo().version;
                } catch {
                    return "0.0.0";
                }
            },
            log: (level, message) => (level === "warn" ? this.app.logger.warn(message) : this.app.logger.info(message)),
        };
    }

    // ── Calls ────────────────────────────────────────────────────────────────────────────────────

    /**
     * Every call an agent makes. Calls answered here in main - main-side tools, and the refusals
     * made before routing - are also reported to the workspace's Agent log; a call that reaches a
     * workspace is logged there by the bridge that carries it out.
     */
    public async callTool(tool: AgentToolDescriptor, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult> {
        const started = Date.now();
        const outcome = await this.dispatchTool(tool, args, context);
        if (outcome.answeredInMain) {
            this.reportActivity(tool, args, outcome.result, context.clientName, Date.now() - started);
        }
        return outcome.result;
    }

    private async dispatchTool(
        tool: AgentToolDescriptor,
        args: Record<string, unknown>,
        context: AgentCallContext,
    ): Promise<{ result: AgentCallResult; answeredInMain: boolean }> {
        const inMain = (result: AgentCallResult) => ({ result, answeredInMain: true });
        if (tool.write && !this.policy().writesEnabled) {
            return inMain(agentRefusal(
                "writes_disabled",
                `${tool.name} changes the project, and the author has not allowed agents to change projects.`,
                "Ask the author to turn on \"Allow agents to change projects\" in Studio's Settings > Agent access. Read tools keep working meanwhile.",
            ));
        }
        const unnamed = await this.refuseUnnamedWrite(tool, args);
        if (unnamed) {
            return inMain(unnamed);
        }
        if (tool.side === "main") {
            const handler = AGENT_MAIN_TOOL_HANDLERS[tool.name];
            if (!handler) {
                return inMain(agentRefusal("unknown_tool", `${tool.name} has no handler in this Studio.`));
            }
            return inMain(await handler(this, args, context));
        }
        if (isAgentPluginToolDescriptor(tool) && this.store.current.blockedPluginTools.includes(tool.pluginId)) {
            return inMain(this.unknownTool(tool.name) ?? agentRefusal("unavailable", `The plugin ${tool.pluginId}'s agent tools are switched off.`));
        }
        const project = typeof args.project === "string" && args.project ? path.resolve(args.project) : null;
        const choice = this.route(project);
        if (!choice.ok) {
            return inMain(noWorkspace(choice));
        }
        if (isAgentPluginToolDescriptor(tool)) {
            // Routed like any workspace tool, by `project`; the project it lands in must be one whose
            // plugins offer the tool, since a plugin tool is not in every window.
            const window = (choice.window as AgentWorkspaceHandle & { window?: AppWindow<WindowAppType.Workspace> }).window;
            const here = window ? this.reportedPluginTools.get(window) ?? [] : [];
            if (!here.some(candidate => candidate.name === tool.name)) {
                const elsewhere = this.workspaceWindows()
                    .filter(candidate => (this.reportedPluginTools.get(candidate) ?? []).some(entry => entry.name === tool.name))
                    .map(candidate => path.resolve(candidate.getProps().projectPath));
                return inMain(agentRefusal(
                    "unknown_tool",
                    `The plugin ${tool.pluginId} is not loaded in ${choice.window.projectPath}, so ${tool.name} is not available there.`,
                    elsewhere.length > 0
                        ? `Projects that offer it: ${elsewhere.join(", ")}. Pass one as \`project\`.`
                        : "Call tools/list again for the tools the open projects offer.",
                ));
            }
        }
        return { result: await this.forward(choice.window, tool.name, args, context), answeredInMain: false };
    }

    /**
     * A write that does not say which project it is for while more than one is open: refused rather
     * than sent to the window focused last (see {@link writeNeedsNamedProject}), naming the open
     * projects the way `agent_status` does. Only tools routed by `project` - every workspace tool,
     * and the main tools that take one; `project_create` writes too, but into a project of its own.
     */
    private async refuseUnnamedWrite(tool: AgentToolDescriptor, args: Record<string, unknown>): Promise<AgentCallResult | null> {
        const requested = typeof args.project === "string" && args.project ? args.project : null;
        const routed = tool.side === "workspace" || Object.prototype.hasOwnProperty.call(tool.inputSchema.properties ?? {}, "project");
        if (!routed || !writeNeedsNamedProject(tool.write, requested, this.workspaceWindows().length)) {
            return null;
        }
        const open = await this.openWorkspaces();
        return agentRefusal(
            "no_workspace",
            `${tool.name} changes a project, and ${open.length} projects are open in Studio; a write must say which one it is for.`,
            `Pass \`project\` with the path of one of them: ${open.map(handle => `${handle.name ?? path.basename(handle.projectPath)} (${handle.projectPath})`).join(", ")}.`,
        );
    }

    /**
     * Send one main-answered call to the Agent log of the window it concerns, or of every workspace
     * when it concerns none (the session status, a guide chapter, a project that is not open).
     * Fire-and-forget: a log line is never worth delaying or failing the call for.
     */
    private reportActivity(descriptor: AgentToolDescriptor, args: Record<string, unknown>, result: AgentCallResult, clientName: string | null, durationMs: number): void {
        const tool = descriptor.name;
        try {
            const activity = {
                ...mainActivity(tool, args, result, clientName, durationMs),
                ...(isAgentPluginToolDescriptor(descriptor)
                    ? { pluginId: descriptor.pluginId, title: descriptor.title, write: descriptor.write }
                    : {}),
            };
            const projectPath = activityProjectPath(tool, args, result);
            const windows = this.workspaceWindows();
            const concerned = projectPath ? windows.filter(window => identity(window.getProps().projectPath) === identity(projectPath)) : [];
            for (const window of concerned.length > 0 ? concerned : windows) {
                window.sendIpcEvent(IPCEventType.workspaceAgentActivity, activity);
            }
        } catch (error) {
            this.app.logger.warn(`[Agent] Could not report ${tool} to the Agent log: ${describe(error)}`);
        }
    }

    /** Workspace windows an agent may address: open, and not a headless command-line run. */
    private workspaceWindows(): AppWindow<WindowAppType.Workspace>[] {
        return this.app.windowManager.getWindows().filter((window): window is AppWindow<WindowAppType.Workspace> =>
            window.getWindowType() === WindowAppType.Workspace
            && !window.isClosed()
            && !(window as AppWindow<WindowAppType.Workspace>).getProps().commandLineRun,
        );
    }

    private handleFor(window: AppWindow<WindowAppType.Workspace>): AgentWorkspaceHandle & { window: AppWindow<WindowAppType.Workspace> } {
        const projectPath = path.resolve(window.getProps().projectPath);
        return { projectPath, name: this.projectNames.get(identity(projectPath)) ?? null, window };
    }

    public async openWorkspaces(): Promise<AgentWorkspaceHandle[]> {
        const windows = this.workspaceWindows();
        await Promise.all(windows.map(async window => {
            const projectPath = path.resolve(window.getProps().projectPath);
            if (!this.projectNames.has(identity(projectPath))) {
                const config = await readProjectConfigFromDir(projectPath).catch(() => null);
                this.projectNames.set(identity(projectPath), config?.name ?? null);
            }
        }));
        return windows.map(window => this.handleFor(window));
    }

    public route(project: string | null): AgentRoutingChoice<AgentWorkspaceHandle> {
        const candidates = this.workspaceWindows().map(window => ({
            window: this.handleFor(window) as AgentWorkspaceHandle,
            projectPath: path.resolve(window.getProps().projectPath),
            lastFocusedAt: this.focusedAt.get(window) ?? 0,
        }));
        return chooseAgentWorkspace(project, candidates, identity);
    }

    public async workspaceState(handle: AgentWorkspaceHandle): Promise<AgentWorkspaceState | null> {
        const window = (handle as AgentWorkspaceHandle & { window?: AppWindow<WindowAppType.Workspace> }).window;
        if (!window) {
            return null;
        }
        return this.askState(window, STATE_TIMEOUT_MS);
    }

    private async askState(window: AppWindow<WindowAppType.Workspace>, timeoutMs: number): Promise<AgentWorkspaceState | null> {
        const result = await this.invoke(window, AGENT_INTERNAL_TOOL_STATE, {}, { clientName: null }, timeoutMs);
        if (!result.ok) {
            return null;
        }
        const structured = result.structured ?? {};
        return { paused: structured.paused === true, follow: structured.follow !== false };
    }

    public forward(handle: AgentWorkspaceHandle, tool: string, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult> {
        const window = (handle as AgentWorkspaceHandle & { window?: AppWindow<WindowAppType.Workspace> }).window;
        if (!window) {
            return Promise.resolve(agentRefusal("no_workspace", "That project's window is gone."));
        }
        return this.invoke(window, tool, args, context, agentCallTimeoutMs(tool));
    }

    private async invoke(
        window: AppWindow<WindowAppType.Workspace>,
        tool: string,
        args: Record<string, unknown>,
        context: AgentCallContext,
        timeoutMs: number,
    ): Promise<AgentCallResult> {
        if (window.isClosed()) {
            return agentRefusal("no_workspace", "That project's window was closed.");
        }
        this.grantImportRoots(window);
        // One deadline for both halves: main's wait below ends at it, and the workspace refuses to
        // start the call once it has passed - a call still queued behind a long one by then is one
        // the agent has been told timed out, and may already be retrying.
        const deadline = Date.now() + timeoutMs;
        const request: AgentCallRequest = {
            callId: crypto.randomUUID(),
            tool,
            args,
            clientName: context.clientName,
            policy: this.policy(),
            deadline,
        };
        this.inFlight.set(request.callId, { window, clientName: context.clientName, deadline, timeoutMs });
        try {
            const status = await window.invokeIpcRequest(IPCEventType.workspaceAgentCall, request, { timeoutMs });
            if (!status.success) {
                return agentRefusal("internal", `The workspace could not carry out ${tool}: ${status.error}`);
            }
            return isAgentCallResult(status.data)
                ? status.data
                : agentRefusal("internal", `The workspace answered ${tool} with something that is not a tool result.`);
        } catch (error) {
            const message = describe(error);
            if ((error as { code?: unknown } | null)?.code === IPC_PAGE_GONE) {
                return agentRefusal(
                    "unavailable",
                    `The project's window reloaded, or its page crashed, before answering ${tool}.`,
                    "Part of it may have been done. Wait for the project to load again (agent_status says when it is answering), read the state back with a show tool, then redo only what is missing.",
                );
            }
            if (/timed out/i.test(message)) {
                return agentRefusal(
                    "unavailable",
                    `The workspace did not answer ${tool} within ${Math.round(timeoutMs / 1000)} seconds.`,
                    "If it was still waiting behind an earlier call, it will not run at all; if it had started, it may still be working. Read the state back (agent_status, a show tool) before repeating a write.",
                );
            }
            return agentRefusal("no_workspace", `The project's window went away before answering ${tool}.`);
        } finally {
            this.inFlight.delete(request.callId);
        }
    }

    /**
     * Let the workspace read the folders the author allowed agents to import from. The renderer
     * reads files through grants, and the grant the folder picker made belongs to the Settings
     * window; without this, an allowed folder would still be unreadable to the window doing the
     * import. Read only, and only folders on the list - the renderer checks the list again.
     */
    private grantImportRoots(window: AppWindow): void {
        const roots = this.store.current.allowedImportRoots;
        if (roots.length > 0) {
            this.grantFolders(window, roots.map(root => root.path));
        }
    }

    /**
     * Let `window` read each folder, recursively and read-only, once per window. A folder on the
     * allowed list carries the macOS bookmark the picker returned, when it did; one granted under
     * full access or from a folder dialog has none, and needs none outside the Mac App Store sandbox.
     */
    private grantFolders(window: AppWindow, folders: readonly string[]): void {
        const granted = this.grantedRoots.get(window) ?? new Set<string>();
        const bookmarks = new Map(this.store.current.allowedImportRoots.map(root => [identity(root.path), root.bookmark]));
        for (const folder of folders) {
            const key = identity(folder);
            if (granted.has(key) || key === identity((window as AppWindow<WindowAppType.Workspace>).getProps?.()?.projectPath ?? "")) {
                continue;
            }
            try {
                this.app.storageManager.grantFileSystemAccess(window, folder, "read", true, bookmarks.get(key), "window");
                granted.add(key);
            } catch (error) {
                this.app.logger.warn(`[Agent] Could not grant ${folder} to a workspace: ${describe(error)}`);
            }
        }
        this.grantedRoots.set(window, granted);
    }

    // ── Folder access ────────────────────────────────────────────────────────────────────────────
    //
    // An agent that needs a file outside the project and the allowed folders is not refused at once:
    // the author is asked, in the agent access window over the workspace the call is for. The rules
    // and the one-question-at-a-time queue are `agentFolderAccess.ts`; what lives here is Electron.

    /**
     * A workspace's request, made while carrying out an agent call. Only a call main sent to that
     * window and has not had answered yet may ask, and its client name and deadline are main's own
     * record, never the renderer's word: a workspace runs plugin code.
     */
    public async requestFolderAccessForCall(window: AppWindow, request: AgentFolderAccessRequest): Promise<AgentFolderAccessAnswer> {
        const call = typeof request?.callId === "string" ? this.inFlight.get(request.callId) : undefined;
        if (!call || call.window !== window) {
            throw new Error("Folder access can only be asked for during an agent call to this window.");
        }
        const paths = readRequestedPaths(request.paths);
        // Leave the call time to import once the author answers: wait at most a quarter of the
        // call's budget short of its deadline, and never longer than a client is likely to wait.
        const remaining = call.deadline - Date.now() - Math.max(FOLDER_PROMPT_MARGIN_MS, call.timeoutMs / 4);
        const waitMs = Math.max(0, Math.min(FOLDER_PROMPT_WAIT_MS, remaining));
        return this.folderAccess.request(window, await this.foldersOf(paths), { clientName: call.clientName }, waitMs);
    }

    /** `request_folder_access`: the same conversation, asked up front by the agent itself. */
    public async requestFolderAccess(
        handle: AgentWorkspaceHandle,
        paths: readonly string[],
        context: AgentCallContext,
        reason?: string,
    ): Promise<AgentFolderAccessAnswer> {
        const window = (handle as AgentWorkspaceHandle & { window?: AppWindow<WindowAppType.Workspace> }).window;
        if (!window || window.isClosed()) {
            return { granted: [], denied: [], pending: [], refused: [] };
        }
        const prompt: AgentFolderPrompt = { clientName: context.clientName, ...(reason ? { reason } : {}) };
        return this.folderAccess.request(window, await this.foldersOf(readRequestedPaths(paths)), prompt, FOLDER_PROMPT_WAIT_MS);
    }

    /** Each path's folder: a directory is its own, anything else (a file, or nothing yet) its parent's. */
    private async foldersOf(paths: readonly string[]): Promise<string[]> {
        return Promise.all(paths.map(async requested => {
            if (!path.isAbsolute(requested)) {
                return requested;
            }
            const resolved = path.resolve(requested);
            try {
                return (await fs.stat(resolved)).isDirectory() ? resolved : path.dirname(resolved);
            } catch {
                return path.dirname(resolved);
            }
        }));
    }

    private folderRules(): AgentFolderRules {
        const electronApp = this.app.electronApp;
        const studioDirs = [this.app.getUserDataDir()];
        for (const resolve of [() => this.app.getAppPath(), () => this.app.getResourcesDir(), () => applicationBundle(electronApp.getPath("exe"))]) {
            try {
                studioDirs.push(resolve());
            } catch {
                // A folder Electron cannot name is one nobody can ask for either.
            }
        }
        return {
            pathApi: path,
            caseInsensitive: process.platform === "win32",
            home: electronApp.getPath("home"),
            studioDirs,
        };
    }

    private allowedFolders(window: AppWindow): string[] {
        const roots = this.store.current.allowedImportRoots.map(root => path.resolve(root.path));
        const projectPath = (window as AppWindow<WindowAppType.Workspace>).getProps?.()?.projectPath;
        return typeof projectPath === "string" && projectPath ? [path.resolve(projectPath), ...roots] : roots;
    }

    private async rememberImportRoots(folders: readonly string[]): Promise<void> {
        await this.store.update(draft => {
            for (const folder of folders) {
                const key = identity(folder);
                if (!draft.allowedImportRoots.some(root => identity(root.path) === key)) {
                    draft.allowedImportRoots.push({ path: path.resolve(folder) });
                }
            }
        });
        this.app.logger.info(`[Agent] The author allowed agents to read ${folders.join(", ")}`);
        this.broadcastQuickState(await this.snapshot());
    }

    /**
     * The question itself, in the agent access window over the workspace the call is for. Nobody
     * at the screen started it, so it is shown without pulling Studio in front of another
     * application, as the native sheet before it was: no raising, no activating.
     */
    private async askFolderAccess(window: AppWindow, folders: readonly string[], prompt: AgentFolderPrompt): Promise<boolean> {
        window.refuseUnattendedPrompt("An agent asked to read a folder outside the project");
        const clientName = prompt.clientName?.trim() || null;
        const reason = prompt.reason?.trim();
        return this.askInStudioWindow(
            window,
            { kind: "folderAccess", clientName, folders: [...folders], ...(reason ? { reason } : {}) },
            false,
        );
    }

    // ── Guide ────────────────────────────────────────────────────────────────────────────────────

    public async readGuide(chapter: AgentGuideChapter): Promise<string | null> {
        const skillDir = this.app.resolveResource(path.join("agent", "skills", "narraleaf-make-game"));
        for (const candidate of guideFileCandidates(chapter)) {
            try {
                const text = await fs.readFile(path.join(skillDir, ...candidate), "utf8");
                return chapter === "workflow" ? stripFrontMatter(text) : text;
            } catch {
                // Try the next spelling; the whole chapter may also simply not be installed.
            }
        }
        return null;
    }

    /** Enabled plugins whose manifest names a guide chapter (`contributes.agentGuide`). */
    public async listPluginGuides(): Promise<AgentPluginGuideEntry[]> {
        try {
            const plugins = await this.app.pluginManager.listPlugins();
            return plugins
                .filter(plugin => plugin.enabled && typeof plugin.manifest.contributes.agentGuide === "string" && plugin.manifest.contributes.agentGuide)
                .map(plugin => ({ pluginId: plugin.pluginId, name: plugin.manifest.name }))
                .sort((a, b) => a.pluginId.localeCompare(b.pluginId));
        } catch {
            return [];
        }
    }

    public async readPluginGuide(pluginId: string): Promise<string | null> {
        try {
            const plugin = (await this.app.pluginManager.listPlugins()).find(entry => entry.pluginId === pluginId && entry.enabled);
            const relative = plugin?.manifest.contributes.agentGuide;
            const file = plugin && relative ? pluginGuideFile(plugin.installPath, relative) : null;
            if (!file) {
                return null;
            }
            const stat = await fs.stat(file);
            if (!stat.isFile() || stat.size > AGENT_PLUGIN_GUIDE_MAX_BYTES) {
                return null;
            }
            return stripFrontMatter(await fs.readFile(file, "utf8"));
        } catch {
            return null;
        }
    }

    // ── Projects ─────────────────────────────────────────────────────────────────────────────────

    public async isProjectDirectory(directory: string): Promise<boolean> {
        try {
            const entries = await fs.readdir(directory, { withFileTypes: true });
            return findProjectConfigFileName(entries.map(entry => ({
                name: path.parse(entry.name).name,
                ext: path.extname(entry.name) || null,
                type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
            }))) !== null;
        } catch {
            return false;
        }
    }

    public isTrusted(projectPath: string): boolean {
        return this.app.projectTrustManager.isTrusted(projectPath);
    }

    public defaultProjectsDir(): string {
        const electronApp = this.app.electronApp;
        return resolveDefaultProjectDirectory({
            platform: process.platform,
            documents: electronApp.getPath("documents"),
            downloads: electronApp.getPath("downloads"),
            home: electronApp.getPath("home"),
            env: process.env,
            directoryExists: candidate => {
                try {
                    return unpatchedFs.statSync(candidate).isDirectory();
                } catch {
                    return false;
                }
            },
        });
    }

    /** The window a project is opened from: the one the author used last, else any, else the launcher. */
    private async opener(): Promise<AppWindow | null> {
        const workspaces = this.workspaceWindows()
            .sort((a, b) => (this.focusedAt.get(b) ?? 0) - (this.focusedAt.get(a) ?? 0));
        if (workspaces[0]) {
            return workspaces[0];
        }
        const launcher = this.app.findLauncherWindow();
        if (launcher && !launcher.isClosed()) {
            return launcher;
        }
        await this.app.ensureLauncher();
        return this.app.findLauncherWindow() ?? null;
    }

    public async openProject(projectPath: string): Promise<AgentOpenProjectOutcome> {
        const existing = this.app.findWorkspaceForProject(projectPath);
        if (existing && !existing.isClosed() && !existing.getProps().commandLineRun) {
            await this.openWorkspaces();
            return { ok: true, handle: this.handleFor(existing), alreadyOpen: true };
        }
        const opener = await this.opener();
        if (!opener) {
            return { ok: false, result: agentRefusal("unavailable", "Studio has no window to open the project from.") };
        }
        let window: AppWindow<WindowAppType.Workspace>;
        try {
            window = await this.app.openProject(opener, projectPath);
        } catch (error) {
            return { ok: false, result: agentRefusal("unavailable", `Studio could not open ${projectPath}: ${describe(error)}`) };
        }
        const ready = await this.waitUntilAnswering(window, OPEN_TIMEOUT_MS);
        if (ready === "failed") {
            return {
                ok: false,
                result: agentRefusal(
                    "unavailable",
                    `Studio could not open ${projectPath}; its window says why.`,
                    "Ask the author what the window shows, or call console_read once a project is open.",
                ),
            };
        }
        this.projectNames.delete(identity(projectPath));
        await this.openWorkspaces();
        if (ready === "silent") {
            this.app.logger.warn(`[Agent] ${projectPath} opened but its workspace did not answer agent calls in time`);
        }
        return { ok: true, handle: this.handleFor(window), alreadyOpen: false };
    }

    /**
     * Wait for a freshly opened workspace to load its project and start answering agent calls.
     * `failed` is a project that came up on its error screen (or a window that went away); `silent`
     * is a project that loaded but whose workspace did not answer `__state` before the deadline.
     */
    private async waitUntilAnswering(window: AppWindow<WindowAppType.Workspace>, timeoutMs: number): Promise<"ready" | "silent" | "failed"> {
        const deadline = Date.now() + timeoutMs;
        const loaded = await new Promise<boolean | null>(resolve => {
            // Whichever comes first settles it, and takes the others' listeners with it: the close
            // listener would otherwise stay on the window for as long as it lives.
            const listeners: AppEventToken[] = [];
            let settled = false;
            const settle = (value: boolean | null) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                for (const listener of listeners) {
                    listener.cancel();
                }
                resolve(value);
            };
            const timer = setTimeout(() => settle(null), timeoutMs);
            listeners.push(window.onClose(() => settle(false)));
            // May answer at once, before its token is in the list; the token is a no-op then.
            listeners.push(window.onLoadResult(ok => settle(ok)));
        });
        if (loaded === false) {
            return "failed";
        }
        while (Date.now() < deadline && !window.isClosed()) {
            if (await this.askState(window, Math.min(STATE_TIMEOUT_MS, Math.max(500, deadline - Date.now())))) {
                return "ready";
            }
            await sleep(500);
        }
        return window.isClosed() ? "failed" : "silent";
    }

    public async createProject(input: AgentProjectCreateInput): Promise<AgentCallResult> {
        let written;
        try {
            written = await writeAgentProject(input, {
                templatesDir: this.app.resolveResource(PROJECT_TEMPLATES_DIR),
                installedPlugins: () => this.app.pluginManager.listPlugins(),
            });
        } catch (error) {
            return agentRefusal("internal", `The project could not be written: ${describe(error)}`);
        }
        if (!written.ok) {
            return agentRefusal(written.code, written.message, written.hint);
        }
        const { projectPath, scaffold } = written;
        await this.switchOnBuiltInDependencies(scaffold?.dependencies ?? []);
        // Studio wrote it, so it opens as Studio's own - the same record the wizard's hand-off makes.
        this.app.projectTrustManager.recordArrival(projectPath, "created", new Date().toISOString());
        this.app.logger.info(`[Agent] Created project ${projectPath}`);

        const opened = await this.openProject(projectPath);
        if (!opened.ok) {
            return agentRefusal(
                "unavailable",
                `The project was created at ${projectPath} but could not be opened: ${opened.result.ok ? "" : opened.result.error.message}`,
                "Call project_open with that path.",
            );
        }
        return agentText(
            [
                `Created "${input.name}" at ${projectPath} from the ${input.template} template and opened it in Studio.`,
                input.template === "skeleton"
                    ? "It already has a title page, dialogue box, save/load, settings and history, plus a short sample story. Read the workflow guide, then restyle and rewrite it."
                    : "It is empty: one blank page and no story yet.",
                `Pass project: "${projectPath}" to workspace tools if more than one project is open.`,
            ].join("\n"),
            { project: projectPath, appId: written.appId, template: input.template, contentLocale: scaffold?.contentLocale ?? null },
        );
    }

    /** As the template scaffold handler does: a template's built-in plugins are switched on with it. */
    private async switchOnBuiltInDependencies(dependencies: readonly string[]): Promise<void> {
        if (dependencies.length === 0) {
            return;
        }
        try {
            const installed = await this.app.pluginManager.listPlugins();
            let switchedOn = false;
            for (const pluginId of dependencies) {
                const plugin = installed.find(entry => entry.pluginId === pluginId);
                if (!plugin?.builtIn || plugin.enabled) {
                    continue;
                }
                await this.app.pluginManager.setPluginEnabled(pluginId, true);
                switchedOn = true;
            }
            if (switchedOn) {
                void this.app.refreshPluginLocales();
            }
        } catch (error) {
            this.app.logger.warn(`[Agent] Could not switch on the template's built-in plugins: ${describe(error)}`);
        }
    }

    /**
     * Run one test on a project nobody has open, the way `--test` does: a workspace opened in the
     * background with the job in its props, which runs the test through its own `TestRunService`
     * and reports back on the command-line run channel. Closed again once it has answered.
     *
     * Opened from a workspace the author already has, never from the launcher: a launcher opener is
     * retired once the project is up, which would take the author's home screen away for a test
     * they cannot see, and the hidden window closing would then leave Studio with no window at all.
     */
    public async runHeadlessTest(projectPath: string, testId: string): Promise<AgentCallResult> {
        const opener = this.workspaceWindows()[0];
        if (!opener) {
            return agentRefusal(
                "unavailable",
                `${projectPath} is not open, and tests of a closed project run beside an open one.`,
                "Call project_open with that path, then run the test again.",
            );
        }
        const job: CommandLineRunJob = {
            kind: "test",
            testId,
            parameters: {},
            asShipped: false,
            edition: defaultTestEdition(),
            plugins: [],
        };
        let window: AppWindow<WindowAppType.Workspace>;
        try {
            window = await this.app.openProject(opener, projectPath, { background: true, commandLineRun: job });
        } catch (error) {
            return agentRefusal("unavailable", `Studio could not open ${projectPath} to test it: ${describe(error)}`);
        }
        if (window.getProps().commandLineRun === undefined) {
            // Somebody opened it for real in the meantime; that window runs the test instead.
            return this.forward(this.handleFor(window), AGENT_INTERNAL_TOOL_TEST, { id: testId }, { clientName: null });
        }
        const log: CommandLineRunLogLine[] = [];
        const finished = await new Promise<Extract<CommandLineRunEvent, { kind: "finished" }> | string>(resolve => {
            let silence: ReturnType<typeof setTimeout>;
            const arm = () => {
                clearTimeout(silence);
                silence = setTimeout(() => resolve("The test said nothing for five minutes, so it was abandoned."), HEADLESS_SILENCE_MS);
            };
            arm();
            const token = window.onCommandLineRunEvent(event => {
                arm();
                if (event.kind === "log") {
                    const { kind: _kind, ...line } = event;
                    log.push(line);
                    return;
                }
                clearTimeout(silence);
                token.cancel();
                resolve(event);
            });
            window.onLoadResult(ok => {
                if (!ok) {
                    clearTimeout(silence);
                    resolve("Studio could not open the project to test it.");
                }
            });
            window.onClose(() => {
                clearTimeout(silence);
                resolve("The test's window went away before it reported a result.");
            });
        });
        if (!window.isClosed()) {
            window.forceClose();
        }
        return headlessTestResult(testId, finished, log);
    }
}

const STATE_TIMEOUT_MS = 3000;
/** Longest a call waits for the author to answer a folder dialog before it answers `pending`. */
const FOLDER_PROMPT_WAIT_MS = 50 * 1000;
/** Least time left on a call once the dialog wait ends, for the import the answer allows. */
const FOLDER_PROMPT_MARGIN_MS = 15 * 1000;
/** Most paths one folder request reads. */
const FOLDER_REQUEST_MAX_PATHS = 500;

type InFlightCall = {
    window: AppWindow;
    clientName: string | null;
    /** When main stops waiting for the answer. */
    deadline: number;
    timeoutMs: number;
};

function readRequestedPaths(value: unknown): string[] {
    if (!Array.isArray(value)) {
        throw new Error("paths must be an array of strings.");
    }
    return value
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0 && entry.length <= 4096 && !entry.includes("\0"))
        .slice(0, FOLDER_REQUEST_MAX_PATHS);
}

/** The `.app` bundle an executable sits in on macOS, else the executable's own folder. */
function applicationBundle(executable: string): string {
    const bundle = /^(.*?\.app)(?:[\\/]|$)/i.exec(executable);
    return process.platform === "darwin" && bundle ? bundle[1] : path.dirname(executable);
}
const OPEN_TIMEOUT_MS = 90 * 1000;
const HEADLESS_SILENCE_MS = 5 * 60 * 1000;

function headlessTestResult(
    testId: string,
    finished: Extract<CommandLineRunEvent, { kind: "finished" }> | string,
    log: readonly CommandLineRunLogLine[],
): AgentCallResult {
    if (typeof finished === "string") {
        return agentRefusal("unavailable", finished);
    }
    if (finished.test) {
        const { title, status, summary, findings } = finished.test;
        const lines = [
            `${title} (${finished.test.testId}): ${status}${summary ? ` - ${summary}` : ""}`,
            ...findings.slice(0, 50).map(finding => `- [${finding.severity}] ${finding.message}${finding.location ? ` (${finding.location})` : ""}`),
        ];
        return agentText(lines.join("\n"), { ...finished.test, findings: findings.slice(0, 200) });
    }
    const message = finished.error ?? "The test did not finish.";
    switch (finished.refusal) {
        case "invocation":
            return agentRefusal(
                "not_found",
                message,
                `Known built-in tests: narraleaf-studio:route-coverage, narraleaf-studio:reachable-endings, narraleaf-studio:project-diagnostics.`,
            );
        case "unavailable":
        case "environment":
            return agentRefusal("unavailable", message);
        default:
            return agentRefusal(
                "internal",
                message,
                log.length > 0 ? `Last log line: ${log[log.length - 1].message}` : undefined,
            );
    }
}

function isAgentCallResult(value: unknown): value is AgentCallResult {
    if (!value || typeof value !== "object") {
        return false;
    }
    const record = value as Record<string, unknown>;
    if (record.ok === true) {
        return Array.isArray(record.content);
    }
    if (record.ok === false) {
        const error = record.error as Record<string, unknown> | undefined;
        return !!error && typeof error.code === "string" && typeof error.message === "string";
    }
    return false;
}

function identity(projectPath: string): string {
    return normalizeProjectPath(path.resolve(projectPath));
}

function sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function describe(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
