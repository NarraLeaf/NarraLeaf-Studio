import { describe, expect, it, vi } from "vitest";
import { Service } from "./Service";
import type { WorkspaceContext } from "./services";

vi.mock("@/lib/ui-editor/widget-modules/registryInstance", () => ({
    ensureWidgetModulesRegistered: async () => undefined,
}));

/**
 * `initializeTolerant` is the mechanism the recovery shell's one promise rests on: the window opens
 * whatever is wrong with the project. These tests are about that promise, not about the graph walk.
 */

const ctx = { services: {}, project: {} } as unknown as WorkspaceContext;

class TestService extends Service<any> {
    public initCount = 0;
    public constructor(
        private readonly behavior: (depend: (services: Service[]) => Promise<void>) => Promise<void>,
    ) {
        super();
    }
    protected async init(_ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        this.initCount += 1;
        await this.behavior(depend);
    }
}

const ok = () => new TestService(async () => undefined);
const failing = (message: string) => new TestService(async () => {
    throw new Error(message);
});

describe("Service.initializeTolerant", () => {
    it("brings up the survivors and reports the casualty", () => {
        const good = ok();
        const bad = failing("assets are unreadable");

        return Service.initializeTolerant(ctx, [bad, good]).then(failures => {
            expect(failures).toHaveLength(1);
            expect((failures[0].error as Error).message).toBe("assets are unreadable");
            expect(failures[0].service).toBe(bad);
            // The point of the whole exercise: one service failing did not stop the next.
            expect(good.isInitialized(ctx)).toBe(true);
            expect(bad.isInitialized(ctx)).toBe(false);
        });
    });

    it("does not let a dead dependency abort its dependents", async () => {
        const dependency = failing("nope");
        let sawDependencyReturn = false;
        const dependent = new TestService(async depend => {
            await depend([dependency]);
            // In `initializeAll` this line is unreachable - `depend` rethrows. Here it must run:
            // that is the difference that keeps one broken file from emptying the whole window.
            sawDependencyReturn = true;
        });

        const failures = await Service.initializeTolerant(ctx, [dependent]);

        expect(sawDependencyReturn).toBe(true);
        expect(dependent.isInitialized(ctx)).toBe(true);
        expect(failures.map(failure => failure.service)).toEqual([dependency]);
    });

    it("reports a root cause before the failure it caused", async () => {
        const dependency = failing("the actual problem");
        const dependent = new TestService(async depend => {
            await depend([dependency]);
            throw new Error("follow-on");
        });

        const failures = await Service.initializeTolerant(ctx, [dependent]);

        // Order is what makes the list readable: the first row is the one worth acting on.
        expect(failures.map(failure => (failure.error as Error).message))
            .toEqual(["the actual problem", "follow-on"]);
    });

    it("tries a shared failing dependency once per pass", async () => {
        const shared = failing("shared");
        const first = new TestService(depend => depend([shared]));
        const second = new TestService(depend => depend([shared]));

        const failures = await Service.initializeTolerant(ctx, [first, second]);

        // Otherwise one damaged file is listed once per service that reads it, and the panel shows
        // five copies of one problem.
        expect(shared.initCount).toBe(1);
        expect(failures).toHaveLength(1);
    });

    it("records a dependency cycle instead of throwing out of the pass", async () => {
        const a: TestService = new TestService(depend => depend([b]));
        const b: TestService = new TestService(depend => depend([a]));

        const failures = await Service.initializeTolerant(ctx, [a]);

        expect(failures.some(failure => String((failure.error as Error).message).includes("Circular dependency")))
            .toBe(true);
    });
});
