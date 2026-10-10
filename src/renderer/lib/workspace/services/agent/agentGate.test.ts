import { describe, expect, it } from "vitest";
import type { AgentSessionPolicy } from "@shared/agent/protocol";
import { gateAgentCall, type AgentGateInput } from "./agentGate";
import { agentWriteBlocked } from "./agentCommitGate";
import { Services } from "../services";

/**
 * Which agent calls are refused before any handler runs, and in which order. The order is the order
 * of the remedies: an author who has not switched writes on is told that first, whatever else is true.
 */

const allowed: AgentSessionPolicy = { writesEnabled: true, allowedImportRoots: [] };

function input(patch: Partial<AgentGateInput>): AgentGateInput {
    return { write: true, policy: allowed, paused: false, freeze: null, liveSession: false, ...patch };
}

function code(result: ReturnType<typeof gateAgentCall>): string | null {
    return result === null ? null : result.ok ? "ok" : result.error.code;
}

describe("gateAgentCall", () => {
    it("lets every read through, whatever the switches say", () => {
        expect(code(gateAgentCall(input({
            write: false,
            policy: { writesEnabled: false, allowedImportRoots: [] },
            paused: true,
            freeze: { projectPath: "/p", reason: { kind: "manual" } },
            liveSession: true,
        })))).toBeNull();
    });

    it("lets a write through when nothing stands in its way", () => {
        expect(code(gateAgentCall(input({})))).toBeNull();
    });

    it("refuses writes the author has not switched on, before anything else", () => {
        expect(code(gateAgentCall(input({
            policy: { writesEnabled: false, allowedImportRoots: [] },
            paused: true,
            freeze: { projectPath: "/p", reason: { kind: "merge" } },
        })))).toBe("writes_disabled");
    });

    it("refuses writes while paused", () => {
        expect(code(gateAgentCall(input({ paused: true, liveSession: true })))).toBe("paused");
    });

    it("reports a live session as itself, including the partial freeze a session arms", () => {
        expect(code(gateAgentCall(input({ liveSession: true })))).toBe("live_session");
        expect(code(gateAgentCall(input({
            freeze: { projectPath: "/p", reason: { kind: "live-session", session: "room", writable: [] } },
        })))).toBe("live_session");
    });

    it("refuses writes to a frozen project and says why", () => {
        const result = gateAgentCall(input({ freeze: { projectPath: "/p", reason: { kind: "merge" } } }));
        expect(code(result)).toBe("frozen");
        expect(result && !result.ok ? result.error.message : "").toContain("merge");
    });

    it("refuses writes to a project main says is not trusted, after the write switch and before the rest", () => {
        const untrusted = { ...allowed, projectTrusted: false };
        const result = gateAgentCall(input({ policy: untrusted, paused: true }));
        expect(code(result)).toBe("untrusted");
        expect(result && !result.ok ? result.error.message : "").toContain("may read it but not change it");
        expect(code(gateAgentCall(input({ policy: { ...untrusted, writesEnabled: false } })))).toBe("writes_disabled");
        expect(code(gateAgentCall(input({ write: false, policy: untrusted })))).toBeNull();
        expect(code(gateAgentCall(input({ policy: { ...allowed, projectTrusted: true } })))).toBeNull();
    });
});

describe("agentWriteBlocked", () => {
    function tool(state: { paused?: boolean; livePhase?: string; writesEnabled?: boolean }) {
        return {
            ctx: {
                services: {
                    get(id: Services) {
                        if (id === Services.Live && state.livePhase) {
                            return { getView: () => ({ phase: state.livePhase }) };
                        }
                        throw new Error(`no ${id}`);
                    },
                },
            },
            request: { policy: { writesEnabled: state.writesEnabled ?? true, allowedImportRoots: [] } },
            follow: { getState: () => ({ paused: state.paused ?? false }) },
        } as never;
    }

    it("lets a write commit when nothing changed since the call began", () => {
        expect(agentWriteBlocked(tool({}))).toBeNull();
        expect(agentWriteBlocked(tool({ livePhase: "idle" }))).toBeNull();
    });

    it("refuses with what was and was not written when the author paused or a live session began meanwhile", () => {
        const paused = agentWriteBlocked(tool({ paused: true }));
        expect(paused?.code).toBe("paused");
        expect(paused?.message).toMatch(/Nothing was written\.$/);
        const live = agentWriteBlocked(tool({ livePhase: "active" }), "Stopped after importing 2 of 5 file(s).");
        expect(live?.code).toBe("live_session");
        expect(live?.message).toMatch(/Stopped after importing 2 of 5 file\(s\)\.$/);
    });
});
