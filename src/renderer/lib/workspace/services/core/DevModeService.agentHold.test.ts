import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Services, type WorkspaceContext } from "../services";
import { DevModeService } from "./DevModeService";

/**
 * The author is asked before they stop a Dev Mode session an agent's play-test holds; the agent is
 * not, and a session nobody holds is stopped without a question.
 */

const bridge = vi.hoisted(() => ({
    agentHeld: true,
    stops: 0,
}));

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({
        devMode: {
            getStatus: async () => ({ success: true, data: { status: "running", agentHeld: bridge.agentHeld } }),
            stop: async () => {
                bridge.stops += 1;
                return { success: true, data: { status: "idle" } };
            },
            onConsoleLog: () => ({ cancel: () => undefined }),
        },
    }),
}));

let confirmAnswer = false;
let confirmations = 0;
let service: DevModeService;
let ctx: WorkspaceContext;

beforeEach(() => {
    bridge.agentHeld = true;
    bridge.stops = 0;
    confirmAnswer = false;
    confirmations = 0;
    ctx = {
        project: { getConfig: () => ({ projectPath: "/projects/game" }) },
        services: {
            get: (id: string) => {
                if (id === Services.UI) {
                    return {
                        showDestructiveConfirm: async () => {
                            confirmations += 1;
                            return confirmAnswer;
                        },
                    };
                }
                throw new Error(`Service ${id} not found`);
            },
        },
    } as unknown as WorkspaceContext;
    service = new DevModeService();
    service.setContext(ctx);
});

afterEach(() => {
    service.dispose(ctx);
});

describe("stopping a Dev Mode session an agent holds", () => {
    it("reads the hold from the status", async () => {
        await service.refreshStatus();
        expect(service.isAgentHeld()).toBe(true);
    });

    it("asks the author, and does nothing when they decline", async () => {
        await service.refreshStatus();

        await service.stop();

        expect(confirmations).toBe(1);
        expect(bridge.stops).toBe(0);
        expect(service.isAgentHeld()).toBe(true);
    });

    it("stops when the author confirms, and the session is no longer held", async () => {
        await service.refreshStatus();
        confirmAnswer = true;

        await expect(service.stop()).resolves.toBe("idle");

        expect(bridge.stops).toBe(1);
        expect(service.isAgentHeld()).toBe(false);
    });

    it("does not ask the agent", async () => {
        await service.refreshStatus();

        await service.stop({ agent: true });

        expect(confirmations).toBe(0);
        expect(bridge.stops).toBe(1);
    });

    it("does not ask once the agent has let go", async () => {
        await service.refreshStatus();
        bridge.agentHeld = false;

        await service.stop();

        expect(confirmations).toBe(0);
        expect(bridge.stops).toBe(1);
    });
});
