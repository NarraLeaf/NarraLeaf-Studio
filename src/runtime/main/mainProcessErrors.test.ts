import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import type { GameTestEvent } from "@shared/types/gameTest";

import { GAME_EXIT_CODES } from "./gameExitCodes";
import {
    describeRuntimeError,
    installMainProcessErrorReporting,
    type MainProcessErrorHost,
} from "./mainProcessErrors";
import { STARTUP_EXIT_CODES } from "./startupRefusal";

/**
 * Errors nobody caught in the game's main process.
 *
 * Measured on Electron 38, before this: an uncaught exception put up the game's box ("the game has to
 * close"), then Electron's own box with the stack, and the game went on running; an unhandled
 * rejection was a Node warning on a stderr nobody reads, and reached neither the log nor a test.
 */

interface HarnessOptions {
    /** What the stores' flush does. Resolves at once unless a test says otherwise. */
    flush?: () => Promise<unknown>;
    /** Stands in for the budget timer; by default it never fires, so the flush decides. */
    wait?: (ms: number) => Promise<void>;
    reportFatal?: (headline: string) => void;
}

/** A process that records the listeners it was given and, in order, what they did. */
function harness(options: HarnessOptions = {}) {
    const listeners = new Map<string, (...args: unknown[]) => void>();
    const order: string[] = [];
    const log = vi.fn((level: string, message: string) => {
        order.push(`log:${message.split("\n")[0]}`);
    });
    const events: GameTestEvent[] = [];
    const exits: number[] = [];
    let settleExit: () => void = () => undefined;
    const exited = new Promise<void>(resolve => {
        settleExit = resolve;
    });
    const host: MainProcessErrorHost = {
        on: (event: string, listener: (...args: never[]) => void) => {
            listeners.set(event, listener as (...args: unknown[]) => void);
        },
        log,
        emitTestEvent: event => {
            order.push("test");
            events.push(event);
        },
        flushForCrash: () => {
            order.push("flush");
            return (options.flush ?? (async () => undefined))();
        },
        crashFlushBudgetMs: 3000,
        reportFatal: headline => {
            order.push(`box:${headline}`);
            options.reportFatal?.(headline);
        },
        exit: code => {
            order.push(`exit:${code}`);
            exits.push(code);
            settleExit();
        },
        wait: options.wait ?? (() => new Promise<void>(() => undefined)),
    };
    installMainProcessErrorReporting(host);
    return {
        listeners,
        log,
        order,
        events,
        exits,
        exited,
        reject: (reason: unknown) => listeners.get("unhandledRejection")?.(reason, Promise.resolve()),
        throwUncaught: (error: unknown) => listeners.get("uncaughtException")?.(error),
    };
}

describe("installMainProcessErrorReporting", () => {
    it("takes both events over, so Electron's own stack box stands aside", () => {
        // Electron's listener does nothing once another `uncaughtException` listener is registered;
        // a monitor does not count, which is how the stack box used to reach players.
        expect([...harness().listeners.keys()].sort()).toEqual(["uncaughtException", "unhandledRejection"]);
    });

    describe("an uncaught exception", () => {
        it("is recorded, the stores are written, the player is told once, and the game closes", async () => {
            const probe = harness();
            probe.throwUncaught(new Error("boom"));
            await probe.exited;

            expect(probe.order).toEqual([
                "test",
                "log:[Crash] boom",
                "flush",
                `log:[Crash] Closing the game (exit ${GAME_EXIT_CODES.crashed}); what was waiting to be saved was written first.`,
                "box:boom",
                `exit:${GAME_EXIT_CODES.crashed}`,
            ]);
            expect(probe.events).toEqual([expect.objectContaining({ kind: "runtime-error", scope: "main", message: "boom" })]);
        });

        it("logs the stack with it", async () => {
            const probe = harness();
            const error = new Error("boom");
            probe.throwUncaught(error);
            await probe.exited;
            expect(probe.log.mock.calls[0][1]).toBe(`[Crash] boom\n${error.stack}`);
        });

        it("does not wait past the budget for a flush that does not finish", async () => {
            let budget = 0;
            const probe = harness({
                flush: () => new Promise(() => undefined),
                wait: async ms => {
                    budget = ms;
                },
            });
            probe.throwUncaught(new Error("boom"));
            await probe.exited;

            expect(budget).toBe(3000);
            expect(probe.order).toContain(`log:[Crash] Closing the game (exit ${GAME_EXIT_CODES.crashed}); gave up waiting 3000ms for what was waiting to be saved.`);
            expect(probe.exits).toEqual([GAME_EXIT_CODES.crashed]);
        });

        it("still closes when the flush fails, and says it did", async () => {
            const probe = harness({ flush: async () => { throw new Error("disk full"); } });
            probe.throwUncaught(new Error("boom"));
            await probe.exited;

            expect(probe.order).toContain(`log:[Crash] Closing the game (exit ${GAME_EXIT_CODES.crashed}); what was waiting to be saved could not be written.`);
            expect(probe.exits).toEqual([GAME_EXIT_CODES.crashed]);
        });

        it("still closes when the box cannot be drawn", async () => {
            const probe = harness({
                reportFatal: () => {
                    throw new Error("no window server");
                },
            });
            probe.throwUncaught(new Error("boom"));
            await probe.exited;
            expect(probe.exits).toEqual([GAME_EXIT_CODES.crashed]);
        });

        it("records a second one while the first is closing the game, and shows one box and exits once", async () => {
            let releaseFlush: () => void = () => undefined;
            const probe = harness({ flush: () => new Promise<void>(resolve => { releaseFlush = resolve; }) });
            probe.throwUncaught(new Error("first"));
            await Promise.resolve();
            probe.throwUncaught(new Error("second, from the flush"));
            releaseFlush();
            await probe.exited;
            await new Promise(resolve => setTimeout(resolve, 0));

            expect(probe.order.filter(step => step.startsWith("box:"))).toEqual(["box:first"]);
            expect(probe.exits).toEqual([GAME_EXIT_CODES.crashed]);
            expect(probe.order.filter(step => step === "flush")).toHaveLength(1);
            expect(probe.order).toContain("log:[Crash] second, from the flush");
        });
    });

    describe("an unhandled rejection", () => {
        it("is written to the game's log, stack and all", () => {
            const probe = harness();
            const error = new Error("the sidecar did not answer");
            probe.reject(error);

            expect(probe.log).toHaveBeenCalledTimes(1);
            expect(probe.log.mock.calls[0]).toEqual(["error", `[Error] Unhandled rejection: the sidecar did not answer\n${error.stack}`]);
        });

        it("is told to a test that is watching, the way an exception is", () => {
            const probe = harness();
            probe.reject(new Error("write refused"));
            expect(probe.events).toEqual([
                expect.objectContaining({ kind: "runtime-error", scope: "main", message: "Unhandled rejection: write refused" }),
            ]);
        });

        it("leaves the game running: no flush, no box, no exit", async () => {
            // One failed operation, most often; ending the game over it would cost the player the
            // playthrough in front of them to report a failure they may never have noticed.
            const probe = harness();
            probe.reject(new Error("the window was gone"));
            await new Promise(resolve => setTimeout(resolve, 0));
            expect(probe.order).toEqual(["test", "log:[Error] Unhandled rejection: the window was gone"]);
            expect(probe.exits).toEqual([]);
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
    });
});

describe("the game's exit codes", () => {
    it("give a crash a code of its own, apart from 0 and from every launch that did not start", () => {
        const codes = Object.values(GAME_EXIT_CODES);
        expect(new Set(codes).size).toBe(codes.length);
        expect(GAME_EXIT_CODES.crashed).not.toBe(0);
        expect(Object.values(STARTUP_EXIT_CODES)).not.toContain(GAME_EXIT_CODES.crashed);
    });

    it("are stated in one table: no module that ends the game writes a code of its own", () => {
        // `app.exit(` with a literal anywhere in the game's main process would be a second table.
        const dir = __dirname;
        const offenders = fs.readdirSync(dir)
            .filter(name => name.endsWith(".ts") && !name.endsWith(".test.ts"))
            .flatMap(name => fs.readFileSync(path.join(dir, name), "utf-8")
                .split(/\r?\n/)
                .filter(line => /\b(app\.exit|process\.exit|exit)\(\s*\d/.test(line))
                .map(line => `${name}: ${line.trim()}`));
        expect(offenders).toEqual([]);
    });
});

describe("describeRuntimeError", () => {
    it("keeps the message and the stack of an Error, and the text of anything else", () => {
        const error = new Error("nope");
        expect(describeRuntimeError(error)).toEqual({ message: "nope", stack: error.stack });
        expect(describeRuntimeError(42)).toEqual({ message: "42" });
    });
});
