import { describe, expect, it, vi } from "vitest";
import { runLintRules } from "./engine";
import { createTestLintContext } from "./testContext";
import type { LintFinding, LintRule, LintRuleId } from "./types";

/**
 * The engine's contract, stated as the four ways a sweep can go wrong: a rule that should not have
 * run, a severity that should have been overridden, a rule that threw, and a cancel that should
 * have stopped the rest.
 */

function makeRule(
    id: LintRuleId,
    overrides: Partial<LintRule> = {},
    findings: LintFinding[] = [],
): LintRule {
    return {
        id,
        category: id.split("/")[0] as LintRule["category"],
        defaultSeverity: "warning",
        slug: "test",
        run: () => findings,
        ...overrides,
    };
}

function finding(id: LintRuleId): LintFinding {
    return {
        ruleId: id,
        messageKey: "lint.rule.textEmpty.message",
        location: { kind: "project" },
    };
}

describe("runLintRules", () => {
    it("does not run a rule configured off, and records it as skipped", async () => {
        const run = vi.fn(() => []);
        const rules = [makeRule("text/empty", { run })];
        const ctx = createTestLintContext({
            config: { runOnBuild: true, failBuildOn: "error", severities: { "text/empty": "off" }, options: {} },
        });

        const report = await runLintRules(ctx, { rules });

        expect(run).not.toHaveBeenCalled();
        expect(report.skipped).toEqual(["text/empty"]);
        expect(report.rulesRun).toEqual([]);
    });

    it("lets a configured severity override the rule's default", async () => {
        const rules = [makeRule("text/empty", { defaultSeverity: "info" }, [finding("text/empty")])];
        const ctx = createTestLintContext({
            config: { runOnBuild: true, failBuildOn: "error", severities: { "text/empty": "error" }, options: {} },
        });

        const report = await runLintRules(ctx, { rules });

        expect(report.entries).toHaveLength(1);
        expect(report.entries[0].severity).toBe("error");
        expect(report.counts).toEqual({ error: 1, warning: 0, info: 0 });
    });

    it("reports a throwing rule and keeps sweeping", async () => {
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
        const rules = [
            makeRule("story/empty-scene", {
                run: () => {
                    throw new Error("boom");
                },
            }),
            makeRule("text/empty", {}, [finding("text/empty")]),
        ];

        const report = await runLintRules(createTestLintContext(), { rules });

        const failure = report.entries.find(entry => entry.messageKey === "lint.message.ruleFailed");
        expect(failure).toBeDefined();
        expect(failure?.severity).toBe("error");
        expect(failure?.messageParams).toEqual({ rule: "story/empty-scene" });
        expect(failure?.location).toEqual({ kind: "project" });
        expect(report.entries.filter(entry => entry.messageKey === "lint.message.ruleFailed")).toHaveLength(1);
        // The rule after the failure still produced its finding.
        expect(report.entries.some(entry => entry.ruleId === "text/empty")).toBe(true);
        expect(report.rulesRun).toEqual(["story/empty-scene", "text/empty"]);
        consoleError.mockRestore();
    });

    it("sorts entries errors first", async () => {
        const rules = [
            makeRule("text/empty", { defaultSeverity: "info" }, [finding("text/empty")]),
            makeRule("story/empty-scene", { defaultSeverity: "error" }, [finding("story/empty-scene")]),
            makeRule("story/dead-end", { defaultSeverity: "warning" }, [finding("story/dead-end")]),
        ];

        const report = await runLintRules(createTestLintContext(), { rules });

        expect(report.entries.map(entry => entry.severity)).toEqual(["error", "warning", "info"]);
    });

    it("numbers a rule's story rows for it, and reads them out in document order", async () => {
        // The rule reports its two rows back to front, and names neither line: numbering is the
        // engine's job (so a rule cannot forget it) and so is the ordering, which used to fall out of
        // block-id comparison - a UUID, i.e. shuffled - and now follows the scene top down.
        const rows = ["r2", "r1"].map(blockId => ({
            ruleId: "text/empty" as LintRuleId,
            messageKey: "lint.rule.textEmpty.message" as LintFinding["messageKey"],
            location: {
                kind: "story" as const,
                storyId: "st1",
                storyName: "Chapter One",
                sceneId: "sc1",
                sceneName: "Opening",
                blockId,
            },
        }));
        const block = (id: string, value: string) => ({
            id,
            kind: "nodeAction",
            parentId: null,
            childrenIds: [],
            payload: { action: "narration", text: { textId: `t-${id}`, role: "narration", value } },
        });
        const ctx = createTestLintContext({
            stories: [
                {
                    id: "st1",
                    name: "Chapter One",
                    document: {
                        scenes: {
                            sc1: {
                                id: "sc1",
                                name: "Opening",
                                rootBlockIds: ["r1", "r2"],
                                blocks: { r1: block("r1", "first"), r2: block("r2", "second") },
                            },
                        },
                    },
                } as unknown as (typeof ctx)["stories"][number],
            ],
        });

        const report = await runLintRules(ctx, { rules: [makeRule("text/empty", {}, rows)] });

        expect(report.entries.map(entry => entry.location.kind === "story" && entry.location.line)).toEqual([1, 2]);
        expect(report.entries.map(entry => entry.location.kind === "story" && entry.location.excerpt))
            .toEqual(["first", "second"]);
    });

    it("stops at a cancellation and reports the unrun rules as skipped", async () => {
        const controller = new AbortController();
        const second = vi.fn(() => []);
        const rules = [
            makeRule("story/empty-scene", {
                run: () => {
                    controller.abort();
                    return [];
                },
            }),
            makeRule("text/empty", { run: second }),
            makeRule("text/overlong", {}),
        ];

        const report = await runLintRules(createTestLintContext(), { rules, signal: controller.signal });

        expect(second).not.toHaveBeenCalled();
        expect(report.rulesRun).toEqual(["story/empty-scene"]);
        expect(report.skipped).toEqual(["text/empty", "text/overlong"]);
    });

    it("reports progress once per scheduled rule", async () => {
        const progress: { done: number; total: number; ruleId: string }[] = [];
        const rules = [makeRule("text/empty"), makeRule("text/overlong")];

        await runLintRules(createTestLintContext(), { rules, onProgress: p => progress.push({ ...p }) });

        expect(progress).toEqual([
            { done: 1, total: 2, ruleId: "text/empty" },
            { done: 2, total: 2, ruleId: "text/overlong" },
        ]);
    });
});
