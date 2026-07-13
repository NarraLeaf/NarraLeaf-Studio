import type { BlueprintGraphEditorDiagnostic } from "@/lib/workspace/services/ui-editor/blueprint/graphValidation";
import { useTranslation } from "@/lib/i18n";

type Props = {
    diagnostics: BlueprintGraphEditorDiagnostic[];
    onPick: (d: BlueprintGraphEditorDiagnostic) => void;
};

export function BlueprintDiagnosticsPanel({ diagnostics, onPick }: Props) {
    const { t } = useTranslation();
    const errors = diagnostics.filter(d => d.severity === "error");
    const warnings = diagnostics.filter(d => d.severity === "warning");
    const infos = diagnostics.filter(d => d.severity === "info");

    if (diagnostics.length === 0) {
        return (
            <div className="shrink-0 border-t border-edge bg-surface-sunken px-3 py-1.5 text-2xs text-fg-subtle">
                {t("blueprint.diagnostics.empty")}
            </div>
        );
    }

    const Row = ({ d }: { d: BlueprintGraphEditorDiagnostic }) => (
        <button
            type="button"
            className="flex w-full gap-2 rounded px-2 py-1 text-left hover:bg-fill-subtle"
            onClick={() => onPick(d)}
        >
            <span
                className={
                    d.severity === "error"
                        ? "text-red-400"
                        : d.severity === "warning"
                          ? "text-amber-400"
                          : "text-fg-muted"
                }
            >
                {d.severity}
            </span>
            <span className="flex-1 text-fg-muted">{d.message}</span>
            {d.code ? <span className="font-mono text-2xs text-fg-subtle">{d.code}</span> : null}
        </button>
    );

    return (
        <div className="max-h-32 shrink-0 overflow-y-auto border-t border-edge bg-surface-sunken px-2 py-1.5">
            <p className="mb-1 px-1 text-2xs tracking-wide text-fg-subtle">
                {t("blueprint.diagnostics.summary", {
                    errors: errors.length,
                    warnings: warnings.length,
                    infos: infos.length,
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
            </div>
        </div>
    );
}
