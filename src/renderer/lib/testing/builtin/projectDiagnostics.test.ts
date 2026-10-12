import { describe, expect, it, vi } from "vitest";

// The editor is in Chinese for this test, so the finding's own message is Chinese while the agent's
// copy is English.
vi.mock("@/lib/i18n", async () => {
    const { createTranslator } = await import("@shared/i18n");
    const zh = createTranslator("zh");
    return { translate: zh.t, translateN: zh.tn };
});

const { toFinding } = await import("./projectDiagnostics");

describe("project-diagnostics findings", () => {
    it("carry the lint rule id and an English message beside the editor-language one", () => {
        const finding = toFinding({
            ruleId: "story/dead-end",
            severity: "warning",
            messageKey: "lint.rule.storyDeadEnd.message",
            location: { kind: "project" },
        } as never);
        expect(finding.ruleId).toBe("story/dead-end");
        expect(finding.englishMessage).toBe("Play runs off the end of the scene here");
        expect(finding.message).toEqual({ key: "lint.rule.storyDeadEnd.message", params: undefined });
    });

    it("report a minor warning as info, the test level that is never counted with the warnings", () => {
        const finding = toFinding({
            ruleId: "localization/missing",
            severity: "minor",
            messageKey: "lint.rule.localizationMissing.message",
            messageParams: { locale: "ko" },
            location: { kind: "project" },
        } as never);
        expect(finding.severity).toBe("info");
        expect(finding.ruleId).toBe("localization/missing");
    });
});
