import { Singleton } from "@shared/utils/singleton";
import { IService, WorkspaceContext } from "./services";

export abstract class Service<T extends Service<T> = Service<any>> extends Singleton<T> implements IService {
    private ctx: WorkspaceContext | null = null;
    private _initialized = false;

    public static async initializeAll(ctx: WorkspaceContext): Promise<void> {
        const pending = new Set<Service>();

        const init = async (service: Service): Promise<void> => {
            if (service._initialized) return;
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
            await service.initialize(ctx, depend);
            pending.delete(service);
        };

        const all = ctx.services.getAll();
        for (let i = all.length - 1; i >= 0; i--) {
            await init(all[i]);
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
        this.setContext(ctx);
        await this.init(ctx, depend);
        this._initialized = true;
    }

    public activate(_ctx: WorkspaceContext): Promise<void> | void { }

    public dispose(_ctx: WorkspaceContext): Promise<void> | void { }
}
