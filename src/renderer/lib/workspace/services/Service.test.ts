import { describe, expect, it, vi } from "vitest";
import { Service } from "./Service";
import type { WorkspaceContext } from "./services";

vi.mock("@/lib/ui-editor/widget-modules/registryInstance", () => ({
    ensureWidgetModulesRegistered: vi.fn(async () => undefined),
}));

function deferred() {
    let resolve!: () => void;
    const promise = new Promise<void>(res => {
        resolve = res;
    });
    return { promise, resolve };
}

class TestService extends Service<TestService> {
    public readonly initializedContexts: WorkspaceContext[] = [];
    public readonly disposedContexts: WorkspaceContext[] = [];
    public delayFirstInit: Promise<void> | null = null;

    protected async init(ctx: WorkspaceContext): Promise<void> {
        this.initializedContexts.push(ctx);
        if (this.initializedContexts.length === 1 && this.delayFirstInit) {
            await this.delayFirstInit;
        }
    }

    public override dispose(ctx: WorkspaceContext): void {
        this.disposedContexts.push(ctx);
    }
}

function createContext(services: Service[]): WorkspaceContext {
    return {
        project: {} as WorkspaceContext["project"],
        services: {
            getAll: () => services,
            get: () => {
                throw new Error("Unexpected service lookup in test");
            },
        } as any,
        commandLineRun: false,
    };
}

describe("Service lifecycle", () => {
    it("tears services down in the reverse of the order they came up", async () => {
        const order: string[] = [];
        class Named extends Service<Named> {
            constructor(private readonly name: string, private readonly deps: () => Service[] = () => []) {
                super();
            }
            protected async init(_ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
                await depend(this.deps());
            }
            public override dispose(): void {
                order.push(this.name);
            }
        }
        const base = new Named("base");
        const dependent = new Named("dependent", () => [base]);
        // Registered dependent-last, as the registry lists them; initializeAll walks it backwards
        // and brings `base` up through the dependency first.
        const ctx = createContext([base, dependent]);

        await Service.initializeAll(ctx);
        await Service.disposeAll(ctx);

        expect(order).toEqual(["dependent", "base"]);
    });

    it("resets services after disposeAll so a new workspace context reinitializes them", async () => {
        const service = new TestService();
        const ctx1 = createContext([service]);
        const ctx2 = createContext([service]);

        await Service.initializeAll(ctx1);
        await Service.disposeAll(ctx1);
        await Service.initializeAll(ctx2);

        expect(service.initializedContexts).toEqual([ctx1, ctx2]);
        expect(service.disposedContexts).toEqual([ctx1]);
        expect(service.getContext()).toBe(ctx2);
    });

    it("does not skip initializeAll when the service belongs to a previous context", async () => {
        const service = new TestService();
        const ctx1 = createContext([service]);
        const ctx2 = createContext([service]);

        await Service.initializeAll(ctx1);
        await Service.initializeAll(ctx2);

        expect(service.initializedContexts).toEqual([ctx1, ctx2]);
        expect(service.disposedContexts).toEqual([ctx1]);
        expect(service.getContext()).toBe(ctx2);
    });

    it("waits for an in-flight initialization before switching to a new context", async () => {
        const service = new TestService();
        const firstInit = deferred();
        service.delayFirstInit = firstInit.promise;
        const ctx1 = createContext([service]);
        const ctx2 = createContext([service]);

        const first = service.initialize(ctx1, async () => undefined);
        const second = service.initialize(ctx2, async () => undefined);

        expect(service.initializedContexts).toEqual([ctx1]);
        firstInit.resolve();
        await Promise.all([first, second]);

        expect(service.initializedContexts).toEqual([ctx1, ctx2]);
        expect(service.disposedContexts).toEqual([ctx1]);
        expect(service.getContext()).toBe(ctx2);
    });

    it("finishes teardown before starting the same service in a new workspace", async () => {
        const disposeStarted = deferred();
        const allowDispose = deferred();
        const events: string[] = [];
        class SlowDisposal extends Service<SlowDisposal> {
            protected init(ctx: WorkspaceContext): void {
                events.push(ctx === first ? "init first" : "init second");
            }
            public override async dispose(): Promise<void> {
                events.push("dispose started");
                disposeStarted.resolve();
                await allowDispose.promise;
                events.push("dispose finished");
            }
        }
        const service = new SlowDisposal();
        const first = createContext([service]);
        const second = createContext([service]);
        await Service.initializeAll(first);

        const teardown = Service.disposeAll(first);
        await disposeStarted.promise;
        const next = Service.initializeAll(second);
        await Promise.resolve();
        allowDispose.resolve();
        await Promise.all([teardown, next]);

        expect(events).toEqual(["init first", "dispose started", "dispose finished", "init second"]);
        expect(service.isInitialized(second)).toBe(true);
        expect(service.getContext()).toBe(second);
    });

    it("waits for a context switch before tearing down its new workspace", async () => {
        const disposeStarted = deferred();
        const allowDispose = deferred();
        const events: string[] = [];
        class SlowDisposal extends Service<SlowDisposal> {
            protected init(ctx: WorkspaceContext): void {
                events.push(ctx === first ? "init first" : "init second");
            }
            public override async dispose(ctx: WorkspaceContext): Promise<void> {
                events.push(ctx === first ? "dispose first" : "dispose second");
                if (ctx === first) {
                    disposeStarted.resolve();
                    await allowDispose.promise;
                }
            }
        }
        const service = new SlowDisposal();
        const first = createContext([service]);
        const second = createContext([service]);
        await Service.initializeAll(first);

        const next = Service.initializeAll(second);
        await disposeStarted.promise;
        const teardown = Service.disposeAll(second);
        allowDispose.resolve();
        await Promise.all([next, teardown]);

        expect(events).toEqual(["init first", "dispose first", "init second", "dispose second"]);
        expect(service.isInitialized(second)).toBe(false);
        expect(() => service.getContext()).toThrow();
    });

    it("disposes a context once even if teardown is requested twice", async () => {
        const disposeStarted = deferred();
        const allowDispose = deferred();
        let disposeCount = 0;
        class SlowDisposal extends Service<SlowDisposal> {
            protected init(): void { }
            public override async dispose(): Promise<void> {
                disposeCount++;
                disposeStarted.resolve();
                await allowDispose.promise;
            }
        }
        const service = new SlowDisposal();
        const ctx = createContext([service]);
        await Service.initializeAll(ctx);
        const first = Service.disposeAll(ctx);
        await disposeStarted.promise;
        const second = Service.disposeAll(ctx);
        allowDispose.resolve();
        await Promise.all([first, second]);
        expect(disposeCount).toBe(1);
        expect(service.isInitialized(ctx)).toBe(false);
    });

    it("reinitializes the same workspace after an in-flight teardown", async () => {
        const disposeStarted = deferred();
        const allowDispose = deferred();
        let initCount = 0;
        class SlowDisposal extends Service<SlowDisposal> {
            protected init(): void { initCount++; }
            public override async dispose(): Promise<void> {
                disposeStarted.resolve();
                await allowDispose.promise;
            }
        }
        const service = new SlowDisposal();
        const ctx = createContext([service]);
        await Service.initializeAll(ctx);
        const teardown = Service.disposeAll(ctx);
        await disposeStarted.promise;
        const next = Service.initializeAll(ctx);
        allowDispose.resolve();
        await Promise.all([teardown, next]);
        expect(initCount).toBe(2);
        expect(service.isInitialized(ctx)).toBe(true);
    });

    it.each(["normal", "recovery"] as const)("waits for in-flight %s dependents before choosing teardown order", async mode => {
        const dependentStarted = deferred();
        const allowDependent = deferred();
        const order: string[] = [];
        class Base extends Service<Base> {
            protected init(): void { }
            public override dispose(): void { order.push("base"); }
        }
        class Dependent extends Service<Dependent> {
            protected async init(_ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
                await depend([base]);
                dependentStarted.resolve();
                await allowDependent.promise;
            }
            public override dispose(): void {
                order.push(base.isInitialized(ctx) ? "dependent" : "dependent after base");
            }
        }
        const base = new Base();
        const dependent = new Dependent();
        const ctx = createContext([base, dependent]);
        const init = mode === "normal"
            ? Service.initializeAll(ctx)
            : Service.initializeTolerant(ctx, [dependent, base]);
        await dependentStarted.promise;
        const teardown = Service.disposeAll(ctx);
        allowDependent.resolve();
        await Promise.all([init, teardown]);
        expect(order).toEqual(["dependent", "base"]);
        expect(base.isInitialized(ctx)).toBe(false);
        expect(dependent.isInitialized(ctx)).toBe(false);
    });
});
