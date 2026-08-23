import { describe, expect, it } from "vitest";
import { hasDebuggingSwitch, reviewStartupArguments } from "./runtimeStartupArguments";

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
