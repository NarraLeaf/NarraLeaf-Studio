import crypto from "crypto";
import path from "path";
import { unpatchedFs, unpatchedFsPromises as fs } from "../../../../utils/unpatchedFs";
import { IPCEventType } from "@shared/types/ipcEvents";
import { WindowAppType } from "@shared/types/window";
import { normalizeProjectPath } from "@shared/utils/recentProject";
import { findProjectConfigFileName } from "@shared/utils/nlproj";
import { PROJECT_TEMPLATES_DIR } from "@shared/constants/projectTemplate";
import type { CommandLineRunEvent, CommandLineRunJob, CommandLineRunLogLine } from "@shared/types/commandLineRun";
import {
    AGENT_INTERNAL_TOOL_STATE,
    AGENT_INTERNAL_TOOL_TEST,
    agentRefusal,
    agentText,
    type AgentCallRequest,
    type AgentCallResult,
    type AgentSessionPolicy,
    type AgentWorkspaceState,
} from "@shared/agent/protocol";
import type { AgentGuideChapter, AgentToolDescriptor } from "@shared/agent/tools";
import {
    agentEndpointUrl,
    isUsableAgentPort,
    AGENT_PORT_MAX,
    AGENT_PORT_MIN,
    type AgentSettingsPatch,
    type AgentSettingsSnapshot,
} from "@shared/agent/settings";
import type { App } from "../../../app";
import type { AppWindow } from "../window/appWindow";
import { dialogTranslator, showOpenDialog } from "../window/fileDialog";
import { readProjectConfigFromDir } from "../../utils/projectConfigFile";
import { defaultTestEdition } from "../../utils/testEdition";
import { resolveDefaultProjectDirectory } from "../../defaultProjectDirectory";
import { AgentMcpServer, type AgentCallContext, type AgentMcpHost } from "./agentMcpServer";
import { AgentSettingsStore, mintAgentToken } from "./agentSettingsStore";
import { agentStdioCommand } from "./agentStdioMain";
import { chooseAgentWorkspace, type AgentRoutingChoice } from "./agentRouting";
import {
    AGENT_MAIN_TOOL_HANDLERS,
    noWorkspace,
    type AgentMainToolHost,
    type AgentOpenProjectOutcome,
    type AgentWorkspaceHandle,
} from "./agentMainTools";
import { writeAgentProject, type AgentProjectCreateInput } from "./agentProjectCreate";
import { guideFileCandidates, stripFrontMatter } from "./agentGuide";
import { agentCallTimeoutMs } from "./agentCallTimeout";

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
    /** Serializes start/stop so two quick toggles cannot leave two servers or none. */
    private lifecycle: Promise<void> = Promise.resolve();
    private initialized = false;

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
            port: settings.port,
            token: settings.token,
            allowedImportRoots: settings.allowedImportRoots.map(root => root.path),
            running: livePort !== null,
            url: agentEndpointUrl(livePort ?? settings.port),
            error: settings.enabled && livePort === null ? this.lastError : null,
            stdio: agentStdioCommand(this.app.electronApp),
        };
    }

    public async updateSettings(patch: AgentSettingsPatch): Promise<AgentSettingsSnapshot> {
        if (patch.port !== undefined && !isUsableAgentPort(patch.port)) {
            throw new Error(`The port must be a whole number from ${AGENT_PORT_MIN} to ${AGENT_PORT_MAX}.`);
        }
        const before = await this.store.load();
        const wasEnabled = before.enabled;
        const previousPort = before.port;
        const after = await this.store.update(draft => {
            if (typeof patch.enabled === "boolean") {
                draft.enabled = patch.enabled;
            }
            if (typeof patch.allowWrites === "boolean") {
                draft.allowWrites = patch.allowWrites;
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
        });
        if (after.allowWrites !== before.allowWrites) {
            this.app.logger.info(`[Agent] Write access ${after.allowWrites ? "allowed" : "withdrawn"}`);
        }
        if (after.enabled && (!wasEnabled || after.port !== previousPort || !this.server)) {
            await this.serialize(async () => {
                await this.stopServer();
                await this.startServer();
            });
        } else if (!after.enabled && wasEnabled) {
            await this.serialize(() => this.stopServer());
        }
        return this.snapshot();
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
            writesEnabled: settings.allowWrites,
            allowedImportRoots: settings.allowedImportRoots.map(root => path.resolve(root.path)),
        };
    }

    public endpointUrl(): string | null {
        const port = this.server?.port;
        return port ? agentEndpointUrl(port) : null;
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

    public async callTool(tool: AgentToolDescriptor, args: Record<string, unknown>, context: AgentCallContext): Promise<AgentCallResult> {
        if (tool.write && !this.store.current.allowWrites) {
            return agentRefusal(
                "writes_disabled",
                `${tool.name} changes the project, and the author has not allowed agents to make changes.`,
                "Ask the author to turn on \"Allow agents to make changes\" in Studio's Settings > Agent access. Read tools keep working meanwhile.",
            );
        }
        if (tool.side === "main") {
            const handler = AGENT_MAIN_TOOL_HANDLERS[tool.name];
            if (!handler) {
                return agentRefusal("unknown_tool", `${tool.name} has no handler in this Studio.`);
            }
            return handler(this, args, context);
        }
        const project = typeof args.project === "string" && args.project ? path.resolve(args.project) : null;
        const choice = this.route(project);
        if (!choice.ok) {
            return noWorkspace(choice);
        }
        return this.forward(choice.window, tool.name, args, context);
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
        const request: AgentCallRequest = {
            callId: crypto.randomUUID(),
            tool,
            args,
            clientName: context.clientName,
            policy: this.policy(),
        };
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
            if (/timed out/i.test(message)) {
                return agentRefusal(
                    "unavailable",
                    `The workspace did not answer ${tool} within ${Math.round(timeoutMs / 1000)} seconds.`,
                    "It may still be working. Read the state back (agent_status, a show tool) before repeating a write.",
                );
            }
            return agentRefusal("no_workspace", `The project's window went away before answering ${tool}.`);
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
        if (roots.length === 0) {
            return;
        }
        const granted = this.grantedRoots.get(window) ?? new Set<string>();
        for (const root of roots) {
            const key = identity(root.path);
            if (granted.has(key)) {
                continue;
            }
            try {
                this.app.storageManager.grantFileSystemAccess(window, root.path, "read", true, root.bookmark, "window");
                granted.add(key);
            } catch (error) {
                this.app.logger.warn(`[Agent] Could not grant ${root.path} to a workspace: ${describe(error)}`);
            }
        }
        this.grantedRoots.set(window, granted);
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
            const timer = setTimeout(() => resolve(null), timeoutMs);
            window.onLoadResult(ok => {
                clearTimeout(timer);
                resolve(ok);
            });
            window.onClose(() => {
                clearTimeout(timer);
                resolve(false);
            });
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
