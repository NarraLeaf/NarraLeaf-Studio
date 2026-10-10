import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type { AgentCallRequest, AgentCallResult, AgentSessionPolicy } from "@shared/agent/protocol";
import { AGENT_INTERNAL_TOOL_STATE } from "@shared/agent/protocol";
import { freezeProjectWrites, thawProjectWrites } from "@/lib/app/writeFreeze";
import { Services } from "../services";
import { AgentBridgeService } from "./AgentBridgeService";
import { AgentFollowService } from "./AgentFollowService";
import type { AgentPluginToolDescriptor } from "@shared/agent/pluginTools";

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
function call(tool: string, args: Record<string, unknown>, policy: AgentSessionPolicy = WRITES_ON, deadline = Date.now() + 30_000): AgentCallRequest {
    callCount += 1;
    return { callId: `call-${callCount}-0000`, tool, args, clientName: "test-client", policy, deadline };
}

function codeOf(result: AgentCallResult): string {
    return result.ok ? "ok" : result.error.code;
}

afterEach(() => {
    thawProjectWrites();
});

describe("AgentBridgeService", () => {
    // The bridge loads its handler tables on the first call (see AgentHandlerTables). Under vitest
    // that first load transforms the whole tool tree and can outlast a test's default timeout, so it
    // is paid once here instead of inside whichever test happens to run first.
    beforeAll(async () => {
        await import("./agentHandlers");
    }, 120_000);

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

    it("records every call in the activity log, refusals included, and never main's internal calls", async () => {
        const harness = createHarness();
        await harness.init();
        await harness.bridge.handle(call("audio_tracks_list", {}));
        await harness.bridge.handle(call("project_settings_set", { name: "After" }, WRITES_OFF));
        await harness.bridge.handle(call(AGENT_INTERNAL_TOOL_STATE, {}));
        const entries = harness.bridge.getActivityLog().getEntries();
        expect(entries.map(entry => [entry.tool, entry.status, entry.code ?? null, entry.write])).toEqual([
            ["audio_tracks_list", "ok", null, false],
            ["project_settings_set", "refused", "writes_disabled", true],
        ]);
        expect(entries[0].clientName).toBe("test-client");
        expect(entries[0].durationMs).not.toBeNull();
        expect(entries[1].message).toContain("Write access");
    });

    describe("deadlines", () => {
        /** A plugin tool per name: `acme_slow__build` waits for `release`, `acme_scenes__add` counts its runs. */
        function withSlowBuildAndCountedWrite(harness: ReturnType<typeof createHarness>) {
            let release!: () => void;
            const released = new Promise<void>(resolve => {
                release = resolve;
            });
            const runs = { build: 0, add: 0 };
            const descriptor = (name: string, write: boolean): AgentPluginToolDescriptor => ({
                name,
                title: name,
                description: "Plugin tool.",
                side: "workspace",
                write,
                inputSchema: { type: "object", properties: { project: { type: "string" } } },
                pluginId: "acme.tools",
                pluginName: "Tools",
                pluginToolName: name,
            });
            harness.bridge.pluginTools().register({
                descriptor: descriptor("acme_slow__build", true),
                run: async () => {
                    runs.build += 1;
                    await released;
                    return { ok: true, content: [{ type: "text", text: "built" }] };
                },
            });
            harness.bridge.pluginTools().register({
                descriptor: descriptor("acme_scenes__add", true),
                run: async () => {
                    runs.add += 1;
                    return { ok: true, content: [{ type: "text", text: "added" }] };
                },
            });
            return { runs, release };
        }

        it("refuses a call whose deadline has passed, says nothing was done, and runs nothing", async () => {
            const harness = createHarness();
            await harness.init();
            const result = await harness.bridge.handle(call("project_settings_set", { name: "After" }, WRITES_ON, Date.now() - 1));
            expect(result).toMatchObject({ ok: false, error: { code: "unavailable" } });
            expect(result.ok ? "" : result.error.message).toBe("project_settings_set timed out before it started; nothing was done.");
            expect(harness.projectName()).toBe("Before");
            expect(harness.bridge.getActivityLog().getEntries().map(entry => [entry.tool, entry.status])).toEqual([["project_settings_set", "refused"]]);
        });

        it("never starts a write that timed out waiting behind a long call, so its retry is the only one that lands", async () => {
            const harness = createHarness();
            await harness.init();
            const { runs, release } = withSlowBuildAndCountedWrite(harness);
            const build = harness.bridge.handle(call("acme_slow__build", {}));
            // Main gives up on this one while the build holds the queue...
            const timedOut = harness.bridge.handle(call("acme_scenes__add", {}, WRITES_ON, Date.now() + 20));
            await new Promise(resolve => setTimeout(resolve, 60));
            // ...and the agent, told it timed out, sends it again with a fresh deadline.
            const retry = harness.bridge.handle(call("acme_scenes__add", {}));
            release();
            expect(codeOf(await build)).toBe("ok");
            const first = await timedOut;
            expect(codeOf(first)).toBe("unavailable");
            expect(first.ok ? "" : first.error.message).toContain("timed out before it started");
            expect(codeOf(await retry)).toBe("ok");
            expect(runs).toEqual({ build: 1, add: 1 });
        });

        it("still runs a queued call whose deadline is ahead when its turn comes", async () => {
            const harness = createHarness();
            await harness.init();
            const { runs, release } = withSlowBuildAndCountedWrite(harness);
            const build = harness.bridge.handle(call("acme_slow__build", {}));
            const queued = harness.bridge.handle(call("acme_scenes__add", {}, WRITES_ON, Date.now() + 10_000));
            release();
            await build;
            expect(codeOf(await queued)).toBe("ok");
            expect(runs.add).toBe(1);
        });

        it("answers the state call even past a deadline: it reads, and never waits in the queue", async () => {
            const harness = createHarness();
            await harness.init();
            const result = await harness.bridge.handle(call(AGENT_INTERNAL_TOOL_STATE, {}, WRITES_ON, Date.now() - 1));
            expect(codeOf(result)).toBe("ok");
        });
    });

    describe("plugin tools", () => {
        const descriptor = (write: boolean): AgentPluginToolDescriptor => ({
            name: write ? "acme_notes__add" : "acme_notes__list",
            title: write ? "Add notes" : "List notes",
            description: "Plugin tool.",
            side: "workspace",
            write,
            inputSchema: { type: "object", properties: { project: { type: "string" } } },
            pluginId: "acme.notes",
            pluginName: "Notes",
            pluginToolName: write ? "acme.notes.add" : "acme.notes.list",
        });

        function withPluginTools(harness: ReturnType<typeof createHarness>) {
            const ran: string[] = [];
            for (const write of [false, true]) {
                harness.bridge.pluginTools().register({
                    descriptor: descriptor(write),
                    run: async (_args, call) => {
                        ran.push(`${write ? "add" : "list"}:${call.clientName}`);
                        return { ok: true, content: [{ type: "text", text: "done" }] };
                    },
                });
            }
            return ran;
        }

        it("runs a registered plugin tool and logs it under the plugin's own title and id", async () => {
            const harness = createHarness();
            await harness.init();
            const ran = withPluginTools(harness);
            expect(codeOf(await harness.bridge.handle(call("acme_notes__add", {})))).toBe("ok");
            expect(ran).toEqual(["add:test-client"]);
            const [entry] = harness.bridge.getActivityLog().getEntries();
            expect(entry).toMatchObject({ tool: "acme_notes__add", title: "Add notes", pluginId: "acme.notes", write: true, status: "ok" });
        });

        it("gates a writing plugin tool exactly as Studio's own: writes off, paused, frozen, live session", async () => {
            const harness = createHarness();
            await harness.init();
            const ran = withPluginTools(harness);
            expect(codeOf(await harness.bridge.handle(call("acme_notes__add", {}, WRITES_OFF)))).toBe("writes_disabled");
            harness.follow.setPaused(true);
            expect(codeOf(await harness.bridge.handle(call("acme_notes__add", {})))).toBe("paused");
            harness.follow.setPaused(false);
            freezeProjectWrites({ projectPath: "/project", reason: { kind: "manual" } });
            expect(codeOf(await harness.bridge.handle(call("acme_notes__add", {})))).toBe("frozen");
            // A reading one still runs: reads are never gated.
            expect(codeOf(await harness.bridge.handle(call("acme_notes__list", {})))).toBe("ok");
            thawProjectWrites();
            const live = createHarness({ livePhase: "active" });
            await live.init();
            withPluginTools(live);
            expect(codeOf(await live.bridge.handle(call("acme_notes__add", {})))).toBe("live_session");
            expect(ran).toEqual(["list:test-client"]);
        });

        it("refuses a plugin the author switched off, and says the plugin is not loaded for a tool nobody registered", async () => {
            const harness = createHarness();
            await harness.init();
            const ran = withPluginTools(harness);
            const blocked = await harness.bridge.handle(call("acme_notes__list", {}, { ...WRITES_ON, blockedPluginIds: ["acme.notes"] }));
            expect(codeOf(blocked)).toBe("unavailable");
            const missing = await harness.bridge.handle(call("other_plugin__list", {}));
            expect(codeOf(missing)).toBe("unknown_tool");
            expect(missing.ok ? "" : missing.error.hint).toContain("not loaded in this project");
            expect(ran).toEqual([]);
        });
    });
});
