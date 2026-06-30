/**
 * Thrown by GraphExecutor so dispatchers can attach graph/node ids to execution.error.
 */
export class BlueprintGraphExecutionError extends Error {
    public constructor(
        message: string,
        public readonly nodeId: string,
    ) {
        super(message);
        this.name = "BlueprintGraphExecutionError";
    }
}

export class BlueprintGraphExecutionCancelledError extends Error {
    public constructor(
        message = "Blueprint execution cancelled",
        public readonly nodeId?: string,
    ) {
        super(message);
        this.name = "BlueprintGraphExecutionCancelledError";
    }
}

export function isBlueprintGraphExecutionCancelledError(err: unknown): err is BlueprintGraphExecutionCancelledError {
    return err instanceof BlueprintGraphExecutionCancelledError;
}

export function throwIfBlueprintExecutionCancelled(signal: AbortSignal | undefined, nodeId?: string): void {
    if (!signal?.aborted) {
        return;
    }
    const reason = signal.reason;
    if (reason instanceof BlueprintGraphExecutionCancelledError) {
        throw nodeId && !reason.nodeId
            ? new BlueprintGraphExecutionCancelledError(reason.message, nodeId)
            : reason;
    }
    const message = reason instanceof Error
        ? reason.message
        : typeof reason === "string" && reason.trim()
          ? reason
          : "Blueprint execution cancelled";
    throw new BlueprintGraphExecutionCancelledError(message, nodeId);
}

export function abortableSleep(durationMs: number, signal?: AbortSignal, nodeId?: string): Promise<void> {
    throwIfBlueprintExecutionCancelled(signal, nodeId);
    const waitMs = Math.max(0, durationMs);
    if (waitMs <= 0) {
        return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            signal?.removeEventListener("abort", onAbort);
        };
        const finish = () => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            resolve();
        };
        const onAbort = () => {
            if (settled) {
                return;
            }
            settled = true;
            clearTimeout(timer);
            cleanup();
            try {
                throwIfBlueprintExecutionCancelled(signal, nodeId);
            } catch (err) {
                reject(err);
            }
        };
        const timer = setTimeout(finish, waitMs);
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

export function abortablePromise<T>(promise: Promise<T>, signal?: AbortSignal, nodeId?: string): Promise<T> {
    throwIfBlueprintExecutionCancelled(signal, nodeId);
    if (!signal) {
        return promise;
    }
    return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
            signal.removeEventListener("abort", onAbort);
        };
        const settle = (fn: () => void) => {
            if (settled) {
                return;
            }
            settled = true;
            cleanup();
            fn();
        };
        const onAbort = () => {
            settle(() => {
                try {
                    throwIfBlueprintExecutionCancelled(signal, nodeId);
                } catch (err) {
                    reject(err);
                }
            });
        };
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(
            value => settle(() => resolve(value)),
            err => settle(() => reject(err)),
        );
    });
}
