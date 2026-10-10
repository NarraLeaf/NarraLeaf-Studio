/**
 * The workspace half of Studio's MCP endpoint: carries out the calls main routes to this window.
 *
 * Main owns the network, the token and the tool table's validation; what reaches here is one
 * `AgentCallRequest` per call (`workspaceAgentCall`), with the author's switches attached. This
 * service gates it (write access, pause, freeze, live session), runs the tool's handler against the
 * same services the editor commits through, logs it to the console's agent channel, and answers an
 * `AgentCallResult` - always an answer, never a throw, because main waits for one.
 *
 * Every call, refused or carried out, is also an entry in the {@link AgentActivityLog} the Agent log
 * panel shows, beside the calls main reports having answered itself.
 *
 * Plugin tools (`app.services.agent.registerTool`) are carried out here too, from the window's
 * {@link PluginAgentToolRegistry}, through the same gate as Studio's own; the set this window has is
 * reported to main on every change, which is how `tools/list` follows plugins loading and unloading.
 *
 * Calls run one at a time. Two agents (or one agent's parallel tool calls) writing the same page
 * would otherwise interleave their edits inside each other's undo steps, and an answer computed
 * while another call is half-written could describe a page that never existed. A call whose
 * deadline passes while it waits its turn is refused when its turn comes, never run: main has told
 * the agent it timed out by then, and a retry of it may be right behind it in the queue.
 *
 * Comments in English per project convention.
 */

import {
    AGENT_INTERNAL_TOOL_STATE,
    agentCallExpired,
    agentRefusal,
    type AgentCallRequest,
    type AgentCallResult,
    type AgentErrorCode,
    type AgentWorkspaceState,
} from "@shared/agent/protocol";
import type { AgentMainActivity } from "@shared/agent/workspaceAccess";
import { AGENT_TOOLS_BY_NAME } from "@shared/agent/tools";
import { looksLikeAgentPluginToolName, type AgentPluginToolDescriptor } from "@shared/agent/pluginTools";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { getAgentBridgeInterface, getInterface } from "@/lib/app/bridge";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import type { ConsoleService, ConsoleLogLevel } from "../core/ConsoleService";
import type { LiveSessionService } from "../live/LiveSessionService";
import { AgentFollowService, type AgentWriteTarget } from "./AgentFollowService";
import { AgentActivityLog, type AgentActivityToolMeta } from "./AgentActivityLog";
import { AgentOffscreenRenderer } from "./agentOffscreenRenderer";
import { AgentRefusal, type AgentToolContext, type AgentToolHandler } from "./agentCall";
import { gateAgentCall } from "./agentGate";
import type { createAgentInternalHandlers, createAgentToolHandlers } from "./agentHandlers";
import { AGENT_CONSOLE_CHANNEL, AGENT_CONSOLE_SOURCE } from "./agentConsole";
import { pluginAgentToolRegistry, type PluginAgentToolRegistry } from "./pluginToolRegistry";

export { AGENT_CONSOLE_CHANNEL, AGENT_CONSOLE_SOURCE };

/**
 * The two handler tables, loaded on the first call rather than with this module.
 *
 * The tables reach the text-format cores, and through them every built-in widget module. This service
 * is registered by the workspace's service registry, which a widget inspector imports (through the
 * workspace context), so a static import here closes a loop: a widget module that is evaluated first
 * reaches the built-in widget list while it is itself half-evaluated, and the list reads `undefined`
 * where that widget should be. Studio happened to load in an order that hid it; a test that imports
 * one widget module did not. Nothing needs the tables before an agent calls, so they wait until then.
 */
type AgentHandlerTables = {
    tools: ReturnType<typeof createAgentToolHandlers>;
    internal: ReturnType<typeof createAgentInternalHandlers>;
};

export class AgentBridgeService extends Service<AgentBridgeService> {
    private tables: Promise<AgentHandlerTables> | null = null;
    private readonly offscreen = new AgentOffscreenRenderer();
    private queue: Promise<unknown> = Promise.resolve();
    private disposeChannel: (() => void) | null = null;
    private console: ConsoleService | null = null;
    private follow: AgentFollowService | null = null;
    private readonly activity = new AgentActivityLog();
    private disposeMainActivity: (() => void) | null = null;
    private disposePluginToolReports: (() => void) | null = null;

    protected async init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        const consoleService = ctx.services.get<ConsoleService>(Services.Console);
        const follow = ctx.services.get<AgentFollowService>(Services.AgentFollow);
        await depend([consoleService, follow]);
        this.console = consoleService;
        this.follow = follow;
        this.disposeChannel?.();
        this.disposeChannel = consoleService.registerChannel({
            id: AGENT_CONSOLE_CHANNEL,
            label: "Agent",
            description: "Calls from AI agents connected to Studio",
        });
        this.disposeMainActivity?.();
        this.disposeMainActivity = subscribeToMainActivity(activity => this.activity.recordMain(activity));
        this.disposePluginToolReports?.();
        this.disposePluginToolReports = reportPluginToolsToMain(this.pluginTools(ctx));
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.disposeChannel?.();
        this.disposeChannel = null;
        this.disposeMainActivity?.();
        this.disposeMainActivity = null;
        this.disposePluginToolReports?.();
        this.disposePluginToolReports = null;
        this.activity.clear();
        this.console = null;
        this.follow = null;
    }

    /** Where `ui_screenshot` mounts the page it photographs; the workspace layout hosts it. */
    public getOffscreenRenderer(): AgentOffscreenRenderer {
        return this.offscreen;
    }

    /** The calls this workspace saw, for the Agent log panel. */
    public getActivityLog(): AgentActivityLog {
        return this.activity;
    }

    /** The plugin tools this window's plugins registered. */
    public pluginTools(ctx: WorkspaceContext = this.getContext()): PluginAgentToolRegistry {
        return pluginAgentToolRegistry(ctx);
    }

    /** The handler table, for the coverage test and for nothing else. */
    public async getToolNames(): Promise<string[]> {
        return Object.keys((await this.loadHandlers()).tools);
    }

    private loadHandlers(): Promise<AgentHandlerTables> {
        this.tables ??= import("./agentHandlers").then(module => ({
            tools: module.createAgentToolHandlers(),
            internal: module.createAgentInternalHandlers(),
        }));
        return this.tables;
    }

    /** Carry out one call. Always resolves. */
    public handle(request: AgentCallRequest): Promise<AgentCallResult> {
        // The state call is answered at once, outside the queue: main asks it to draw `agent_status`
        // and the status bar, and it must not wait behind a long build.
        if (request.tool === AGENT_INTERNAL_TOOL_STATE) {
            return Promise.resolve(this.state());
        }
        const run = this.queue.then(() => this.run(request), () => this.run(request));
        this.queue = run.catch(() => undefined);
        return run;
    }

    private state(): AgentCallResult {
        const follow = this.follow?.getState();
        const state: AgentWorkspaceState = { paused: follow?.paused ?? false, follow: follow?.follow ?? true };
        return { ok: true, content: [{ type: "text", text: JSON.stringify(state) }], structured: state };
    }

    private async run(request: AgentCallRequest): Promise<AgentCallResult> {
        const ctx = this.getContext();
        const follow = this.follow ?? ctx.services.get<AgentFollowService>(Services.AgentFollow);
        const descriptor = AGENT_TOOLS_BY_NAME.get(request.tool);
        const tables = await this.loadHandlers();
        const internal = tables.internal[request.tool];
        const plugin = !internal && !descriptor ? this.pluginTools(ctx).get(request.tool) : undefined;
        let handler: AgentToolHandler | undefined;
        let write: boolean;
        if (internal) {
            handler = internal.handler;
            write = internal.write;
        } else if (descriptor && descriptor.side === "workspace") {
            handler = tables.tools[request.tool];
            write = descriptor.write;
        } else if (plugin) {
            handler = (args, tool) => plugin.run(args, { clientName: tool.request.clientName });
            write = plugin.descriptor.write;
        } else {
            write = false;
        }
        const meta = plugin ? pluginMeta(plugin.descriptor) : undefined;
        // Checked here, after the last wait before the handler: from this line to the handler
        // nothing yields, so a call that passes is a call main is still waiting for.
        if (agentCallExpired(request, Date.now())) {
            const expired = agentRefusal(
                "unavailable",
                `${request.tool} timed out before it started; nothing was done.`,
                "Studio was still busy with an earlier call (a build, an import) when the time for this one ran out. Read the state back (agent_status, a show tool), then call it again if it is still needed.",
            );
            this.log("warning", request, `${request.tool} not started: its deadline passed while it waited behind an earlier call`);
            this.recordAtOnce(request, expired, meta);
            return expired;
        }
        if (!handler) {
            this.log("warning", request, `unknown tool ${request.tool}`);
            const unknown = looksLikeAgentPluginToolName(request.tool)
                ? agentRefusal(
                    "unknown_tool",
                    `No plugin loaded in this project offers "${request.tool}".`,
                    "The plugin is not loaded in this project (not installed, switched off, or not a dependency of it). Call tools/list again for the tools this project has.",
                )
                : agentRefusal("unknown_tool", `This Studio window has no tool called "${request.tool}".`);
            this.recordAtOnce(request, unknown);
            return unknown;
        }
        if (plugin && request.policy.blockedPluginIds?.includes(plugin.descriptor.pluginId)) {
            const blocked = agentRefusal(
                "unavailable",
                `The author switched off the agent tools of the plugin ${plugin.descriptor.pluginId}.`,
                "Ask the author to allow them in Studio's Settings > Agent access, or do the work in Studio's own tools.",
            );
            this.recordAtOnce(request, blocked, meta);
            return blocked;
        }

        const refused = gateAgentCall({
            write,
            policy: request.policy,
            paused: follow.getState().paused,
            freeze: getProjectWriteFreeze(),
            liveSession: this.liveSessionActive(ctx),
        });
        if (refused) {
            this.log("warning", request, `${request.tool} refused: ${refused.ok ? "" : refused.error.code}`);
            this.recordAtOnce(request, refused, meta);
            return refused;
        }

        const started = performance.now();
        const logId = this.activity.begin(request.tool, request.clientName, meta);
        // Calls run one at a time, so every write announced between begin and end is this call's.
        let firstWrite: AgentWriteTarget | null = null;
        const stopWatchingWrites = follow.onWrote(target => {
            firstWrite ??= target;
        });
        let target: string | null = null;
        follow.beginCall(request.callId, request.tool, request.clientName);
        const tool: AgentToolContext = {
            ctx,
            request,
            follow,
            offscreen: this.offscreen,
            log: (level, message) => this.log(level, request, `${request.tool}: ${message}`),
        };
        let result: AgentCallResult;
        try {
            result = await handler(request.args ?? {}, tool);
        } catch (error) {
            result = error instanceof AgentRefusal
                ? agentRefusal(error.code, error.message, error.hint)
                : agentRefusal("internal", `Studio failed while running ${request.tool}: ${error instanceof Error ? error.message : String(error)}`);
            if (!(error instanceof AgentRefusal)) {
                console.error(`[AgentBridge] ${request.tool} failed`, error);
            }
        } finally {
            const activity = follow.getState().activity;
            target = activity?.callId === request.callId ? activity.target : null;
            stopWatchingWrites();
            follow.endCall(request.callId);
        }
        const elapsed = Math.round(performance.now() - started);
        this.activity.end(logId, {
            ...finishOf(result),
            durationMs: elapsed,
            target: target ?? (firstWrite as AgentWriteTarget | null)?.name ?? null,
            reveal: firstWrite,
        });
        if (result.ok) {
            this.log("success", request, `${request.tool} (${elapsed} ms)`);
        } else {
            this.log(result.error.code === "internal" ? "error" : "warning", request, `${request.tool} refused: ${result.error.code} - ${result.error.message} (${elapsed} ms)`);
        }
        return result;
    }

    /** A call refused before it started: one finished entry, no running row. */
    private recordAtOnce(request: AgentCallRequest, result: AgentCallResult, meta?: AgentActivityToolMeta): void {
        this.activity.record(request.tool, request.clientName, "workspace", { ...finishOf(result), durationMs: 0 }, meta);
    }

    private liveSessionActive(ctx: WorkspaceContext): boolean {
        try {
            return ctx.services.get<LiveSessionService>(Services.Live).getView().phase !== "idle";
        } catch {
            return false;
        }
    }

    private log(level: ConsoleLogLevel, request: AgentCallRequest, message: string): void {
        const client = request.clientName ? `${request.clientName} ` : "";
        this.console?.log(AGENT_CONSOLE_CHANNEL, level, `${client}#${request.callId.slice(0, 8)} ${message}`, { source: AGENT_CONSOLE_SOURCE });
    }
}

function pluginMeta(descriptor: AgentPluginToolDescriptor): AgentActivityToolMeta {
    return { write: descriptor.write, pluginId: descriptor.pluginId, title: descriptor.title };
}

/**
 * Tell main which plugin tools this window has, now and after every change, so its `tools/list`
 * can follow. Coalesced to one report per task: a plugin registering ten tools in its setup is one
 * change to the list, not ten. A window without the preload bridge (a unit test) reports nothing.
 */
function reportPluginToolsToMain(registry: PluginAgentToolRegistry): (() => void) | null {
    let report: ((tools: readonly AgentPluginToolDescriptor[]) => void) | undefined;
    try {
        report = getAgentBridgeInterface().reportPluginTools;
    } catch {
        return null;
    }
    if (typeof report !== "function") {
        return null;
    }
    const send = report;
    let scheduled = false;
    let disposed = false;
    const flush = () => {
        scheduled = false;
        if (!disposed) {
            try {
                send(registry.list());
            } catch (error) {
                console.warn("[AgentBridge] Could not report plugin tools to main", error);
            }
        }
    };
    const schedule = () => {
        if (!scheduled) {
            scheduled = true;
            setTimeout(flush, 0);
        }
    };
    const unsubscribe = registry.subscribe(schedule);
    schedule();
    return () => {
        disposed = true;
        unsubscribe();
        try {
            send([]);
        } catch {
            // The window is going away; main drops its tools when it closes anyway.
        }
    };
}

function finishOf(result: AgentCallResult): { ok: boolean; code?: AgentErrorCode; message?: string; hint?: string } {
    return result.ok ? { ok: true } : { ok: false, code: result.error.code, message: result.error.message, hint: result.error.hint };
}

/**
 * Main's reports of the calls it answered itself, into this workspace's log. A window without the
 * preload bridge (a unit test) simply gets none.
 */
function subscribeToMainActivity(handler: (activity: AgentMainActivity) => void): (() => void) | null {
    try {
        const token = getInterface().agent?.onActivity?.(handler);
        return token ? () => token.cancel() : null;
    } catch {
        return null;
    }
}
