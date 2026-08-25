import path from "path";
import { describe, expect, it } from "vitest";
import type { ExperimentalState } from "@shared/types/experimental";
import { planCommandLineBuild, resolveCommandLineBuildExperimental } from "./commandLineBuildPlan";
import type { BuildCommandLineOptions, ExperimentalCommandLineOptions } from "./commandLine";

/**
 * The plan joins and resolves output paths with `path`, so it answers in whichever spelling the
 * host uses. Fixtures and expectations are built the same way rather than written out: a Windows
 * path hard-coded here is a relative name on a Linux runner, and the assertion then measures the
 * runner rather than the plan.
 */
const ROOT = path.sep === "\\" ? "D:\\" : "/";
const PROJECT = path.join(ROOT, "games", "demo");
const WORKING_DIRECTORY = path.join(ROOT, "jobs", "42");

const BASE: BuildCommandLineOptions = {
    requested: true,
    selector: PROJECT,
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
        projectPath: PROJECT,
        hostPlatform: host,
        hostArch: "x64",
        workingDirectory: WORKING_DIRECTORY,
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

        expect(result.ok && result.plan.outputDir).toBe(path.join(PROJECT, "dist"));
    });

    it("resolves a relative output folder against the working directory, not the project", () => {
        const result = plan({ outputDir: "out" });

        expect(result.ok && result.plan.outputDir).toBe(path.join(WORKING_DIRECTORY, "out"));
    });

    it("resolves a relative report path the same way", () => {
        const result = plan({ reportPath: path.join("out", "report.json") });

        expect(result.ok && result.plan.reportPath).toBe(path.join(WORKING_DIRECTORY, "out", "report.json"));
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

/**
 * What the launch asked experimental mode for, and what `BaseApp.getExperimentalState` gave it.
 *
 * Two arguments rather than one because that is the whole subject: everything below is about the
 * cases where they differ.
 */
function asked(options: Partial<ExperimentalCommandLineOptions>): ExperimentalCommandLineOptions {
    return { requested: false, conditions: [], unknownConditionFlags: [], ...options };
}

function honoured(options: Partial<ExperimentalState>): ExperimentalState {
    return { enabled: false, conditions: [], unknownConditionFlags: [], ...options };
}

describe("resolveCommandLineBuildExperimental", () => {
    it("is off when nothing asked for it", () => {
        const result = resolveCommandLineBuildExperimental(asked({}), honoured({}));

        expect(result.refusal).toBeNull();
        expect(result.report).toEqual({
            state: "off",
            conditions: [],
            requestedConditions: [],
            unknownConditionFlags: [],
        });
    });

    it("reports the conditions an honoured run turned on", () => {
        const result = resolveCommandLineBuildExperimental(
            asked({ requested: true, conditions: ["debuggable-build"] }),
            honoured({ enabled: true, conditions: ["debuggable-build"] }),
        );

        expect(result.refusal).toBeNull();
        expect(result.report).toEqual({
            state: "on",
            conditions: ["debuggable-build"],
            requestedConditions: ["debuggable-build"],
            unknownConditionFlags: [],
        });
    });

    it("is on with nothing changed when the mode was opened and no condition followed", () => {
        const result = resolveCommandLineBuildExperimental(
            asked({ requested: true }),
            honoured({ enabled: true }),
        );

        expect(result.refusal).toBeNull();
        expect(result.report.state).toBe("on");
        expect(result.report.conditions).toEqual([]);
    });

    /**
     * The case the whole field exists for: a packaged Studio turns the mode off whatever the line
     * said, so this launch would have archived a production artifact believing it was debuggable.
     */
    it("refuses a mode this Studio cannot enter, and says what was asked for", () => {
        const result = resolveCommandLineBuildExperimental(
            asked({ requested: true, conditions: ["debuggable-build"] }),
            honoured({ enabled: false }),
        );

        expect(result.refusal).toContain("cannot enter experimental mode");
        expect(result.refusal).toContain("--x-debuggable-build");
        expect(result.report).toEqual({
            state: "refused",
            refusal: "unavailable",
            conditions: [],
            requestedConditions: ["debuggable-build"],
            unknownConditionFlags: [],
        });
    });

    it("refuses `--experimental` on its own when it cannot be honoured", () => {
        // No carve-out for "the mode would have changed nothing anyway": deciding that means
        // knowing what each condition does, in the one place that must not have to know.
        const result = resolveCommandLineBuildExperimental(
            asked({ requested: true }),
            honoured({ enabled: false }),
        );

        expect(result.report.refusal).toBe("unavailable");
        expect(result.refusal).toContain("--experimental");
    });

    it("refuses a condition flag given without --experimental", () => {
        const result = resolveCommandLineBuildExperimental(
            asked({ conditions: ["debuggable-build"] }),
            honoured({ enabled: false }),
        );

        expect(result.report).toEqual({
            state: "refused",
            refusal: "mode-not-opened",
            conditions: [],
            requestedConditions: ["debuggable-build"],
            unknownConditionFlags: [],
        });
        expect(result.refusal).toContain("--experimental");
    });

    it("refuses a --x- flag that names no condition", () => {
        // A typo of a real condition produces exactly the artifact a typo must not produce quietly.
        const result = resolveCommandLineBuildExperimental(
            asked({ requested: true, unknownConditionFlags: ["--x-debugable-build"] }),
            honoured({ enabled: true }),
        );

        expect(result.report).toEqual({
            state: "refused",
            refusal: "unknown-condition",
            conditions: [],
            requestedConditions: [],
            unknownConditionFlags: ["--x-debugable-build"],
        });
        expect(result.refusal).toContain("debuggable-build");
    });

    it("never reports a condition the mode did not actually turn on", () => {
        // The report's `conditions` is what the artifact is. Nothing but an honoured run may fill
        // it, whatever the line asked for.
        for (const state of [honoured({}), honoured({ enabled: false, conditions: ["debuggable-build"] })]) {
            const result = resolveCommandLineBuildExperimental(
                asked({ requested: true, conditions: ["debuggable-build"] }),
                state,
            );

            expect(result.report.conditions).toEqual([]);
        }
    });
});
