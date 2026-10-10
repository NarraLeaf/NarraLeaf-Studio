/**
 * The workspace half of Studio's MCP endpoint: carries out the calls main routes to this window.
 *
 * Main owns the network, the token and the tool table's validation; what reaches here is one
 * `AgentCallRequest` per call (`workspaceAgentCall`), with the author's switches attached. This
 * service gates it (write access, pause, freeze, live session), runs the tool's handler against the
 * same services the editor commits through, logs it to the console's agent channel, and answers an
 * `AgentCallResult` - always an answer, never a throw, because main waits for one.
 *
 * Calls run one at a time. Two agents (or one agent's parallel tool calls) writing the same page
 * would otherwise interleave their edits inside each other's undo steps, and an answer computed
 * while another call is half-written could describe a page that never existed.
 *
 * Comments in English per project convention.
 */

import {
    AGENT_INTERNAL_TOOL_STATE,
    agentRefusal,
    type AgentCallRequest,
    type AgentCallResult,
    type AgentWorkspaceState,
} from "@shared/agent/protocol";
import { AGENT_TOOLS_BY_NAME } from "@shared/agent/tools";
import { getProjectWriteFreeze } from "@/lib/app/writeFreeze";
import { Service } from "../Service";
import { Services, type WorkspaceContext } from "../services";
import type { ConsoleService, ConsoleLogLevel } from "../core/ConsoleService";
import type { LiveSessionService } from "../live/LiveSessionService";
import { AgentFollowService } from "./AgentFollowService";
import { AgentOffscreenRenderer } from "./agentOffscreenRenderer";
import { AgentRefusal, type AgentToolContext, type AgentToolHandler } from "./agentCall";
import { gateAgentCall } from "./agentGate";
import { createAgentInternalHandlers, createAgentToolHandlers } from "./agentHandlers";
import { AGENT_CONSOLE_CHANNEL, AGENT_CONSOLE_SOURCE } from "./agentConsole";

export { AGENT_CONSOLE_CHANNEL, AGENT_CONSOLE_SOURCE };

export class AgentBridgeService extends Service<AgentBridgeService> {
    private readonly handlers = createAgentToolHandlers();
    private readonly internal = createAgentInternalHandlers();
    private readonly offscreen = new AgentOffscreenRenderer();
    private queue: Promise<unknown> = Promise.resolve();
    private disposeChannel: (() => void) | null = null;
    private console: ConsoleService | null = null;
    private follow: AgentFollowService | null = null;

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
    }

    public override dispose(_ctx: WorkspaceContext): void {
        this.disposeChannel?.();
        this.disposeChannel = null;
        this.console = null;
        this.follow = null;
    }

    /** Where `ui_screenshot` mounts the page it photographs; the workspace layout hosts it. */
    public getOffscreenRenderer(): AgentOffscreenRenderer {
        return this.offscreen;
    }

    /** The handler table, for the coverage test and for nothing else. */
    public getToolNames(): string[] {
        return Object.keys(this.handlers);
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
        const internal = this.internal[request.tool];
        let handler: AgentToolHandler | undefined;
        let write: boolean;
        if (internal) {
            handler = internal.handler;
            write = internal.write;
        } else if (descriptor && descriptor.side === "workspace") {
            handler = this.handlers[request.tool];
            write = descriptor.write;
        } else {
            write = false;
        }
        if (!handler) {
            this.log("warning", request, `unknown tool ${request.tool}`);
            return agentRefusal("unknown_tool", `This Studio window has no tool called "${request.tool}".`);
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
            return refused;
        }

        const started = performance.now();
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
            follow.endCall(request.callId);
        }
        const elapsed = Math.round(performance.now() - started);
        if (result.ok) {
            this.log("success", request, `${request.tool} (${elapsed} ms)`);
        } else {
            this.log(result.error.code === "internal" ? "error" : "warning", request, `${request.tool} refused: ${result.error.code} - ${result.error.message} (${elapsed} ms)`);
        }
        return result;
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
