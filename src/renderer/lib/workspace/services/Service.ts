import { Singleton } from "@shared/utils/singleton";
import { ensureWidgetModulesRegistered } from "@/lib/ui-editor/widget-modules/registryInstance";
import { IService, WorkspaceContext } from "./services";

/** One service that did not come up, and the error it came up with. See {@link Service.initializeTolerant}. */
export type ServiceInitFailure = { service: Service; error: unknown };

export abstract class Service<T extends Service<T> = Service<any>>
  extends Singleton<T>
  implements IService
{
  private ctx: WorkspaceContext | null = null;
  private _initialized = false;
  private _initializing: Promise<void> | null = null;

  public static async initializeAll(ctx: WorkspaceContext): Promise<void> {
    await ensureWidgetModulesRegistered();

    const pending = new Set<Service>();

    const init = async (service: Service): Promise<void> => {
      if (service._initialized && service.ctx === ctx) return;
      if (pending.has(service)) {
        const cycle = [...pending, service].map((s) => s.constructor.name).join(" -> ");
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

  /**
   * Bring up `services` and whatever they depend on, surviving the ones that fail.
   *
   * The difference from {@link initializeAll} is the whole of recovery mode. Normal startup is
   * all-or-nothing on purpose: a workspace with half its services up is a workspace that will
   * write half-formed documents over the author's project, so the first failure aborts and the
   * window shows an error screen. That is the right trade *when the project is fine* - and exactly
   * the wrong one when it is not, because the author is then left outside a project they cannot
   * inspect, being told one sentence about the first file that would not parse.
   *
   * This runs the same graph with two rules changed:
   *
   *  - a service that throws is recorded and skipped rather than aborting the pass;
   *  - `depend` does not propagate, so one dead dependency does not take down everything above it.
   *    A dependent may still fail on its own (it is now running against a service that never came
   *    up) and that failure is recorded too - underneath the root cause, which was recorded first
   *    because dependencies initialize first.
   *
   * Safe here only because recovery mode freezes project writes before this is called: nothing a
   * half-initialized service does can reach the author's files. Do not use it for an ordinary boot.
   */
  public static async initializeTolerant(
    ctx: WorkspaceContext,
    services: readonly Service[]
  ): Promise<ServiceInitFailure[]> {
    await ensureWidgetModulesRegistered();

    const failures: ServiceInitFailure[] = [];
    const attempted = new Set<Service>();
    const pending = new Set<Service>();

    const init = async (service: Service): Promise<void> => {
      if (service._initialized && service.ctx === ctx) return;
      // Ahead of the `attempted` check below, which would otherwise swallow a cycle: the
      // second visit to a service already on the stack is also the second visit full stop, so
      // testing "have we tried this" first would break the loop silently and leave a genuine
      // defect in the service graph with nothing to show for it.
      if (pending.has(service)) {
        const cycle = [...pending, service].map((s) => s.constructor.name).join(" -> ");
        failures.push({ service, error: new Error(`Circular dependency detected: ${cycle}`) });
        return;
      }
      // One attempt per pass. Without this a service that failed would be retried once per
      // dependent, and a common dependency's error would be listed five times over.
      if (attempted.has(service)) return;
      pending.add(service);
      attempted.add(service);
      const depend = async (deps: Service[]): Promise<void> => {
        for (const dep of deps) {
          await init(dep);
        }
      };
      try {
        await service.initialize(ctx, depend);
      } catch (error) {
        failures.push({ service, error });
      } finally {
        pending.delete(service);
      }
    };

    for (const service of services) {
      await init(service);
    }
    return failures;
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

  protected abstract init(
    ctx: WorkspaceContext,
    depend: (services: Service[]) => Promise<void>
  ): Promise<void> | void;

  public setContext(ctx: WorkspaceContext): void {
    this.ctx = ctx;
  }

  /**
   * Whether this service came up, for the workspace it is being asked about.
   *
   * Both halves matter: these are singletons that outlive a project switch, so a service still
   * flagged initialized against the *previous* context has not come up for this one. Only recovery
   * mode asks - ordinary code cannot reach a service that failed, because the failure took the
   * whole startup with it.
   */
  public isInitialized(ctx?: WorkspaceContext): boolean {
    return this._initialized && (ctx === undefined || this.ctx === ctx);
  }

  public getContext(): WorkspaceContext {
    if (!this.ctx) {
      throw new Error("Trying to access context of a service before initialization");
    }
    return this.ctx;
  }

  public async initialize(
    ctx: WorkspaceContext,
    depend: (services: Service[]) => Promise<void>
  ): Promise<void> {
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

  public activate(_ctx: WorkspaceContext): Promise<void> | void {}

  public dispose(_ctx: WorkspaceContext): Promise<void> | void {}

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
    depend: (services: Service[]) => Promise<void>
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
        console.warn(
          `[Service] Failed to clean up ${this.constructor.name} after init error`,
          disposeError
        );
      }
      this._initialized = false;
      if (this.ctx === ctx) {
        this.ctx = null;
      }
      throw error;
    }
  }
}
