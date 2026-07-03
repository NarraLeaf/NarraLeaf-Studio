import { describe, expect, it } from "vitest";
import { DEFAULT_CDP_PORT, isMainDevMode, parseMainCommandLine } from "./commandLine";

describe("parseMainCommandLine", () => {
    it("keeps CDP disabled by default", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js"])).toEqual({
            dev: false,
            cdp: {
                enabled: false,
                port: DEFAULT_CDP_PORT,
                portSource: "default",
                error: null,
            },
        });
    });

    it("enables CDP with the default port", () => {
        expect(parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--cdp"])).toEqual({
            dev: true,
            cdp: {
                enabled: true,
                port: DEFAULT_CDP_PORT,
                portSource: "default",
                error: null,
            },
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

    it("allows development mode only for unpackaged --dev launches", () => {
        const options = parseMainCommandLine(["electron", "dist/main/index.js", "--dev", "--cdp"]);

        expect(isMainDevMode(options, false)).toBe(true);
        expect(isMainDevMode(options, true)).toBe(false);
    });
});
