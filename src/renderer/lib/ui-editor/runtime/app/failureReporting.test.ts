import fs from "fs/promises";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
    errorMessage,
    errorStack,
    normalizeError,
    reportRuntimeFailure,
    watchUncaughtFailures,
    type FailureChannels,
} from "./failureReporting";

const APP_FILE = path.join(path.resolve(__dirname), "GameApp.tsx");

/** A host's two channels, recorded. */
function channels(options?: { silent?: boolean }): FailureChannels & {
    logged: Array<[string, string]>;
    issues: Array<Record<string, unknown>>;
} {
    const logged: Array<[string, string]> = [];
    const issues: Array<Record<string, unknown>> = [];
    return {
        logged,
        issues,
        log: (level, message) => {
            logged.push([level, message]);
        },
        // A host that cannot show issues at all: the packaged runtime is one.
        ...(options?.silent ? {} : { reportIssue: issue => void issues.push({ ...issue }) }),
    };
}

/** An event target with no DOM behind it, so the listeners can be driven by hand. */
function fakeTarget() {
    const listeners = new Map<string, Array<(event: Event) => void>>();
    return {
        addEventListener(type: string, listener: (event: Event) => void): void {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        removeEventListener(type: string, listener: (event: Event) => void): void {
            listeners.set(type, (listeners.get(type) ?? []).filter(entry => entry !== listener));
        },
        count(type: string): number {
            return (listeners.get(type) ?? []).length;
        },
        emit(type: string, event: object): void {
            for (const listener of listeners.get(type) ?? []) {
                listener(event as Event);
            }
        },
    };
}

describe("reportRuntimeFailure", () => {
    it("attributes a failure thrown while a row was playing to that row", () => {
        const host = channels();
        reportRuntimeFailure(host, new Error("Cannot call scene corridor: it is already on stage."), {
            blockId: "block-corridor-jump",
        });

        expect(host.issues).toHaveLength(1);
        expect(host.issues[0]).toMatchObject({
            level: "error",
            origin: "playHead",
            blockId: "block-corridor-jump",
            message: "Cannot call scene corridor: it is already on stage.",
        });
    });

    it("says session rather than inventing a row when nothing was playing", () => {
        const host = channels();
        reportRuntimeFailure(host, new Error("boot failed"));

        expect(host.issues).toHaveLength(1);
        expect(host.issues[0]).toMatchObject({ level: "error", origin: "session" });
        expect(host.issues[0]).not.toHaveProperty("blockId");
    });

    it("reaches the log channel as well as the panel, stack and all", () => {
        const host = channels();
        const error = new Error("it is already on stage");
        error.stack = "Error: it is already on stage\n    at _Scene2.jumpTo";
        reportRuntimeFailure(host, error, { blockId: "b-1" });

        expect(host.logged).toEqual([["error", error.stack]]);
        expect(host.issues[0]).toMatchObject({ stack: error.stack });
    });

    it("still logs for a host that cannot show issues, so a packaged build keeps its console line", () => {
        const host = channels({ silent: true });
        expect(() => reportRuntimeFailure(host, new Error("nowhere to report"))).not.toThrow();
        expect(host.logged).toHaveLength(1);
    });

    it("carries a caller's prefix into both channels", () => {
        const host = channels();
        reportRuntimeFailure(host, new Error("nope"), { prefix: "[Dev] restart failed: " });

        expect(host.logged[0]?.[1]).toContain("[Dev] restart failed: ");
        expect(host.issues[0]?.message).toBe("[Dev] restart failed: nope");
    });
});

describe("error shaping", () => {
    it("prefers the stack for the console line and the sentence for the author", () => {
        const error = new Error("plain words");
        error.stack = "Error: plain words\n    at somewhere";
        expect(normalizeError(error)).toBe(error.stack);
        expect(errorMessage(error)).toBe("plain words");
        expect(errorStack(error)).toBe(error.stack);
    });

    it("handles a thrown value that is not an Error at all", () => {
        expect(errorMessage("just a string")).toBe("just a string");
        expect(errorStack("just a string")).toBeUndefined();
    });
});

describe("watchUncaughtFailures", () => {
    it("reports a throw that reached the top of the stack", () => {
        const target = fakeTarget();
        const report = vi.fn();
        watchUncaughtFailures(target, report);

        const error = new Error("Cannot call scene corridor: it is already on stage.");
        target.emit("error", { error, message: `Uncaught Error: ${error.message}` });

        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]?.[0]).toBe(error);
    });

    it("reports a promise nobody attached a catch to", () => {
        const target = fakeTarget();
        const report = vi.fn();
        watchUncaughtFailures(target, report);

        const reason = new Error("the first advance never got going");
        target.emit("unhandledrejection", { reason });

        expect(report).toHaveBeenCalledTimes(1);
        expect(report.mock.calls[0]?.[0]).toBe(reason);
    });

    it("does not swallow: the browser still gets to print it", () => {
        const target = fakeTarget();
        watchUncaughtFailures(target, vi.fn());

        const preventDefault = vi.fn();
        target.emit("error", { error: new Error("boom"), preventDefault });
        target.emit("unhandledrejection", { reason: new Error("boom"), preventDefault });

        expect(preventDefault).not.toHaveBeenCalled();
    });

    it("still names a script error that arrives with no Error object", () => {
        const target = fakeTarget();
        const report = vi.fn();
        watchUncaughtFailures(target, report);

        target.emit("error", {
            error: null,
            message: "Script error.",
            filename: "app://game/main.js",
            lineno: 42,
            colno: 7,
        });

        const reported = report.mock.calls[0]?.[0];
        expect(errorMessage(reported)).toContain("Script error.");
        expect(errorMessage(reported)).toContain("app://game/main.js:42:7");
    });

    it("survives a reporter that throws, rather than looping on its own failure", () => {
        // A throw out of an `error` listener is itself an uncaught error, which the same listener
        // would then be handed.
        const target = fakeTarget();
        const report = vi.fn(() => {
            throw new Error("the panel is gone");
        });
        watchUncaughtFailures(target, report);

        expect(() => target.emit("error", { error: new Error("boom") })).not.toThrow();
        expect(() => target.emit("unhandledrejection", { reason: new Error("boom") })).not.toThrow();
        expect(report).toHaveBeenCalledTimes(2);
    });

    it("lets go of both listeners when it is taken down", () => {
        const target = fakeTarget();
        const stop = watchUncaughtFailures(target, vi.fn());
        expect(target.count("error")).toBe(1);
        expect(target.count("unhandledrejection")).toBe(1);

        stop();
        expect(target.count("error")).toBe(0);
        expect(target.count("unhandledrejection")).toBe(0);
    });
});

/**
 * The watch is worth nothing unless `GameApp` actually installs it, and installing it is one line
 * that no type or render test can insist on — `GameApp` is not rendered anywhere in this suite. So
 * this reads the file, the way `hostCapabilityForwarding` reads it for the same reason.
 */
describe("GameApp wiring", () => {
    it("watches the window for failures that escape the engine, and reports them through reportFailure", async () => {
        const source = await fs.readFile(APP_FILE, "utf8");
        expect(source).toContain("watchUncaughtFailures");
        // The reporting path stays the single one: the watch feeds `reportFailure`, it does not
        // build an issue of its own.
        const watchCall = source.slice(source.indexOf("watchUncaughtFailures(window"));
        expect(watchCall.slice(0, 200)).toContain("reportFailure");
    });

    it("installs it only for a host that can show issues, so a packaged game is untouched", async () => {
        const source = await fs.readFile(APP_FILE, "utf8");
        const install = source.indexOf("watchUncaughtFailures(window");
        expect(install).toBeGreaterThan(-1);
        // The guard sits immediately above the call, inside the same effect.
        expect(source.slice(Math.max(0, install - 400), install)).toContain("host.reportIssue");
    });
});
