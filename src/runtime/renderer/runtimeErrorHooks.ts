/**
 * The game renderer's uncaught-error hooks.
 *
 * Before this there were none anywhere in the runtime: an uncaught exception in a running game was
 * reported nowhere, and the only path back to Studio was `bridge.log()`, which the game only calls
 * deliberately. So "did anything blow up while it played" had no answer, whatever the game did.
 *
 * They were then installed only when a test was watching, which left the same hole in every
 * shipped game - the build where nobody is watching is exactly the build whose failures nobody can
 * reconstruct afterwards. They are now always installed and always reach the log; the test
 * reporter is an extra recipient when one is listening.
 *
 * Installed from the renderer's entry, ahead of React, so a throw during boot is observed too -
 * that is the window in which a broken pack most often dies.
 */

import { getGameRuntimeBridge } from "@/lib/ui-editor/runtime/gameRuntimeBridge";
import { readRuntimeTestSignalReporter } from "../gameTestSignal";

function describeUnknown(value: unknown): { message: string; stack?: string } {
    if (value instanceof Error) {
        return {
            message: value.message || String(value),
            ...(value.stack ? { stack: value.stack } : {}),
        };
    }
    return { message: String(value) };
}

export function installRuntimeErrorHooks(): void {
    const bridge = getGameRuntimeBridge();
    const report = readRuntimeTestSignalReporter(bridge);

    /**
     * Both recipients, in the order that matters.
     *
     * The log first, because it is the one that exists in a shipped game; the test reporter after,
     * because it is absent on the web export and on any pack with no control server. Neither is
     * allowed to throw its way out of an error handler.
     */
    const publish = (message: string, stack: string | undefined): void => {
        try {
            bridge?.log("error", stack ? `${message}\n${stack}` : message);
        } catch {
            /* A reporter that throws must not replace the error it was reporting. */
        }
        try {
            report?.({
                kind: "runtime-error",
                message,
                ...(stack ? { stack } : {}),
            });
        } catch {
            /* Same. */
        }
    };

    // addEventListener, not `window.onerror = `: the property form is a single slot, and assigning
    // it would silently unseat whatever the game - or one of its runtime plugins - had already put
    // there. An observer must not cost the page its own handler.
    window.addEventListener("error", event => {
        const described = describeUnknown(event.error);
        // `event.message` is the browser's own rendering of the throw and survives cases where
        // `event.error` is null (cross-origin script errors); the stack only ever comes from the
        // Error object.
        const message = event.message || described.message;
        // Location, when there is no stack to carry it: "Script error." on its own names nothing.
        const where = !described.stack && event.filename
            ? ` (${event.filename}:${event.lineno}:${event.colno})`
            : "";
        publish(`${message}${where}`, described.stack);
    });
    window.addEventListener("unhandledrejection", event => {
        const described = describeUnknown(event.reason);
        // Kept distinguishable from a synchronous throw: the two have very different causes and a
        // reader needs to know which one they are looking at.
        publish(`Unhandled rejection: ${described.message}`, described.stack);
    });
}
