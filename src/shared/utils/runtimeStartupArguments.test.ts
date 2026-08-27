import { describe, expect, it } from "vitest";
import {
    hasDebuggingSwitch,
    hasStartupSwitch,
    honoursDebuggableMarker,
    reviewStartupArguments,
    RUNTIME_LOGS_SWITCH,
} from "./runtimeStartupArguments";

/**
 * The command line a shipped game will and will not take.
 *
 * Every case here is a launch someone can type. The ones that matter most are the shapes that look
 * like ordinary text but are switches to Chromium - a single dash on POSIX, a slash on Windows -
 * because a parser that reads fewer prefixes than Chromium does is a parser that waves them through.
 */

const review = (args: string[], platform: NodeJS.Platform = "win32") => reviewStartupArguments(args, platform);

describe("reviewStartupArguments", () => {
    it("takes a launch with nothing on it", () => {
        expect(review([]).refused).toEqual([]);
    });

    it("takes the switches a player has about their own hardware", () => {
        expect(review(["--disable-gpu", "--use-angle=d3d11", "--lang=ja"]).refused).toEqual([]);
    });

    it("refuses a debugger port, a weakened sandbox and a redirected resolver", () => {
        const refused = review([
            "--remote-debugging-port=9222",
            "--no-sandbox",
            "--host-resolver-rules=MAP * 127.0.0.1",
        ]).refused;
        expect(refused).toHaveLength(3);
    });

    it("refuses a switch it has never heard of, which is the point of an allowlist", () => {
        expect(review(["--some-switch-shipped-next-year"]).refused).toEqual(["--some-switch-shipped-next-year"]);
    });

    it("reads the prefixes Chromium reads on Windows", () => {
        // A parser that only knew `--` would wave both of these through.
        expect(review(["-remote-debugging-port=9222"]).refused).toEqual(["-remote-debugging-port=9222"]);
        expect(review(["/remote-debugging-port=9222"]).refused).toEqual(["/remote-debugging-port=9222"]);
    });

    it("matches Windows switch names without regard to case, as Chromium does", () => {
        expect(review(["--Disable-GPU"]).refused).toEqual([]);
        expect(review(["--Remote-Debugging-Port=9222"]).refused).toHaveLength(1);
    });

    it("does not read a slash as a switch on POSIX, where a path can start with one", () => {
        // `/tmp/thing` is a file name there, and refused as a positional rather than misread as a
        // switch called `tmp/thing`.
        const { refused, removable } = reviewStartupArguments(["/tmp/thing"], "linux");
        expect(refused).toEqual(["/tmp/thing"]);
        expect(removable).toEqual([]);
    });

    it("reads a single dash as a switch on POSIX, because Chromium does", () => {
        expect(reviewStartupArguments(["-no-sandbox"], "linux").refused).toEqual(["-no-sandbox"]);
    });

    it("takes the process serial number a Finder launch adds", () => {
        expect(reviewStartupArguments(["-psn_0_1234567"], "darwin").refused).toEqual([]);
        // Only on macOS, and only that shape.
        expect(reviewStartupArguments(["-psn_0_1234567"], "linux").refused).toEqual(["-psn_0_1234567"]);
    });

    it("refuses a file name, before and after the argument terminator", () => {
        expect(review(["C:/somewhere/thing.txt"]).refused).toEqual(["C:/somewhere/thing.txt"]);
        expect(review(["--", "--disable-gpu"]).refused).toEqual(["--disable-gpu"]);
    });

    it("offers every switch name for removal, allowed or not", () => {
        // Removal is what actually stops a switch being acted on, so it must not be limited to the
        // ones that caused the refusal.
        expect(review(["--disable-gpu", "--remote-debugging-port=9222"]).removable)
            .toEqual(["disable-gpu", "remote-debugging-port"]);
    });
});

describe("hasDebuggingSwitch", () => {
    it("sees the switches that ask for a debugger", () => {
        expect(hasDebuggingSwitch(["--remote-debugging-port=9222"], "win32")).toBe(true);
        expect(hasDebuggingSwitch(["--inspect-brk"], "linux")).toBe(true);
        expect(hasDebuggingSwitch(["/remote-debugging-pipe"], "win32")).toBe(true);
    });

    it("does not mistake an ordinary launch for one", () => {
        expect(hasDebuggingSwitch([], "win32")).toBe(false);
        expect(hasDebuggingSwitch(["--disable-gpu"], "win32")).toBe(false);
    });
});

describe("the switch that turns the main process's output back on", () => {
    it("is accepted, so asking support for it does not stop the game", () => {
        expect(review([`--${RUNTIME_LOGS_SWITCH}`]).refused).toEqual([]);
    });

    it("is not the spelling anyone would guess", () => {
        // Named apart from Chromium's own logging switches on purpose, and each of those stays
        // refused - one of them writes the network log to a file.
        for (const guess of ["--logs", "--log", "--enable-logging", "--log-file=x", "--log-net-log=x"]) {
            expect(review([guess]).refused).toEqual([guess]);
        }
    });

    it("is found however Chromium would have read it", () => {
        expect(hasStartupSwitch([`--${RUNTIME_LOGS_SWITCH}`], "linux", RUNTIME_LOGS_SWITCH)).toBe(true);
        expect(hasStartupSwitch([`/USE-LOGS`], "win32", RUNTIME_LOGS_SWITCH)).toBe(true);
        expect(hasStartupSwitch([`-${RUNTIME_LOGS_SWITCH}=1`], "darwin", RUNTIME_LOGS_SWITCH)).toBe(true);
        expect(hasStartupSwitch(["--disable-gpu"], "win32", RUNTIME_LOGS_SWITCH)).toBe(false);
    });
});

describe("what a player may still ask for", () => {
    it("takes the driver and display switches a support thread hands out", () => {
        expect(review([
            "--disable-gpu",
            "--disable-software-rasterizer",
            "--use-angle=d3d11",
            "--ozone-platform=wayland",
            "--force-color-profile=srgb",
        ]).refused).toEqual([]);
    });

    it("does not take the ones that weaken a process boundary, however often they are suggested", () => {
        for (const suggestion of ["--no-sandbox", "--disable-gpu-sandbox", "--disable-web-security", "--in-process-gpu"]) {
            expect(review([suggestion]).refused).toEqual([suggestion]);
        }
    });
});

/**
 * Which builds are allowed to say "let a debugger in".
 *
 * The marker exists so a build made from a checkout can be inspected. What makes it worth a test of
 * its own is the half that is *not* about the marker: the gate that decides in time to matter reads
 * a plain file next to the archive, so on a protected build the marker would otherwise be worth
 * exactly one text edit - and the thing behind that edit is the process holding the decrypted
 * content.
 *
 * Written as the whole 2x2 because exactly one corner of it refuses, and the value of the rule is
 * which one.
 */
describe("the debuggable marker", () => {
    const honours = (sealed: boolean, packaged: boolean) =>
        honoursDebuggableMarker({ marker: true, sealed, packaged });

    it("refuses the shipped form of a protected build, and only that", () => {
        expect(honours(true, true)).toBe(false);

        // An app directory someone started by hand is not a thing anybody received: whoever holds
        // it has the main script as plain JavaScript and could delete this check outright, so
        // refusing here would protect nothing and would cost the one workflow the marker is for.
        expect(honours(true, false)).toBe(true);
        // Unprotected builds are unchanged in both forms - this is the condition working as it did.
        expect(honours(false, true)).toBe(true);
        expect(honours(false, false)).toBe(true);
    });

    it("says no to every build that never asked", () => {
        for (const sealed of [false, true]) {
            for (const packaged of [false, true]) {
                expect(honoursDebuggableMarker({ marker: false, sealed, packaged })).toBe(false);
            }
        }
    });
});
