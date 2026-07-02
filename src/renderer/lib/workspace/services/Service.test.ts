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
    };
}

describe("Service lifecycle", () => {
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
});
