import { IPCEvents, IPCEventType, RequestStatus } from "@shared/types/ipcEvents";
import type { ApiCapability } from "@shared/types/pluginPermissions";
import { WindowProxy } from "../windowProxy";

export type EventResponse<T extends IPCEventType> = Exclude<IPCEvents[T]["response"], never>;
export type IPCHandlerProps<T extends IPCEventType> = IPCEvents[T]["data"];

export abstract class IPCHandler<T extends IPCEventType> {
    abstract readonly name: T;
    abstract readonly type: IPCEvents[T]["type"];
    readonly requiredApiCapabilities?: readonly ApiCapability[];
    public abstract handle(window: WindowProxy, data: IPCEvents[T]["data"]): Promise<RequestStatus<EventResponse<T>>> | RequestStatus<EventResponse<T>>;

    /**
     * A rejection, as the renderer will see it.
     *
     * **The `code` crosses with it**, and it has to: `RequestStatus.code` is what a renderer uses to
     * tell a situation it has words for from a backend refusal that names its own remedy, and every
     * handler that reaches this rather than `ipcHost.failed` is a handler whose codes were being
     * dropped on the way out. That was every `vcs.*` call - so `VcsErrorCode.NothingToCommit` and
     * its neighbours arrived as English prose in front of an author whose interface is not English,
     * which is the failure the codes were introduced to remove.
     *
     * Read as a property rather than narrowed to a class, exactly as `ipcHost.failed` reads it, so a
     * `code` set by Node (`ENOENT`) arrives as itself instead of being invented here. Anything that
     * is not a string is dropped: the field exists to be compared against a literal.
     */
    protected failed(err: unknown): RequestStatus<never> {
        const code = err instanceof Error ? (err as Error & { code?: unknown }).code : undefined;
        return {
            success: false,
            error: err instanceof Error ? err.message : String(err),
            ...(typeof code === "string" ? { code } : {}),
        };
    }

    protected success<T>(data: T): RequestStatus<T>;
    protected success(): RequestStatus<void>;
    protected success<T = undefined>(data?: T extends undefined ? never : T): RequestStatus<T extends undefined ? void : T> {
        if (data !== undefined) {
            return {
                success: true,
                data,
            };
        }
        return {
            success: true,
            data: undefined as never,
        };
    }

    protected async tryUse<T>(exec: () => T | Promise<T>): Promise<RequestStatus<T>> {
        try {
            const data = await exec();
            return this.success(data);
        } catch (err) {
            return this.failed(err);
        }
    }
}
