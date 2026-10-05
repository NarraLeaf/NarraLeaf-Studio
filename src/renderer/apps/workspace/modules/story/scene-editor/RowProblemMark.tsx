import { CircleX, Info, TriangleAlert } from "lucide-react";
import type { TranslationKey } from "@shared/i18n";
import { useTranslation } from "@/lib/i18n";
import { deriveLintRuleSlug, LINT_SEVERITY_ORDER, resolveLintMessageParams, type LintReportEntry, type LintSeverity } from "@/lib/lint";
import { getHelpTopic, lintRuleHelpTopicId } from "@/lib/help";
import { cn } from "@/lib/utils/cn";
import { lintRuleTitleKey } from "../../lint/lintReportModel";
import { openProblemsPanel } from "../../lint/rowProblems";
import type { StoryRowDiagnosticCode } from "./storyRowDiagnostics";

const SEVERITY_ICON = { error: CircleX, warning: TriangleAlert, info: Info } as const;
const SEVERITY_TEXT_CLASS: Record<LintSeverity, string> = {
    error: "text-danger",
    warning: "text-warning",
    info: "text-primary",
};

/**
 * The mark beside a row that something is wrong with: one glyph in the colour of the worst finding,
 * every finding on hover, and the Problems panel on a click.
 *
 * It carries the row's own two checks too (a missing asset, a name the puppet's model does not
 * have), so a row never wears two marks side by side. The missing-asset check and the project check
 * for the same thing would say it twice; when the project check has spoken, its sentence is the one
 * shown.
 *
 * F1 over the mark opens the topic of the rule behind the first finding - what it found and how to
 * fix it - the same topic the panel's `?` opens.
 */
export function RowProblemMark({
    findings,
    legacyCode,
}: {
    findings: readonly LintReportEntry[];
    legacyCode: StoryRowDiagnosticCode | null;
}) {
    const { t, tn } = useTranslation();
    const coveredByFindings = legacyCode === "missingAsset" && findings.some(entry => entry.ruleId === "assets/missing");
    const legacy = legacyCode && !coveredByFindings ? legacyCode : null;
    if (findings.length === 0 && !legacy) {
        return null;
    }

    const severity: LintSeverity = findings.reduce<LintSeverity>(
        (worst, entry) => (LINT_SEVERITY_ORDER[entry.severity] < LINT_SEVERITY_ORDER[worst] ? entry.severity : worst),
        findings.length > 0 ? findings[0].severity : "warning",
    );
    const Icon = SEVERITY_ICON[severity];
    const lines = findings.map(entry =>
        t("story.rows.problem", {
            message: t(entry.messageKey, resolveLintMessageParams(entry, t, tn)),
            rule: t(lintRuleTitleKey(entry.ruleId)),
        }),
    );
    if (legacy) {
        lines.push(t(`story.diagnostics.${legacy}` as TranslationKey));
    }
    const label = lines.join("\n");
    const firstTopic = findings.length > 0 ? lintRuleHelpTopicId(deriveLintRuleSlug(findings[0].ruleId)) : null;

    // The row's own checks have no panel entry, so a mark that is only theirs is not a button.
    if (findings.length === 0) {
        return (
            <span
                className={cn("grid h-5 w-5 shrink-0 place-items-center", SEVERITY_TEXT_CLASS[severity])}
                data-tip={label}
                aria-label={label}
                role="img"
            >
                <Icon className="h-3.5 w-3.5" />
            </span>
        );
    }
    return (
        <button
            type="button"
            className={cn(
                "grid h-5 w-5 shrink-0 cursor-default place-items-center rounded-md hover:bg-fill",
                SEVERITY_TEXT_CLASS[severity],
            )}
            data-tip={label}
            aria-label={label}
            data-help-topic={firstTopic && getHelpTopic(firstTopic) ? firstTopic : undefined}
            data-story-row-problems={findings.length}
            // The row underneath selects on mouse-down; the mark is its own control.
            onMouseDown={event => event.stopPropagation()}
            onClick={event => {
                event.stopPropagation();
                openProblemsPanel();
            }}
        >
            <Icon className="h-3.5 w-3.5" />
        </button>
    );
}
