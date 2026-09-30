import { describe, expect, it, vi } from "vitest";

import type { GameTestEvent } from "@shared/types/gameTest";

import {
    describeRuntimeError,
    installMainProcessErrorReporting,
    type MainProcessErrorHost,
} from "./mainProcessErrors";

/**
 * An error nobody caught in the game's main process has to land somewhere a person can find it.
 *
 * Electron's main process runs Node in `warn` mode for rejections, so an unhandled one was printed as
 * a Node warning - on the stderr of a game nobody started from a terminal - and never reached the
 * `uncaughtExceptionMonitor` the game relied on. Nothing reached `game.log`, and a test watching the
 * game was told nothing.
 */

/** A process that records the listeners it was given and what they did. */
function harness() {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const log = vi.fn();
    const events: GameTestEvent[] = [];
    const reportFatal = vi.fn();
    const host: MainProcessErrorHost = {
        on: (event: string, listener: (...args: never[]) => void) => {
            listeners.set(event, listener as (...args: unknown[]) => void);
        },
        log,
        emitTestEvent: event => {
            events.push(event);
        },
        reportFatal,
    };
    installMainProcessErrorReporting(host);
    return {
        listeners,
        log,
        events,
        reportFatal,
        reject: (reason: unknown) => listeners.get("unhandledRejection")?.(reason, Promise.resolve()),
        throwUncaught: (error: unknown) => listeners.get("uncaughtExceptionMonitor")?.(error, "uncaughtException"),
    };
}

describe("installMainProcessErrorReporting", () => {
    it("listens for rejections itself, because the monitor is never told about them", () => {
        expect([...harness().listeners.keys()].sort()).toEqual(["uncaughtExceptionMonitor", "unhandledRejection"]);
    });

    it("writes an unhandled rejection to the game's log, stack and all", () => {
        const probe = harness();
        const error = new Error("the sidecar did not answer");
        probe.reject(error);

        expect(probe.log).toHaveBeenCalledTimes(1);
        const [level, line] = probe.log.mock.calls[0];
        expect(level).toBe("error");
        expect(line).toMatch(/^\[Error\] Unhandled rejection: the sidecar did not answer\n/);
        expect(line).toContain(error.stack?.split("\n")[1]?.trim() ?? "");
    });

    it("tells a test that is watching, the way an exception is told", () => {
        const probe = harness();
        probe.reject(new Error("write refused"));
        expect(probe.events).toEqual([
            expect.objectContaining({ kind: "runtime-error", scope: "main", message: "Unhandled rejection: write refused" }),
        ]);
    });

    it("leaves the game running: no fatal box for a rejection", () => {
        // One failed operation, most often; ending the game over it would cost the player the
        // playthrough in front of them to report a failure they may never have noticed.
        const probe = harness();
        probe.reject(new Error("the window was gone"));
        expect(probe.reportFatal).not.toHaveBeenCalled();
    });

    it("records a rejection with something other than an Error in it", () => {
        const probe = harness();
        probe.reject("a bare string");
        probe.reject(undefined);
        expect(probe.log.mock.calls.map(call => call[1])).toEqual([
            "[Error] Unhandled rejection: a bare string",
            "[Error] Unhandled rejection: undefined",
        ]);
    });

    it("still records an uncaught exception and puts the fatal box up for it", () => {
        const probe = harness();
        probe.throwUncaught(new Error("boom"));

        expect(probe.log.mock.calls[0][1]).toMatch(/^\[Crash\] boom\n/);
        expect(probe.events).toEqual([expect.objectContaining({ kind: "runtime-error", message: "boom" })]);
        expect(probe.reportFatal).toHaveBeenCalledWith("boom");
    });

    it("writes the record before the box, so a box that cannot be drawn does not cost the record", () => {
        const order: string[] = [];
        installMainProcessErrorReporting({
            on: (event: string, listener: (...args: never[]) => void) => {
                if (event === "uncaughtExceptionMonitor") {
                    (listener as (error: unknown, origin?: string) => void)(new Error("boom"), "uncaughtException");
                }
            },
            log: () => order.push("log"),
            emitTestEvent: () => order.push("test"),
            reportFatal: () => order.push("box"),
        });
        expect(order).toEqual(["test", "log", "box"]);
    });
});

describe("describeRuntimeError", () => {
    it("keeps the message and the stack of an Error, and the text of anything else", () => {
        const error = new Error("nope");
        expect(describeRuntimeError(error)).toEqual({ message: "nope", stack: error.stack });
        expect(describeRuntimeError(42)).toEqual({ message: "42" });
    });
});
