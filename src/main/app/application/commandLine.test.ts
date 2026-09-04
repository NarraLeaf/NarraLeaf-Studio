import { describe, expect, it } from "vitest";
import { DEFAULT_CDP_PORT, DEFAULT_DEV_RELOAD_PORT, isMainDevMode, parseMainCommandLine } from "./commandLine";

const DEFAULT_DEV_RELOAD = {
    port: DEFAULT_DEV_RELOAD_PORT,
    portSource: "default",
    error: null,
} as const;

const NO_STARTUP_PROJECT = {
    selector: null,
    error: null,
} as const;

const NO_EXPERIMENTAL = {
    requested: false,
    conditions: [],
    unknownConditionFlags: [],
} as const;

const NO_BUILD = {
    requested: false,
    selector: null,
    variantId: null,
    platform: null,
    format: null,
    arch: null,
    outputDir: null,
    reportPath: null,
    userDataDir: null,
    signingPath: null,
    settings: [],
    allowUnsigned: false,
    error: null,
} as const;

const NO_CHECK = {
    requested: false,
    kind: null,
    selector: null,
    testId: null,
    list: false,
    parameters: [],
    reportPath: null,
    userDataDir: null,
    error: null,
} as const;

describe("parseMainCommandLine", () => {
    it("keeps CDP disabled by default", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js"])).toEqual({
            dev: false,
            onboarding: false,
            skipOnboarding: false,
            project: NO_STARTUP_PROJECT,
            launcher: false,
            build: NO_BUILD,
            check: NO_CHECK,
            cdp: {
                enabled: false,
                port: DEFAULT_CDP_PORT,
                portSource: "default",
                error: null,
            },
            devReload: DEFAULT_DEV_RELOAD,
            experimental: NO_EXPERIMENTAL,
            openPaths: [],
        });
    });

    it("enables CDP with the default port", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--cdp"])).toEqual({
            dev: true,
            onboarding: false,
            skipOnboarding: false,
            project: NO_STARTUP_PROJECT,
            launcher: false,
            build: NO_BUILD,
            check: NO_CHECK,
            cdp: {
                enabled: true,
                port: DEFAULT_CDP_PORT,
                portSource: "default",
                error: null,
            },
            devReload: DEFAULT_DEV_RELOAD,
            experimental: NO_EXPERIMENTAL,
            openPaths: [],
        });
    });

    it("parses inline CDP port values", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--cdp", "--cdp-port=9333"]).cdp).toEqual({
            enabled: true,
            port: 9333,
            portSource: "argument",
            error: null,
        });
    });

    it("parses split CDP port values", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--cdp", "--cdp-port", "9334"]).cdp).toEqual({
            enabled: true,
            port: 9334,
            portSource: "argument",
            error: null,
        });
    });

    it("reports invalid CDP port values", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--cdp", "--cdp-port=abc"]).cdp).toEqual({
            enabled: true,
            port: DEFAULT_CDP_PORT,
            portSource: "default",
            error: "Invalid --cdp-port value: abc",
        });
    });

    it("defaults the dev reload port to the dev server's own default", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev"]).devReload).toEqual({
            port: DEFAULT_DEV_RELOAD_PORT,
            portSource: "default",
            error: null,
        });
    });

    it("parses inline dev reload port values", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--dev-reload-port=5628"]).devReload).toEqual({
            port: 5628,
            portSource: "argument",
            error: null,
        });
    });

    it("parses split dev reload port values", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--dev-reload-port", "5628"]).devReload).toEqual({
            port: 5628,
            portSource: "argument",
            error: null,
        });
    });

    it("reports invalid dev reload port values", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--dev-reload-port=abc"]).devReload).toEqual({
            port: DEFAULT_DEV_RELOAD_PORT,
            portSource: "default",
            error: "Invalid --dev-reload-port value: abc",
        });
    });

    it("lets a later dev reload port override an earlier one", () => {
        // dev-electron.js passes its own port first and forwards user args after,
        // so an explicit --dev-reload-port on the command line has to win.
        const argv = ["electron", "dist/main/index.js", "--dev", "--dev-reload-port=5588", "--dev-reload-port=5628"];

        expect(parseMainCommandLine(argv).devReload.port).toBe(5628);
    });

    it("keeps the CDP and dev reload ports independent", () => {
        const options = parseMainCommandLine([
            "electron", "dist/main/index.js", "--dev", "--cdp", "--cdp-port", "9224", "--dev-reload-port", "5628",
        ]);

        expect(options.cdp.port).toBe(9224);
        expect(options.devReload.port).toBe(5628);
    });

    it("reads the onboarding rerun flag", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev"]).onboarding).toBe(false);
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--onboarding"]).onboarding).toBe(true);
    });

    it("does not let --onboarding disturb the flags parsed around it", () => {
        // It sits in the same loop as the port flags and takes no value of its own; a missing
        // `continue` there would have it swallowed as somebody else's argument.
        const options = parseMainCommandLine([
            "electron", "dist/main/index.js", "--dev", "--onboarding", "--cdp", "--cdp-port", "9333",
        ]);

        expect(options.onboarding).toBe(true);
        expect(options.cdp.port).toBe(9333);
        expect(options.cdp.error).toBeNull();
    });

    it("reads the onboarding skip flag", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev"]).skipOnboarding).toBe(false);
        expect(
            parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--skip-onboarding"]).skipOnboarding,
        ).toBe(true);
    });

    it("parses --launcher, and lets it stand alongside --project", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js"]).launcher).toBe(false);
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--launcher"]).launcher).toBe(true);

        // Both together is not a contradiction the parse has to settle: --project names a project
        // and wins, which `App.resolveSessionStartupProject` decides. The parse only records what
        // was typed - a flag silently dropped here would be invisible to the one place that can
        // explain the precedence.
        const both = parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--launcher", "--project=demo3"]);
        expect(both.launcher).toBe(true);
        expect(both.project.selector).toBe("demo3");
    });

    it("does not read --launcher as a --project value", () => {
        // The same trap `--project --cdp` used to fall into: swallowing the next flag would take
        // the escape hatch out of the parse in the one launch that typed it by mistake.
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--project", "--launcher"]);

        expect(options.project.selector).toBeNull();
        expect(options.launcher).toBe(true);
    });

    it("parses inline and split --project values", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--project=demo3"]).project).toEqual({
            selector: "demo3",
            error: null,
        });
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--project", "D:\\games\\demo3"]).project)
            .toEqual({ selector: "D:\\games\\demo3", error: null });
    });

    it("reports a --project without a value instead of swallowing the next flag", () => {
        // `--project --cdp` used to be a project called "--cdp", which also took --cdp out of the
        // parse: one typo, two switches lost, no message.
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--project", "--cdp"]);

        expect(options.project.selector).toBeNull();
        expect(options.project.error).toMatch(/Missing --project value/);
        expect(options.cdp.enabled).toBe(true);
    });

    it("reports an empty inline --project value", () => {
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--project="]);

        expect(options.project.selector).toBeNull();
        expect(options.project.error).toMatch(/Missing --project value/);
    });

    it("does not let the new flags disturb the ones parsed around them", () => {
        const options = parseMainCommandLine([
            "electron", "dist/main/index.js", "--dev", "--skip-onboarding", "--project", "demo3",
            "--cdp", "--cdp-port", "9333", "--dev-reload-port", "5628",
        ]);

        expect(options.skipOnboarding).toBe(true);
        expect(options.project.selector).toBe("demo3");
        expect(options.cdp.port).toBe(9333);
        expect(options.cdp.error).toBeNull();
        expect(options.devReload.port).toBe(5628);
        expect(options.devReload.error).toBeNull();
    });

    it("lets a later --project override an earlier one", () => {
        const options = parseMainCommandLine([
            "electron", "dist/main/index.js", "--dev", "--project=first", "--project", "second",
        ]);

        expect(options.project.selector).toBe("second");
    });

    it("reads the experimental flag and its condition flags", () => {
        const options = parseMainCommandLine([
            "electron", "dist/main/index.js", "--dev", "--experimental", "--x-debuggable-build",
        ]);

        expect(options.experimental).toEqual({
            requested: true,
            conditions: ["debuggable-build"],
            unknownConditionFlags: [],
        });
    });

    it("parses condition flags without --experimental, which decides nothing on its own", () => {
        // The mode is what honours them (BaseApp.getExperimentalState); parsing only reports what
        // was on the command line.
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--x-debuggable-build"]);

        expect(options.experimental.requested).toBe(false);
        expect(options.experimental.conditions).toEqual(["debuggable-build"]);
    });

    it("collects condition flags that name nothing instead of dropping them", () => {
        const options = parseMainCommandLine([
            "electron", "dist/main/index.js", "--experimental", "--x-no-such-condition",
        ]);

        expect(options.experimental.conditions).toEqual([]);
        expect(options.experimental.unknownConditionFlags).toEqual(["--x-no-such-condition"]);
    });

    it("does not repeat a condition given twice", () => {
        const options = parseMainCommandLine([
            "electron", "dist/main/index.js", "--experimental", "--x-debuggable-build", "--x-debuggable-build",
        ]);

        expect(options.experimental.conditions).toEqual(["debuggable-build"]);
    });

    it("does not let the experimental flags disturb the ones parsed around them", () => {
        const options = parseMainCommandLine([
            "electron", "dist/main/index.js", "--dev", "--experimental", "--x-debuggable-build",
            "--project", "demo3", "--cdp", "--cdp-port", "9333",
        ]);

        expect(options.project.selector).toBe("demo3");
        expect(options.cdp.port).toBe(9333);
        expect(options.cdp.error).toBeNull();
    });

    it("allows development mode only for unpackaged --dev launches", () => {
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--cdp"]);

        expect(isMainDevMode(options, false)).toBe(true);
        expect(isMainDevMode(options, true)).toBe(false);
    });

    it("collects the paths a packaged launch was given", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "D:\\games\\demo3\\Demo.nlproj"]);

        expect(options.openPaths).toEqual(["D:\\games\\demo3\\Demo.nlproj"]);
    });

    it("does not mistake the development entry point for a path to open", () => {
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--dev"]);

        expect(options.openPaths).toEqual([]);
    });

    it("keeps a path given alongside the development entry point", () => {
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "D:\\games\\demo3"]);

        expect(options.openPaths).toEqual(["D:\\games\\demo3"]);
    });

    it("does not take a flag's value for a path to open", () => {
        // Both forms, because only the separated one can look positional.
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe", "--project", "demo3", "--cdp-port", "9333", "--project=demo4",
        ]);

        expect(options.openPaths).toEqual([]);
    });

    it("reads the build flags in both forms", () => {
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe",
            "--build", "D:\games\demo",
            "--build-variant=demo",
            "--build-target", "windows",
            "--build-format=nsis",
            "--build-arch", "arm64",
            "--build-output=D:\out",
            "--build-report", "D:\out\report.json",
            "--build-user-data-dir=D:\profiles\agent",
            "--build-signing", "D:\keys\signing.json",
            "--build-allow-unsigned",
        ]);

        expect(options.build).toEqual({
            requested: true,
            selector: "D:\games\demo",
            variantId: "demo",
            platform: "windows",
            format: "nsis",
            arch: "arm64",
            outputDir: "D:\out",
            reportPath: "D:\out\report.json",
            userDataDir: "D:\profiles\agent",
            signingPath: "D:\keys\signing.json",
            settings: [],
            allowUnsigned: true,
            error: null,
        });
    });

    it("keeps every --build-setting rather than only the last", () => {
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe",
            "--build", "demo",
            "--build-setting", "build.electronMirror=https://mirror.example/electron/",
            // The value carries an "=" of its own; only the first one separates.
            "--build-setting=build.zigMirror=https://mirror.example/zig?token=abc",
        ]);

        expect(options.build.settings).toEqual([
            "build.electronMirror=https://mirror.example/electron/",
            "build.zigMirror=https://mirror.example/zig?token=abc",
        ]);
    });

    it("refuses a profile or a credential file that names no build", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--build-user-data-dir", "D:\\profiles\\agent"]);

        expect(options.build.requested).toBe(true);
        expect(options.build.error).toBe("Missing --build: the build flags name a build nothing asked for");
    });

    it("does not take a build flag's value for a path to open", () => {
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe", "--build", "demo", "--build-target", "web",
        ]);

        expect(options.openPaths).toEqual([]);
    });

    it("still reports a build when --build was given no value", () => {
        // `requested` has to survive the value being the thing that is missing, or the launch would
        // fall through to the home screen with nobody there to read it.
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--build"]);

        expect(options.build.requested).toBe(true);
        expect(options.build.selector).toBeNull();
        expect(options.build.error).toBe(
            "Missing --build value: expected a project path or a recent project's name",
        );
    });

    it("refuses build flags that name a build nothing asked for", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--build-target", "windows"]);

        expect(options.build.requested).toBe(true);
        expect(options.build.error).toBe("Missing --build: the build flags name a build nothing asked for");
    });

    it("forgives a flag that was given a value on a later pass", () => {
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe", "--build", "demo", "--build-format", "--build-format=zip",
        ]);

        expect(options.build.format).toBe("zip");
        expect(options.build.error).toBeNull();
    });

    it("reports the first flag still missing a value", () => {
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe", "--build", "demo", "--build-target", "--build-report",
        ]);

        expect(options.build.error).toBe("Missing --build-target value: expected a platform");
    });

    it("asks for no build when none was mentioned", () => {
        expect(parseMainCommandLine(["NarraLeaf-Studio.exe", "--dev"]).build).toEqual(NO_BUILD);
    });

    it("asks for no check when none was mentioned", () => {
        expect(parseMainCommandLine(["NarraLeaf-Studio.exe", "--dev"]).check).toEqual(NO_CHECK);
    });

    it("reads a test run and its parameters", () => {
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe",
            "--test", "C:/games/demo",
            "--test-id", "narraleaf-studio:reachable-endings",
            "--test-parameter", "ending=good",
            "--test-parameter=verbose=true",
            "--test-report", "out/test.json",
        ]);

        expect(options.check).toEqual({
            requested: true,
            kind: "test",
            selector: "C:/games/demo",
            testId: "narraleaf-studio:reachable-endings",
            list: false,
            parameters: ["ending=good", "verbose=true"],
            reportPath: "out/test.json",
            userDataDir: null,
            error: null,
        });
    });

    it("reads a lint sweep", () => {
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe", "--lint=C:/games/demo", "--lint-user-data-dir", "C:/tmp/profile",
        ]);

        expect(options.check.kind).toBe("lint");
        expect(options.check.selector).toBe("C:/games/demo");
        expect(options.check.userDataDir).toBe("C:/tmp/profile");
        expect(options.check.error).toBeNull();
    });

    it("treats --test-list as a test request that names no test", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--test", "demo", "--test-list"]);

        expect(options.check.kind).toBe("test");
        expect(options.check.list).toBe(true);
        expect(options.check.testId).toBeNull();
        expect(options.check.error).toBeNull();
    });

    it("does not take a check flag's value as a path to open", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--lint", "C:/games/demo"]);

        expect(options.openPaths).toEqual([]);
    });

    it("refuses a check flag given with no value", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--test", "demo", "--test-id"]);

        expect(options.check.requested).toBe(true);
        expect(options.check.error).toBe("Missing --test-id value: expected the id of a registered test");
    });

    it("refuses check flags that name a check nothing asked for", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--test-id", "some:test"]);

        expect(options.check.requested).toBe(true);
        expect(options.check.error)
            .toBe("Missing --test or --lint: the check flags name a check nothing asked for");
    });

    it("refuses both checks on one line", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--test", "demo", "--lint", "demo"]);

        expect(options.check.error).toBe("Both --test and --lint were given: one launch answers one question");
    });

    it("refuses a build and a check on one line", () => {
        const options = parseMainCommandLine(["NarraLeaf-Studio.exe", "--build", "demo", "--lint", "demo"]);

        expect(options.check.error)
            .toBe("A build and a check were given on one line: one launch answers one question");
    });

    it("keeps the last value when a check flag is given twice", () => {
        const options = parseMainCommandLine([
            "NarraLeaf-Studio.exe", "--lint", "first", "--lint", "second",
        ]);

        expect(options.check.selector).toBe("second");
    });
});
