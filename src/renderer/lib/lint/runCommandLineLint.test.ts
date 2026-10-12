import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandLineRunEvent } from "@shared/types/commandLineRun";
import { Services, type WorkspaceContext } from "../workspace/services/services";
import type { LintingConfiguration } from "../workspace/project/configuration";
import type { LintReport, LintReportEntry, LintRuleId, LintSeverity } from "./types";
import { countLintSeverities } from "./types";
import { runCommandLineLint } from "./runCommandLineLint";

/**
 * `narraleaf-studio --lint`: what a sweep's severities do to the run's outcome and to its log.
 *
 * The outcome is what the process exits with - `ok: false` is `check-failed` - so it is the thing a
 * job acts on. A minor warning must never make it fail, whatever the project's threshold.
 */

const events = vi.hoisted(() => [] as CommandLineRunEvent[]);

vi.mock("@/lib/app/bridge", () => ({
    getInterface: () => ({ workspace: { reportCommandLineRun: (event: CommandLineRunEvent) => events.push(event) } }),
}));

vi.mock("@/lib/i18n/store", () => ({ i18nStore: { setLocale: () => undefined } }));

vi.mock("@/lib/i18n", () => ({
    translate: (key: string, params?: Record<string, unknown>) => (params ? `${key}(${JSON.stringify(params)})` : key),
    translateN: (key: string, count: number) => `${key}(${JSON.stringify({ count })})`,
}));

function finding(severity: LintSeverity, ruleId: LintRuleId): LintReportEntry {
    return {
        ruleId,
        severity,
        messageKey: "lint.rule.localizationMissing.message",
        messageParams: { locale: "ko" },
        location: { kind: "story", storyId: "s1", storyName: "Main", sceneId: "sc1", sceneName: "Hall", line: 3 },
    };
}

function report(entries: LintReportEntry[]): LintReport {
    return { startedAt: 1_000, finishedAt: 1_400, entries, counts: countLintSeverities(entries), rulesRun: [], skipped: [] };
}

function context(lintReport: LintReport, failBuildOn: LintingConfiguration["failBuildOn"]): WorkspaceContext {
    const linting: LintingConfiguration = { runOnBuild: true, failBuildOn, severities: {}, options: {} };
    const services = {
        [Services.Lint]: { run: async () => lintReport },
        [Services.Project]: { getLintingConfiguration: () => linting },
    } as Record<string, unknown>;
    return { services: { get: (id: string) => services[id] } } as unknown as WorkspaceContext;
}

function finished(): Extract<CommandLineRunEvent, { kind: "finished" }> {
    const last = events[events.length - 1];
    if (!last || last.kind !== "finished") {
        throw new Error("the run did not finish");
    }
    return last;
}

beforeEach(() => {
    events.length = 0;
});

describe("runCommandLineLint", () => {
    it("passes a sweep of minor warnings, under either threshold", async () => {
        for (const failBuildOn of ["error", "warning"] as const) {
            events.length = 0;
            const entries = Array.from({ length: 12 }, () => finding("minor", "localization/missing"));

            await runCommandLineLint(context(report(entries), failBuildOn));

            expect(finished().ok).toBe(true);
            expect(finished().error).toBeUndefined();
        }
    });

    it("fails on a warning only where the project stops on warnings, minor warnings beside it or not", async () => {
        const entries = [finding("warning", "text/empty"), finding("minor", "localization/missing")];

        await runCommandLineLint(context(report(entries), "error"));
        expect(finished().ok).toBe(true);

        events.length = 0;
        await runCommandLineLint(context(report(entries), "warning"));
        expect(finished().ok).toBe(false);
        // The refusal counts the warning alone.
        expect(finished().error).toContain("Lint found 1 finding ");
    });

    it("prints a minor warning at info and reports it as minor, with a count of its own", async () => {
        const entries = [finding("minor", "localization/missing"), finding("minor", "localization/missing")];

        await runCommandLineLint(context(report(entries), "warning"));

        const findingLines = events.filter(event => event.kind === "log" && event.message.includes("lint.console.finding"));
        expect(findingLines).toHaveLength(2);
        expect(findingLines.every(event => event.kind === "log" && event.level === "info")).toBe(true);
        expect(events.some(event => event.kind === "log" && event.level === "warning")).toBe(false);
        const lint = finished().lint;
        expect(lint?.counts).toEqual({ error: 0, warning: 0, minor: 2, info: 0 });
        expect(lint?.findings.map(entry => entry.severity)).toEqual(["minor", "minor"]);
    });
});
