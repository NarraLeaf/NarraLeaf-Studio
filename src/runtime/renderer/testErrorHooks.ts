/**
 * The game renderer's uncaught-error hooks.
 *
 * Before this there were none anywhere in the runtime: an uncaught exception in a running game was
 * reported nowhere, and the only path back to Studio was `bridge.log()`, which the game only calls
 * deliberately. So "did anything blow up while it played" had no answer, whatever the game did.
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

export function installRuntimeTestErrorHooks(): void {
    const report = readRuntimeTestSignalReporter(getGameRuntimeBridge());
    if (!report) {
        // No reporter means no shell to report to (the web export) or no test watching. Registering
        // the listeners anyway would only add two no-ops to every error path in every shipped game.
        return;
    }
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
        report({
            kind: "runtime-error",
            message: `${message}${where}`,
            ...(described.stack ? { stack: described.stack } : {}),
        });
    });
    window.addEventListener("unhandledrejection", event => {
        const described = describeUnknown(event.reason);
        report({
            kind: "runtime-error",
            // Kept distinguishable from a synchronous throw: the two have very different causes and
            // a test author reading the report needs to know which one they are looking at.
            message: `Unhandled rejection: ${described.message}`,
            ...(described.stack ? { stack: described.stack } : {}),
        });
    });
}
