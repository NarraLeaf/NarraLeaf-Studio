import { afterEach, describe, expect, it } from "vitest";
import type { AgentCallRequest, AgentCallResult, AgentSessionPolicy } from "@shared/agent/protocol";
import { AGENT_INTERNAL_TOOL_STATE } from "@shared/agent/protocol";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { Services } from "../services";
import { AgentBridgeService } from "./AgentBridgeService";
import { AgentFollowService } from "./AgentFollowService";

/**
 * The bridge's own decisions, with the tools stubbed out underneath: which calls are refused before
 * a handler runs, what a refusal looks like, and that every call - refused or not - is logged.
 */

const WRITES_ON: AgentSessionPolicy = { writesEnabled: true, allowedImportRoots: [] };
const WRITES_OFF: AgentSessionPolicy = { writesEnabled: false, allowedImportRoots: [] };

function createHarness(options: { livePhase?: string } = {}) {
    const lines: { level: string; message: string }[] = [];
    let projectName = "Before";
    const project = {
        getProjectConfig: () => ({ name: projectName, metadata: { resolution: { width: 1920, height: 1080 } } }),
        updateProjectName: async (name: string) => {
            projectName = name;
        },
        updateProjectMetadata: async () => undefined,
    };
    const follow = new AgentFollowService();
    const bridge = new AgentBridgeService();
    const context = {
        project: { getConfig: () => ({ projectPath: "/project" }), resolve: (name: string) => name } as any,
        services: {
            get(serviceId: Services) {
                switch (serviceId) {
                    case Services.Console:
                        return {
                            registerChannel: () => () => undefined,
                            log: (_channel: string, level: string, message: string) => {
                                lines.push({ level, message });
                            },
                        };
                    case Services.AgentFollow:
                        return follow;
                    case Services.PanelState:
                        return { getPanelState: () => undefined, setPanelState: () => undefined };
                    case Services.Live:
                        return { getView: () => ({ phase: options.livePhase ?? "idle" }) };
                    case Services.AudioTracks:
                        return { listTracks: () => [{ id: "music", name: "Music", parentId: null, volume: 1, loop: true, builtin: true }] };
                    case Services.Project:
                        return project;
                    default:
                        throw new Error(`Unexpected service ${serviceId}`);
                }
            },
        } as any,
        commandLineRun: false,
    };
    follow.setContext(context);
    bridge.setContext(context);
    return {
        bridge,
        follow,
        lines,
        projectName: () => projectName,
        async init() {
            await (follow as any).init(context, async () => undefined);
            await (bridge as any).init(context, async () => undefined);
        },
    };
}

let callCount = 0;
function call(tool: string, args: Record<string, unknown>, policy: AgentSessionPolicy = WRITES_ON): AgentCallRequest {
    callCount += 1;
    return { callId: `call-${callCount}-0000`, tool, args, clientName: "test-client", policy };
}

function codeOf(result: AgentCallResult): string {
    return result.ok ? "ok" : result.error.code;
}

afterEach(() => {
    thawProjectWrites();
});

describe("AgentBridgeService", () => {
    it("answers a read tool and logs it in the agent channel", async () => {
        const harness = createHarness();
        await harness.init();
        const result = await harness.bridge.handle(call("audio_tracks_list", {}));
        expect(codeOf(result)).toBe("ok");
        expect(result.ok ? result.structured?.tracks : null).toEqual([
            { id: "music", name: "Music", parentId: null, volume: 1, loop: true, builtin: true },
        ]);
        expect(harness.lines.some(line => line.message.includes("audio_tracks_list"))).toBe(true);
        expect(harness.follow.getState().clientName).toBe("test-client");
    });

    it("refuses a tool it does not have, and main's tools, as unknown", async () => {
        const harness = createHarness();
        await harness.init();
        expect(codeOf(await harness.bridge.handle(call("no_such_tool", {})))).toBe("unknown_tool");
        expect(codeOf(await harness.bridge.handle(call("project_create", { name: "x" })))).toBe("unknown_tool");
    });

    it("refuses writes the author has not switched on, and runs nothing", async () => {
        const harness = createHarness();
        await harness.init();
        const result = await harness.bridge.handle(call("project_settings_set", { name: "After" }, WRITES_OFF));
        expect(codeOf(result)).toBe("writes_disabled");
        expect(harness.projectName()).toBe("Before");
    });

    it("refuses writes while the author has paused the agent, and lets them through after", async () => {
        const harness = createHarness();
        await harness.init();
        harness.follow.setPaused(true);
        expect(codeOf(await harness.bridge.handle(call("project_settings_set", { name: "After" })))).toBe("paused");
        expect(harness.projectName()).toBe("Before");
        // Reads are not paused.
        expect(codeOf(await harness.bridge.handle(call("audio_tracks_list", {})))).toBe("ok");
        harness.follow.setPaused(false);
        expect(codeOf(await harness.bridge.handle(call("project_settings_set", { name: "After" })))).toBe("ok");
        expect(harness.projectName()).toBe("After");
    });

    it("refuses writes to a frozen project", async () => {
        const harness = createHarness();
        await harness.init();
        freezeProjectWrites({ projectPath: "/project", reason: { kind: "manual" } });
        expect(codeOf(await harness.bridge.handle(call("project_settings_set", { name: "After" })))).toBe("frozen");
        expect(harness.projectName()).toBe("Before");
    });

    it("refuses writes while a live session runs", async () => {
        const harness = createHarness({ livePhase: "active" });
        await harness.init();
        expect(codeOf(await harness.bridge.handle(call("project_settings_set", { name: "After" })))).toBe("live_session");
    });

    it("answers the state call with the pause and follow switches", async () => {
        const harness = createHarness();
        await harness.init();
        harness.follow.setPaused(true);
        const result = await harness.bridge.handle(call(AGENT_INTERNAL_TOOL_STATE, {}));
        expect(result.ok ? result.structured : null).toEqual({ paused: true, follow: true });
    });

    it("turns a handler's own refusal into an answer rather than a failure", async () => {
        const harness = createHarness();
        await harness.init();
        const result = await harness.bridge.handle(call("project_settings_set", {}));
        expect(codeOf(result)).toBe("invalid_args");
    });

    it("turns an unexpected failure inside a handler into an internal error naming the tool", async () => {
        // This harness has no story service, so the handler fails the way a broken service would.
        const harness = createHarness();
        await harness.init();
        const result = await harness.bridge.handle(call("story_show", { scene: "x" }));
        expect(codeOf(result)).toBe("internal");
        expect(result.ok ? "" : result.error.message).toContain("story_show");
    });
});
