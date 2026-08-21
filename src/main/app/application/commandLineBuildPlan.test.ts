import { describe, expect, it } from "vitest";
import { planCommandLineBuild } from "./commandLineBuildPlan";
import type { BuildCommandLineOptions } from "./commandLine";

const BASE: BuildCommandLineOptions = {
    requested: true,
    selector: "D:\\games\\demo",
    variantId: null,
    platform: null,
    format: null,
    arch: null,
    outputDir: null,
    reportPath: null,
    allowUnsigned: false,
    error: null,
};

function plan(options: Partial<BuildCommandLineOptions>, host: "windows" | "macos" | "linux" = "windows") {
    return planCommandLineBuild({
        options: { ...BASE, ...options },
        projectPath: "D:\\games\\demo",
        hostPlatform: host,
        hostArch: "x64",
        workingDirectory: "D:\\jobs\\42",
    });
}

describe("planCommandLineBuild", () => {
    it("builds for the host platform in its first format when nothing says otherwise", () => {
        const result = plan({});

        expect(result).toEqual({
            ok: true,
            plan: expect.objectContaining({
                platform: "windows",
                format: "zip",
                arch: "x64",
                variantId: "main",
            }),
        });
    });

    it("never reveals the output folder", () => {
        // A command-line build must not open a file manager on a machine somebody is using.
        const result = plan({});

        expect(result.ok && result.plan.request.openWhenDone).toBe(false);
    });

    it("produces exactly one target", () => {
        const result = plan({ platform: "windows", format: "nsis", arch: "arm64" });

        expect(result.ok && result.plan.request.targets).toEqual([
            { platform: "windows", formats: ["nsis"], arch: "arm64" },
        ]);
    });

    it("defaults the output folder to the project's dist", () => {
        const result = plan({});

        expect(result.ok && result.plan.outputDir).toBe("D:\\games\\demo\\dist");
    });

    it("resolves a relative output folder against the working directory, not the project", () => {
        const result = plan({ outputDir: "out" });

        expect(result.ok && result.plan.outputDir).toBe("D:\\jobs\\42\\out");
    });

    it("resolves a relative report path the same way", () => {
        const result = plan({ reportPath: "out\\report.json" });

        expect(result.ok && result.plan.reportPath).toBe("D:\\jobs\\42\\out\\report.json");
    });

    it("refuses a platform this host cannot build for", () => {
        const result = plan({ platform: "macos" });

        expect(result).toEqual({
            ok: false,
            reason: expect.stringContaining("Cannot build for macos on this machine"),
        });
    });

    it("refuses a format the platform does not offer", () => {
        const result = plan({ platform: "web", format: "nsis" });

        expect(result).toEqual({
            ok: false,
            reason: expect.stringContaining('The web platform has no format "nsis"'),
        });
    });

    it("refuses an unknown platform", () => {
        const result = plan({ platform: "switch" });

        expect(result).toEqual({ ok: false, reason: expect.stringContaining('Unknown --build-target "switch"') });
    });

    it("refuses an architecture the platform does not offer", () => {
        const result = plan({ platform: "windows", arch: "universal" });

        expect(result).toEqual({
            ok: false,
            reason: expect.stringContaining('The windows platform cannot be built for "universal"'),
        });
    });

    it("refuses an architecture on a platform that has none, rather than ignoring it", () => {
        // Silently dropping the flag is how a script ships the wrong thing for months.
        const result = plan({ platform: "web", arch: "x64" });

        expect(result).toEqual({
            ok: false,
            reason: expect.stringContaining("--build-arch does not apply to the web platform"),
        });
    });

    it("carries no architecture for a platform that has none", () => {
        const result = plan({ platform: "web" });

        expect(result.ok && result.plan.request.targets[0]).toEqual({ platform: "web", formats: ["zip"] });
    });

    it("takes the named variant", () => {
        const result = plan({ variantId: "demo" });

        expect(result.ok && result.plan.request.appTagId).toBe("demo");
    });

    it("cross-builds for x64 by default", () => {
        const result = plan({ platform: "windows" }, "linux");

        expect(result.ok && result.plan.arch).toBe("x64");
    });
});
