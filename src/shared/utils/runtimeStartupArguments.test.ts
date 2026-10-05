import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import {
    ALLOWED_STARTUP_SWITCHES,
    buildGuardMaskTable,
    DEBUGGING_SWITCHES,
    hasDebuggingSwitch,
    hasStartupSwitch,
    honoursDebuggableMarker,
    parseGuardMaskTable,
    REFUSAL_LOG_PREFIX,
    reviewStartupArguments,
    RUNTIME_LOGS_SWITCH,
    SANDBOX_ENVIRONMENT_VARIABLE,
    SANDBOX_FALLBACK_NOTICE,
    SANDBOX_PROBE,
    SANDBOX_SWITCH,
    environmentDisablesSandbox,
    startupSwitchNames,
    type SandboxLaunchFacts,
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

/**
 * The guard's tables ship as one masked blob, never as the switch names themselves, so a shipped
 * game's main.js does not carry a plaintext map of this guard (a search for `remote-debugging-port`
 * finds nothing) - and the blob is re-keyed per game so the tokens are not a corpus-wide grep
 * signature. This pins the decoded values, the masking property, and the re-key round-trip.
 *
 * The plaintext reference lives in this test, which never ships, and not beside the tables.
 */
describe("the masked guard table", () => {
    const EXPECTED_ALLOWED = [
        "disable-gpu",
        "disable-gpu-compositing",
        "disable-software-rasterizer",
        "use-angle",
        "use-gl",
        "ozone-platform",
        "ozone-platform-hint",
        "force-device-scale-factor",
        "force-color-profile",
        "lang",
        "use-logs",
    ];
    const EXPECTED_DEBUGGING = [
        "remote-debugging-port",
        "remote-debugging-pipe",
        "inspect",
        "inspect-brk",
        "inspect-port",
        "inspect-publish-uid",
    ];
    const EXPECTED_REFUSAL = "refusing to start: this build does not accept ";
    const EXPECTED_SANDBOX = {
        switchName: "no-sandbox",
        environmentVariable: "ELECTRON_DISABLE_SANDBOX",
        helper: "chrome-sandbox",
        programs: ["/usr/bin/unshare", "/bin/unshare"],
        programArguments: ["-Ur", "true"],
        restrictions: [
            "/proc/sys/kernel/unprivileged_userns_clone=0",
            "/proc/sys/user/max_user_namespaces=0",
            "/proc/sys/kernel/apparmor_restrict_unprivileged_userns=1",
        ],
        notice: "accepting a launch without the sandbox this machine cannot provide: ",
    };
    const decoded = {
        seed: 91,
        step: 31,
        allowed: EXPECTED_ALLOWED,
        debugging: EXPECTED_DEBUGGING,
        logs: "use-logs",
        refusalPrefix: EXPECTED_REFUSAL,
        fallback: EXPECTED_SANDBOX,
    };
    /** Every name and line the table holds, none of which may appear as a literal. */
    const PLAINTEXT = [
        ...EXPECTED_ALLOWED,
        ...EXPECTED_DEBUGGING,
        EXPECTED_REFUSAL,
        "no-sandbox",
        "ELECTRON_DISABLE_SANDBOX",
        "chrome-sandbox",
        "/usr/bin/unshare",
        "/bin/unshare",
        "/proc/sys",
        "userns",
        EXPECTED_SANDBOX.notice,
    ];

    it("decodes to exactly the names and text the guard is written against", () => {
        expect(ALLOWED_STARTUP_SWITCHES).toEqual(EXPECTED_ALLOWED);
        expect(DEBUGGING_SWITCHES).toEqual(EXPECTED_DEBUGGING);
        expect(RUNTIME_LOGS_SWITCH).toBe("use-logs");
        expect(REFUSAL_LOG_PREFIX).toBe(EXPECTED_REFUSAL);
        expect(SANDBOX_SWITCH).toBe(EXPECTED_SANDBOX.switchName);
        expect(SANDBOX_ENVIRONMENT_VARIABLE).toBe(EXPECTED_SANDBOX.environmentVariable);
        expect(SANDBOX_FALLBACK_NOTICE).toBe(EXPECTED_SANDBOX.notice);
        expect(SANDBOX_PROBE).toEqual({
            helper: "chrome-sandbox",
            programs: ["/usr/bin/unshare", "/bin/unshare"],
            programArguments: ["-Ur", "true"],
            restrictions: [
                { file: "/proc/sys/kernel/unprivileged_userns_clone", value: "0" },
                { file: "/proc/sys/user/max_user_namespaces", value: "0" },
                { file: "/proc/sys/kernel/apparmor_restrict_unprivileged_userns", value: "1" },
            ],
        });
    });

    it("carries none of it in the module's code", () => {
        // The module's source without its comments is what ends up in a shipped main.js.
        const source = fs.readFileSync(path.join(__dirname, "runtimeStartupArguments.ts"), "utf-8");
        const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
        for (const name of PLAINTEXT) {
            expect(code).not.toContain(name);
        }
    });

    it("masks every name and the refusal line, and round-trips under its key", () => {
        const blob = buildGuardMaskTable(decoded);
        for (const name of PLAINTEXT) {
            expect(blob).not.toContain(name);
        }
        expect(parseGuardMaskTable(blob)).toEqual(decoded);
    });

    it("re-keys to different bytes that still read back the same names", () => {
        // What the per-game re-key does: same names, different shipped bytes, still non-greppable.
        const one = buildGuardMaskTable({ ...decoded, seed: 91, step: 31 });
        const two = buildGuardMaskTable({ ...decoded, seed: 17, step: 5 });
        expect(one).not.toBe(two);
        expect(parseGuardMaskTable(two).allowed).toEqual(EXPECTED_ALLOWED);
        expect(parseGuardMaskTable(two).refusalPrefix).toBe(EXPECTED_REFUSAL);
        expect(parseGuardMaskTable(two).fallback).toEqual(EXPECTED_SANDBOX);
        for (const name of PLAINTEXT) {
            expect(two).not.toContain(name);
        }
    });
});

/**
 * The one situation the sandbox switch is accepted in: Linux, on a machine the game finds cannot
 * provide a sandbox. Everything else refuses it, the environment variable that turns into it included.
 *
 * The machine is examined through a function the review calls, and the tests count the calls: an
 * ordinary launch, and every launch on another platform, must never examine it at all.
 */
describe("running without the sandbox", () => {
    function facts(overrides: Partial<Omit<SandboxLaunchFacts, "machineCapable">> & { canSandbox?: boolean } = {}) {
        let asked = 0;
        const { canSandbox = true, ...rest } = overrides;
        const launch: SandboxLaunchFacts = {
            inEffect: false,
            environment: false,
            machineCapable: () => {
                asked += 1;
                return canSandbox;
            },
            ...rest,
        };
        return { launch, asked: () => asked };
    }
    const reviewWith = (args: string[], platform: NodeJS.Platform, launch: SandboxLaunchFacts) =>
        reviewStartupArguments(args, platform, ALLOWED_STARTUP_SWITCHES, launch);

    it("accepts the switch on a Linux machine that cannot sandbox", () => {
        const machine = facts({ inEffect: true, canSandbox: false });
        const result = reviewWith(["--no-sandbox"], "linux", machine.launch);
        expect(result.refused).toEqual([]);
        expect(result.fallback).toBe("accepted");
        expect(machine.asked()).toBe(1);
    });

    it("refuses it on a Linux machine that can", () => {
        const machine = facts({ inEffect: true, canSandbox: true });
        const result = reviewWith(["--no-sandbox"], "linux", machine.launch);
        expect(result.refused).toEqual(["--no-sandbox"]);
        expect(result.fallback).toBe("refused");
    });

    it("refuses it on Windows and macOS without examining anything", () => {
        for (const platform of ["win32", "darwin"] as const) {
            const machine = facts({ inEffect: true, canSandbox: false });
            expect(reviewWith(["--no-sandbox"], platform, machine.launch).refused).toEqual(["--no-sandbox"]);
            expect(machine.asked()).toBe(0);
        }
    });

    it("examines nothing for an ordinary launch", () => {
        const machine = facts({ canSandbox: false });
        const result = reviewWith(["--disable-gpu"], "linux", machine.launch);
        expect(result).toEqual({ refused: [], removable: ["disable-gpu"], fallback: "not-asked" });
        expect(machine.asked()).toBe(0);
    });

    it("reads every spelling Chromium reads", () => {
        // A single dash is a switch on POSIX, and a value does not stop Chromium seeing the switch.
        for (const spelling of ["-no-sandbox", "--no-sandbox=1"]) {
            expect(reviewWith([spelling], "linux", facts({ canSandbox: false }).launch).refused).toEqual([]);
            expect(reviewWith([spelling], "linux", facts({ canSandbox: true }).launch).refused).toEqual([spelling]);
        }
        expect(reviewWith(["/No-Sandbox"], "win32", facts({ canSandbox: false }).launch).refused).toEqual(["/No-Sandbox"]);
    });

    it("still refuses everything else on the same command line", () => {
        const result = reviewWith(["--no-sandbox", "--remote-debugging-port=9222"], "linux", facts({ canSandbox: false }).launch);
        expect(result.refused).toEqual(["--remote-debugging-port=9222"]);
        expect(result.fallback).toBe("accepted");
    });

    it("treats the environment variable as the switch, and names it when refusing", () => {
        // Electron has already put the switch on Chromium's command line; argv does not show it.
        const variable = { inEffect: true, environment: true };
        expect(reviewWith([], "linux", facts({ ...variable, canSandbox: false }).launch).refused).toEqual([]);
        expect(reviewWith([], "linux", facts({ ...variable, canSandbox: true }).launch).refused)
            .toEqual(["ELECTRON_DISABLE_SANDBOX"]);
        const windows = facts({ ...variable, canSandbox: false });
        const refused = reviewWith([], "win32", windows.launch);
        expect(refused.refused).toEqual(["ELECTRON_DISABLE_SANDBOX"]);
        // Taken off Chromium's command line with everything else when the launch is refused.
        expect(refused.removable).toEqual(["no-sandbox"]);
        expect(windows.asked()).toBe(0);
    });

    it("names both routes when both were used", () => {
        expect(reviewWith(["--no-sandbox"], "darwin", facts({ inEffect: true, environment: true }).launch).refused)
            .toEqual(["--no-sandbox", "ELECTRON_DISABLE_SANDBOX"]);
    });

    it("leaves alone a variable Electron did not act on", () => {
        // Chromium's command line is the authority on whether the sandbox will be off.
        const machine = facts({ inEffect: false, environment: true });
        expect(reviewWith([], "win32", machine.launch)).toEqual({ refused: [], removable: [], fallback: "not-asked" });
    });

    it("names the switch when nothing visible explains it", () => {
        expect(reviewWith([], "win32", facts({ inEffect: true }).launch).refused).toEqual(["--no-sandbox"]);
    });

    it("does not read the switch after the argument terminator, where Chromium does not either", () => {
        const machine = facts({ canSandbox: false });
        const result = reviewWith(["--", "--no-sandbox"], "linux", machine.launch);
        expect(result.refused).toEqual(["--no-sandbox"]);
        expect(result.fallback).toBe("not-asked");
        expect(machine.asked()).toBe(0);
    });

    it("refuses it when no facts are given, which is how every other caller reviews", () => {
        expect(reviewStartupArguments(["--no-sandbox"], "linux").refused).toEqual(["--no-sandbox"]);
        expect(startupSwitchNames(["--no-sandbox", "--use-logs"], "linux")).toEqual(["no-sandbox", "use-logs"]);
    });
});

describe("environmentDisablesSandbox", () => {
    it("reads presence, as Electron does, rather than the value", () => {
        for (const value of ["1", "0", "false"]) {
            expect(environmentDisablesSandbox({ ELECTRON_DISABLE_SANDBOX: value }, "linux")).toBe(true);
            expect(environmentDisablesSandbox({ ELECTRON_DISABLE_SANDBOX: value }, "win32")).toBe(true);
        }
        expect(environmentDisablesSandbox({}, "linux")).toBe(false);
    });

    it("counts an empty variable where getenv does, and not on Windows", () => {
        expect(environmentDisablesSandbox({ ELECTRON_DISABLE_SANDBOX: "" }, "linux")).toBe(true);
        expect(environmentDisablesSandbox({ ELECTRON_DISABLE_SANDBOX: "" }, "darwin")).toBe(true);
        expect(environmentDisablesSandbox({ ELECTRON_DISABLE_SANDBOX: "" }, "win32")).toBe(false);
    });
});
