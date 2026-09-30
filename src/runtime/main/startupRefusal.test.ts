import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import {
    refuseToStart,
    STARTUP_EXIT_CODES,
    startupRefusalLine,
    type StartupRefusalHost,
    type StartupRefusalKind,
} from "./startupRefusal";

/**
 * A launch that does not go ahead has to say so where the thing that started it can see: a code
 * that is not 0, and one line on standard error. It used to quit the ordinary way - exit 0, and in a
 * shipped game, whose console is silenced, nothing on either stream - so a launcher or a script that
 * started the game with a switch it does not accept was told the game had run.
 */

/** A process that records what happened to it, in order. */
function recordingHost(options: { stderrThrows?: boolean } = {}) {
    const events: string[] = [];
    const log = vi.fn((level: string, message: string) => {
        events.push(`log:${level}:${message}`);
    });
    const host: StartupRefusalHost = {
        log,
        writeStandardError: text => {
            if (options.stderrThrows) {
                throw new Error("EBADF: no standard error");
            }
            events.push(`stderr:${text}`);
        },
        exit: code => {
            events.push(`exit:${code}`);
        },
    };
    return { host, events, log };
}

const ALL_KINDS = Object.keys(STARTUP_EXIT_CODES) as StartupRefusalKind[];

describe("refuseToStart", () => {
    it("writes the reason to the log file without the console mirror, so standard error carries it once", () => {
        // Where the console is live - a preview, a test run, a game started with the logs switch - the
        // sink would print the line tagged, and the write to standard error would print it again.
        const { host, log } = recordingHost();
        refuseToStart(host, { kind: "commandLine", reason: "refusing to start: this build does not accept --x" });
        expect(log).toHaveBeenCalledWith("error", "refusing to start: this build does not accept --x", { console: false });
    });

    it("logs the reason, says it on standard error as one line, and exits with the kind's code", () => {
        const { host, events } = recordingHost();
        refuseToStart(host, {
            kind: "commandLine",
            reason: "refusing to start: this build does not accept --remote-debugging-port=9222",
        });
        expect(events).toEqual([
            "log:error:refusing to start: this build does not accept --remote-debugging-port=9222",
            "stderr:refusing to start: this build does not accept --remote-debugging-port=9222\n",
            `exit:${STARTUP_EXIT_CODES.commandLine}`,
        ]);
    });

    it("never exits 0, whatever the reason", () => {
        for (const kind of ALL_KINDS) {
            const { host, events } = recordingHost();
            refuseToStart(host, { kind, reason: "no" });
            const exit = events.find(event => event.startsWith("exit:"));
            expect(exit).not.toBe("exit:0");
            expect(Number(exit?.slice("exit:".length))).toBeGreaterThan(0);
        }
    });

    it("gives each kind of refusal a code of its own, so a script can tell them apart", () => {
        const codes = ALL_KINDS.map(kind => STARTUP_EXIT_CODES[kind]);
        expect(new Set(codes).size).toBe(codes.length);
        expect(STARTUP_EXIT_CODES.commandLine).toBe(2);
    });

    it("keeps the detail in the log and off standard error", () => {
        const { host, events } = recordingHost();
        refuseToStart(host, {
            kind: "failed",
            reason: "could not start: the game's content could not be read: pack.json is missing",
            detail: "Error: pack.json is missing\n    at readPack (main.js:1:1)",
        });
        const stderr = events.filter(event => event.startsWith("stderr:"));
        expect(stderr).toEqual(["stderr:could not start: the game's content could not be read: pack.json is missing\n"]);
        expect(events[0]).toContain("at readPack");
    });

    it("writes exactly one line to standard error, however the reason was put together", () => {
        const { host, events } = recordingHost();
        refuseToStart(host, { kind: "failed", reason: "could not start:\r\n  ENOENT: no such file\n" });
        const [stderr] = events.filter(event => event.startsWith("stderr:"));
        const text = stderr.slice("stderr:".length);
        expect(text.endsWith("\n")).toBe(true);
        expect(text.slice(0, -1)).not.toMatch(/[\r\n]/);
        expect(text).toBe("could not start: ENOENT: no such file\n");
    });

    it("does not carry the tag the log sink puts on console output", () => {
        // `[GameRuntime]` names the engine, which a shipped game does not print unless asked.
        const { host, events } = recordingHost();
        refuseToStart(host, { kind: "contentTooNew", reason: "refusing to start: game content schema v9 is newer" });
        for (const event of events.filter(line => line.startsWith("stderr:"))) {
            expect(event).not.toContain("GameRuntime");
        }
    });

    it("tells the player after the line is out and before the process goes", () => {
        // A native box waits for a click; a script reading standard error should not have to.
        const { host, events } = recordingHost();
        refuseToStart(host, {
            kind: "contentTooNew",
            reason: "refusing to start: newer content",
            tellPlayer: () => {
                events.push("box");
            },
        });
        expect(events.map(event => event.split(":")[0])).toEqual(["log", "stderr", "box", "exit"]);
    });

    it("still exits with its code when there is no standard error to write to", () => {
        // A game opened from a shortcut on Windows has none attached.
        const { host, events } = recordingHost({ stderrThrows: true });
        refuseToStart(host, { kind: "commandLine", reason: "refusing to start: this build does not accept -x" });
        expect(events.at(-1)).toBe(`exit:${STARTUP_EXIT_CODES.commandLine}`);
    });

    it("still exits with its code when the player could not be told", () => {
        const { host, events } = recordingHost();
        refuseToStart(host, {
            kind: "contentTooNew",
            reason: "refusing to start: newer content",
            tellPlayer: () => {
                throw new Error("no window server");
            },
        });
        expect(events.at(-1)).toBe(`exit:${STARTUP_EXIT_CODES.contentTooNew}`);
    });
});

describe("startupRefusalLine", () => {
    it("leaves a line that is already one alone", () => {
        expect(startupRefusalLine("refusing to start: this build does not accept --inspect")).toBe(
            "refusing to start: this build does not accept --inspect",
        );
    });
});

/**
 * The game's main process, read as text: every place it stops a launch goes through
 * {@link refuseToStart}, so none of them can go back to the quit that exits 0 without a test noticing.
 */
describe("the game's main process", () => {
    const source = fs.readFileSync(path.join(__dirname, "main.ts"), "utf-8").replace(/\r\n/g, "\n");
    const codeLines = source.split("\n").filter(line => !/^\s*(\/\/|\/?\*)/.test(line));

    it("states every refusal through refuseToStart", () => {
        const offenders = codeLines
            .map((line, index) => ({ line, index }))
            .filter(({ line }) => /refusing to start|could not start/.test(line))
            .filter(({ index }) => !codeLines.slice(Math.max(0, index - 4), index).some(line => line.includes("refuseToStart(")))
            .map(({ line }) => line.trim());
        expect(offenders).toEqual([]);
    });

    it("words a refused command line in one place, which only refusals use", () => {
        // The masked prefix: an import, the function that builds the line, and nothing else.
        const users = codeLines.filter(line => line.includes("REFUSAL_LOG_PREFIX")).map(line => line.trim());
        expect(users).toEqual(["REFUSAL_LOG_PREFIX,", "return `${REFUSAL_LOG_PREFIX}${refused.join(\", \")}`;"]);
        const builders = codeLines.filter(line => line.includes("commandLineRefusalReason(") && !line.includes("function"));
        expect(builders.every(line => line.includes("refuseToStart("))).toBe(true);
        expect(builders.length).toBe(2);
    });

    it("has a refusal for each gate: the command line twice, content too new, content unreadable", () => {
        const calls = codeLines.filter(line => line.includes("refuseToStart(startupRefusalHost"));
        expect(calls.length).toBeGreaterThanOrEqual(4);
        for (const kind of ["commandLine", "contentTooNew", "failed"]) {
            expect(source).toContain(`kind: "${kind}"`);
        }
    });

    it("never logs the command-line refusal on its own", () => {
        // What the first gate used to do: a line in the log, then `app.quit()`, which exits 0.
        expect(source).not.toMatch(/logRuntime\(\s*"error",\s*`\$\{REFUSAL_LOG_PREFIX/);
    });
});
