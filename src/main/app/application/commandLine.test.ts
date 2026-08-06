import { describe, expect, it } from "vitest";
import { DEFAULT_CDP_PORT, DEFAULT_DEV_RELOAD_PORT, isMainDevMode, parseMainCommandLine } from "./commandLine";

const DEFAULT_DEV_RELOAD = {
    port: DEFAULT_DEV_RELOAD_PORT,
    portSource: "default",
    error: null,
} as const;

describe("parseMainCommandLine", () => {
    it("keeps CDP disabled by default", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js"])).toEqual({
            dev: false,
            onboarding: false,
            cdp: {
                enabled: false,
                port: DEFAULT_CDP_PORT,
                portSource: "default",
                error: null,
            },
            devReload: DEFAULT_DEV_RELOAD,
        });
    });

    it("enables CDP with the default port", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--cdp"])).toEqual({
            dev: true,
            onboarding: false,
            cdp: {
                enabled: true,
                port: DEFAULT_CDP_PORT,
                portSource: "default",
                error: null,
            },
            devReload: DEFAULT_DEV_RELOAD,
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

    it("allows development mode only for unpackaged --dev launches", () => {
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--cdp"]);

        expect(isMainDevMode(options, false)).toBe(true);
        expect(isMainDevMode(options, true)).toBe(false);
    });
});
