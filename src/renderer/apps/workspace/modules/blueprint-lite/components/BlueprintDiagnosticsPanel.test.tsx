// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { LintReportEntry } from "@/lib/lint";
import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { BlueprintDiagnosticsPanel } from "./BlueprintDiagnosticsPanel";

vi.mock("@/lib/i18n", async importOriginal => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useTranslation: () => ({ t: (key: string) => key, tn: (key: string) => key, has: () => false, locale: "en" }),
}));
afterEach(cleanup);

const diagnostic: BlueprintGraphEditorDiagnostic = {
    severity: "warning", message: "Editor warning", target: { kind: "node", graphKind: "event", graphId: "first", nodeId: "start" },
};
const problem = (graphId: string): LintReportEntry => ({
    ruleId: "blueprint/test" as LintReportEntry["ruleId"],
    messageKey: "lint.rule.test.message" as LintReportEntry["messageKey"],
    severity: "error",
    location: { kind: "blueprint", blueprintId: "bp", graphId, nodeId: "start" },
});

describe("blueprint diagnostics", () => {
    it("keeps a project finding on another layer with the same node id", () => {
        const onPickProblem = vi.fn();
        const otherLayer = problem("second");
        render(<BlueprintDiagnosticsPanel diagnostics={[diagnostic]} problems={[otherLayer]} onPick={() => undefined} onPickProblem={onPickProblem} />);
        fireEvent.click(screen.getByRole("button", { name: /lint.rule.test.message/ }));
        expect(onPickProblem).toHaveBeenCalledWith(otherLayer);
    });

    it("still omits a project finding on the node already flagged in the same layer", () => {
        render(<BlueprintDiagnosticsPanel diagnostics={[diagnostic]} problems={[problem("first")]} onPick={() => undefined} />);
        expect(screen.queryByText("lint.rule.test.message")).toBeNull();
    });
});
