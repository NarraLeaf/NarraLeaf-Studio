import { Singleton } from "@shared/utils/singleton";
import { ensureWidgetModulesRegistered } from "@/lib/ui-editor/widget-modules/registryInstance";
import { IService, WorkspaceContext } from "./services";

export abstract class Service<T extends Service<T> = Service<any>> extends Singleton<T> implements IService {
    private ctx: WorkspaceContext | null = null;
    private _initialized = false;
    private _initializing: Promise<void> | null = null;

    public static async initializeAll(ctx: WorkspaceContext): Promise<void> {
        await ensureWidgetModulesRegistered();

        const pending = new Set<Service>();

        const init = async (service: Service): Promise<void> => {
            if (service._initialized && service.ctx === ctx) return;
            if (pending.has(service)) {
                const cycle = [...pending, service].map(s => s.constructor.name).join(" -> ");
                throw new Error(`Circular dependency detected: ${cycle}`);
            }
            pending.add(service);
            const depend = async (deps: Service[]): Promise<void> => {
                for (const dep of deps) {
                    await init(dep);
                }
            };
            try {
                await service.initialize(ctx, depend);
            } finally {
                pending.delete(service);
            }
        };

        const all = ctx.services.getAll();
        for (let i = all.length - 1; i >= 0; i--) {
            await init(all[i]);
        }
    }

    public static async disposeAll(ctx: WorkspaceContext): Promise<void> {
        for (const service of ctx.services.getAll()) {
            try {
                await service.teardown(ctx);
            } catch (error) {
                console.warn(`[Service] Failed to dispose ${service.constructor.name}`, error);
            }
        }
    }

    protected abstract init(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> | void;

    public setContext(ctx: WorkspaceContext): void {
        this.ctx = ctx;
    }

    public getContext(): WorkspaceContext {
        if (!this.ctx) {
            throw new Error("Trying to access context of a service before initialization");
        }
        return this.ctx;
    }

    public async initialize(ctx: WorkspaceContext, depend: (services: Service[]) => Promise<void>): Promise<void> {
        while (true) {
            if (this._initialized && this.ctx === ctx) {
                return;
            }

            const initializing = this._initializing;
            if (initializing) {
                await initializing;
                continue;
            }

            const task = this.initializeFresh(ctx, depend);
            this._initializing = task;
            try {
                await task;
            } finally {
                if (this._initializing === task) {
                    this._initializing = null;
                }
            }
            return;
        }
    }

    public activate(_ctx: WorkspaceContext): Promise<void> | void { }

    public dispose(_ctx: WorkspaceContext): Promise<void> | void { }

    public async teardown(ctx: WorkspaceContext): Promise<void> {
        if (this._initializing) {
            try {
                await this._initializing;
            } catch {
                // The failing initializer already reports the startup error.
            }
        }

        if (this.ctx !== ctx) {
            return;
        }

        try {
            await this.dispose(ctx);
        } finally {
            this._initialized = false;
            this.ctx = null;
        }
    }

    private async initializeFresh(
        ctx: WorkspaceContext,
        depend: (services: Service[]) => Promise<void>,
    ): Promise<void> {
        const previousCtx = this.ctx;
        if (this._initialized && previousCtx && previousCtx !== ctx) {
            try {
                await this.dispose(previousCtx);
            } finally {
                this._initialized = false;
                this.ctx = null;
            }
        }

        this.setContext(ctx);
        try {
            await this.init(ctx, depend);
            this._initialized = true;
        } catch (error) {
            try {
                await this.dispose(ctx);
            } catch (disposeError) {
                console.warn(`[Service] Failed to clean up ${this.constructor.name} after init error`, disposeError);
            }
            this._initialized = false;
            if (this.ctx === ctx) {
                this.ctx = null;
            }
            throw error;
        }
    }
}
