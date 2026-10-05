import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { useTranslation } from "@/lib/i18n";
import { resolveLintMessageParams, type LintReportEntry, type LintSeverity } from "@/lib/lint";
import { lintRuleTitleKey, lintSeverityLabelKey } from "../../lint/lintReportModel";

type Props = {
    diagnostics: BlueprintGraphEditorDiagnostic[];
    onPick: (d: BlueprintGraphEditorDiagnostic) => void;
    /**
     * What the project checks found in this blueprint - the same findings the Problems panel lists.
     *
     * Shown here too because this list and the panel are both answers to "what is wrong with this
     * blueprint", and a list that said "no diagnostics" beside a node the panel calls an error was two
     * answers to one question. A finding on a node this list already flags is left out: the node is
     * marked once, by the check that runs as the graph is edited.
     */
    problems?: readonly LintReportEntry[];
    onPickProblem?: (entry: LintReportEntry) => void;
};

const SEVERITY_TEXT_CLASS: Record<LintSeverity, string> = {
    error: "text-danger",
    warning: "text-warning",
    info: "text-primary",
};

const SEVERITY_ORDER: Record<LintSeverity, number> = { error: 0, warning: 1, info: 2 };

export function BlueprintDiagnosticsPanel({ diagnostics, onPick, problems = [], onPickProblem }: Props) {
    const { t, tn } = useTranslation();
    const flaggedNodes = new Set(
        diagnostics.flatMap(d => (d.target?.kind === "node" && d.target.nodeId ? [d.target.nodeId] : [])),
    );
    const checks = problems
        .filter(entry => !(entry.location.kind === "blueprint" && entry.location.nodeId && flaggedNodes.has(entry.location.nodeId)))
        .slice()
        .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);

    const errors = diagnostics.filter(d => d.severity === "error");
    const warnings = diagnostics.filter(d => d.severity === "warning");
    const infos = diagnostics.filter(d => d.severity === "info");

    if (diagnostics.length === 0 && checks.length === 0) {
        return (
            <div className="shrink-0 border-t border-edge bg-surface-sunken px-3 py-1.5 text-2xs text-fg-subtle">
                {t("blueprint.diagnostics.empty")}
            </div>
        );
    }

    const count = (severity: LintSeverity) =>
        diagnostics.filter(d => d.severity === severity).length + checks.filter(entry => entry.severity === severity).length;

    const Row = ({ d }: { d: BlueprintGraphEditorDiagnostic }) => {
        const body = (
            <>
                <span className={SEVERITY_TEXT_CLASS[d.severity]}>{t(lintSeverityLabelKey(d.severity))}</span>
                <span className="flex-1 text-fg-muted">{d.message}</span>
                {d.code ? <span className="font-mono text-2xs text-fg-subtle">{d.code}</span> : null}
            </>
        );
        // A diagnostic that names nowhere — one about the blueprint as a whole — has nothing to go
        // to, so it is not offered as something to click.
        if (!d.target) {
            return <div className="flex w-full gap-2 px-2 py-1 text-left">{body}</div>;
        }
        return (
            <button
                type="button"
                className="flex w-full cursor-default gap-2 rounded-md px-2 py-1 text-left hover:bg-fill-subtle"
                onClick={() => onPick(d)}
            >
                {body}
            </button>
        );
    };

    const CheckRow = ({ entry }: { entry: LintReportEntry }) => {
        const body = (
            <>
                <span className={SEVERITY_TEXT_CLASS[entry.severity]}>{t(lintSeverityLabelKey(entry.severity))}</span>
                <span className="flex-1 text-fg-muted">{t(entry.messageKey, resolveLintMessageParams(entry, t, tn))}</span>
                <span className="text-2xs text-fg-subtle">{t(lintRuleTitleKey(entry.ruleId))}</span>
            </>
        );
        const navigable = entry.location.kind === "blueprint" && entry.location.graphId && onPickProblem;
        if (!navigable) {
            return <div className="flex w-full gap-2 px-2 py-1 text-left">{body}</div>;
        }
        return (
            <button
                type="button"
                className="flex w-full cursor-default gap-2 rounded-md px-2 py-1 text-left hover:bg-fill-subtle"
                onClick={() => onPickProblem(entry)}
            >
                {body}
            </button>
        );
    };

    return (
        <div className="max-h-32 shrink-0 overflow-y-auto border-t border-edge bg-surface-sunken px-2 py-1.5">
            <p className="mb-1 px-1 text-2xs tracking-wide text-fg-subtle">
                {t("lint.report.counts", {
                    errors: tn("common.count.errors", count("error")),
                    warnings: tn("common.count.warnings", count("warning")),
                    infos: tn("common.count.infos", count("info")),
                })}
            </p>
            <div className="space-y-0.5">
                {errors.map((d, i) => (
                    <Row key={`e-${i}-${d.message}`} d={d} />
                ))}
                {warnings.map((d, i) => (
                    <Row key={`w-${i}-${d.message}`} d={d} />
                ))}
                {infos.map((d, i) => (
                    <Row key={`n-${i}-${d.message}`} d={d} />
                ))}
                {checks.map((entry, i) => (
                    <CheckRow key={`c-${i}-${entry.ruleId}`} entry={entry} />
                ))}
            </div>
        </div>
    );
}
