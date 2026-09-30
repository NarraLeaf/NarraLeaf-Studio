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

/**
 * A graph stopped because it ran its whole step budget without once waiting.
 *
 * Its own class so every place that reports a failure can say which loop it was, and a host that
 * words its own issues can say it in the author's language: the node it was stopped at and the event
 * head the run started from, by the names their definitions declare - the English a shipped game's
 * log can still print, and what the Dev Mode issue list translates.
 */
export class BlueprintStepLimitError extends BlueprintGraphExecutionError {
    public constructor(
        public readonly steps: number,
        nodeId: string,
        public readonly nodeName: string,
        public readonly headName: string,
    ) {
        super(`"${nodeName}" in "${headName}" was stopped after ${steps} steps without a wait`, nodeId);
        this.name = "BlueprintStepLimitError";
    }
}

/** What an `execution.error` event carries about a step-limit stop, when `err` is one. */
export function stepLimitOfExecutionError(
    err: unknown,
): { steps: number; nodeName: string; headName: string } | undefined {
    return err instanceof BlueprintStepLimitError
        ? { steps: err.steps, nodeName: err.nodeName, headName: err.headName }
        : undefined;
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
