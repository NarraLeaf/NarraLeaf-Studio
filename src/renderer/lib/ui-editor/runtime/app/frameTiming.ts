export function waitForAnimationFrame(): Promise<void> {
    return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

/**
 * Wait for `promise`, but give up after `timeoutMs` and resolve anyway, calling `onTimeout` once.
 *
 * For work that is an optimisation rather than a requirement: whatever the promise represents may
 * never report in (a broken asset, a superseded session), and the caller must still make progress.
 * Rejections settle the wait too — the failure is the promise owner's to report.
 */
export function withDeadline(
    promise: Promise<unknown>,
    timeoutMs: number,
    onTimeout?: () => void,
): Promise<void> {
    return new Promise<void>(resolve => {
        let settled = false;
        const finish = (timedOut: boolean) => {
            if (settled) {
                return;
            }
            settled = true;
            window.clearTimeout(timer);
            if (timedOut) {
                onTimeout?.();
            }
            resolve();
        };
        const timer = window.setTimeout(() => finish(true), timeoutMs);
        promise.then(() => finish(false), () => finish(false));
    });
}
