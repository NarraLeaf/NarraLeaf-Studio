import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PROJECT_STATS_SETTINGS_KEY_PREFIX } from "@shared/types/stats";
import { Services, type WorkspaceContext } from "../services";
import { ProjectStatsService } from "./ProjectStatsService";

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ app: { state: {} } }),
}));

const PROJECT_PATH = "D:/projects/my-game";
const PROJECT_IDENTIFIER = "com.acme.my-game";

function makeHarness(commandLineRun: boolean) {
    const get = vi.fn(async (_key: string): Promise<unknown> => undefined);
    const set = vi.fn(async (_key: string, _value: unknown): Promise<void> => undefined);

    const stubs: Record<string, unknown> = {
        [Services.Project]: { getProjectConfig: () => ({ identifier: PROJECT_IDENTIFIER, name: "My Game" }) },
        [Services.GlobalSettings]: { get, set },
        [Services.Story]: {},
    };

    const ctx = {
        project: { getConfig: () => ({ projectPath: PROJECT_PATH }) },
        commandLineRun,
        services: {
            get: (id: string) => {
                const stub = stubs[id];
                if (!stub) {
                    // What the real registry does for a service this window never started. Every
                    // optional source in the table is wrapped in its own try/catch for this.
                    throw new Error(`Service ${id} not found`);
                }
                return stub;
            },
        },
    } as unknown as WorkspaceContext;

    return { ctx, get, set, service: new ProjectStatsService() };
}

describe("ProjectStatsService in a command-line run", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        // The table of edit sources warns for every surface this harness does not stand up, which
        // is the point of the try/catch around each - it is not what these tests are about.
        vi.spyOn(console, "warn").mockImplementation(() => undefined);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("reads and writes nothing for a run", async () => {
        const { ctx, get, set, service } = makeHarness(true);

        service.setContext(ctx);
        await service.initialize(ctx, async () => undefined);
        await vi.advanceTimersByTimeAsync(60_000);
        service.dispose(ctx);
        await vi.advanceTimersByTimeAsync(60_000);

        expect(get).not.toHaveBeenCalled();
        expect(set).not.toHaveBeenCalled();
    });

    it("records the session for a window somebody is working in", async () => {
        const { ctx, get, set, service } = makeHarness(false);

        service.setContext(ctx);
        await service.initialize(ctx, async () => undefined);

        expect(get).toHaveBeenCalledTimes(1);
        expect(String(get.mock.calls[0][0])).toContain(PROJECT_STATS_SETTINGS_KEY_PREFIX);

        // The load stamps "active now" and schedules the debounced write that carries it to disk.
        await vi.advanceTimersByTimeAsync(5_000);
        expect(set).toHaveBeenCalledTimes(1);
        const written = set.mock.calls[0][1] as { lastActiveAt: number | null };
        expect(typeof written.lastActiveAt).toBe("number");

        service.dispose(ctx);
    });
});
