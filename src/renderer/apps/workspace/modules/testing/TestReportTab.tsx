import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { Badge, Select, type BadgeTone, type SelectOption } from "@/lib/components/elements";
import { controlButtonClass } from "@/lib/ui-editor/widget-modules/shared/chrome/constants";
import { cn } from "@/lib/utils/cn";
import { useTranslation } from "@/lib/i18n";
import type { TranslationKey } from "@shared/i18n";
import type { EditorTabComponentProps } from "@/lib/workspace/services/ui/types";
import {
    countTestFindings,
    type TestFinding,
    type TestFindingSeverity,
    type TestRunRecord,
    type TestRunStatus,
} from "@/lib/testing/types";
import { useWorkspace } from "../../context";
import { useRegistry } from "../../registry";
import { jumpToSearchTarget } from "../search/searchJump";
import { getTestRunService } from "./testRunService";
import {
    TEST_SEVERITY_LABEL_KEYS,
    TEST_SEVERITY_TEXT_CLASS,
    TEST_STATUS_LABEL_KEYS,
    formatTestDuration,
    resolveTestText,
    sortTestFindings,
} from "./testModel";

export type TestReportPayload = { runId: string };

const FINDING_ROW_HEIGHT_PX = 24;

/** The verdict's colour. `skipped` and `cancelled` are neither good nor bad news, so neither is tinted. */
const STATUS_TONE: Record<TestRunStatus, BadgeTone> = {
    running: "primary",
    passed: "success",
    failed: "danger",
    skipped: "neutral",
    cancelled: "neutral",
    errored: "danger",
};

type SeverityFilter = "all" | TestFindingSeverity;

const SEVERITY_FILTER_OPTIONS: SelectOption[] = [
    { value: "all", labelKey: "test.report.filterAll" as TranslationKey },
    { value: "error", labelKey: "test.severity.error" as TranslationKey },
    { value: "warning", labelKey: "test.severity.warning" as TranslationKey },
    { value: "info", labelKey: "test.severity.info" as TranslationKey },
];

/**
 * One run's verdict and its evidence (ruling R8).
 *
 * Shaped exactly like the lint report - one control row over one windowed list - because it answers
 * the same question about the same kind of thing, and two report surfaces that read differently is
 * two things for an author to learn. What differs:
 *
 *  - **The verdict rides in the control row, not in a banner above it.** A test's outcome is one
 *    word and its summary is one clause; giving them a bar of their own would stack two thin bars
 *    over the list, which is the shape this interface does not use.
 *  - **A severity is on the finding.** Unlike lint there is no project config to defer to, so each
 *    row states its own weight (ruling R10) and the filter reads straight off it.
 *  - **Re-running asks the service, not the freeze table.** `getAvailability` already knows that a
 *    windowed test is refused while frozen and that only one run happens at a time (rulings R7, R9),
 *    so the button consults it rather than keeping a second copy of those rules.
 */
export function TestReportTab({ payload }: EditorTabComponentProps<TestReportPayload>) {
    const { t } = useTranslation();
    const { context, isInitialized } = useWorkspace();
    const { openEditorTab, setPanelVisibility } = useRegistry();

    const testRun = useMemo(
        () => (context && isInitialized ? getTestRunService(context) : null),
        [context, isInitialized],
    );

    const runId = payload?.runId;
    const [record, setRecord] = useState<TestRunRecord | null>(null);
    const [severityFilter, setSeverityFilter] = useState<SeverityFilter>("all");
    const scrollRef = useRef<HTMLDivElement | null>(null);

    useEffect(() => {
        if (!testRun || !runId) {
            setRecord(null);
            return;
        }
        const sync = () => setRecord(testRun.getRun(runId));
        sync();
        return testRun.onChanged(sync);
    }, [testRun, runId]);

    const findings = useMemo(() => {
        const sorted = sortTestFindings(record?.findings ?? []);
        return severityFilter === "all" ? sorted : sorted.filter(f => f.severity === severityFilter);
    }, [record, severityFilter]);

    const virtualizer = useVirtualizer({
        count: findings.length,
        getScrollElement: () => scrollRef.current,
        estimateSize: () => FINDING_ROW_HEIGHT_PX,
        overscan: 16,
    });

    const handleJump = useCallback(
        (finding: TestFinding) => {
            if (!finding.target) {
                return;
            }
            jumpToSearchTarget(finding.target, { openEditorTab, setPanelVisibility, context });
        },
        [openEditorTab, setPanelVisibility, context],
    );

    const running = record?.status === "running";
    const rerunBlocked = !record
        || running
        || !testRun
        || testRun.getAvailability(record.testId).available === false;

    const handleRerun = useCallback(() => {
        if (!testRun || !record) {
            return;
        }
        void testRun.start(record.testId).catch(error => {
            console.warn("[TestReportTab] starting the test again failed", error);
        });
    }, [testRun, record]);

    const counts = record ? countTestFindings(record.findings) : null;
    const summary = record ? resolveTestText(record.summary, t) : "";
    const duration = record ? formatTestDuration(record, t) : "";
    /**
     * What the header says when the test said nothing.
     *
     * A verdict with no summary of its own falls back to the counts rather than to silence - the
     * word "Failed" alone is a report that makes the author open the list to learn anything.
     */
    const headline = summary
        || (counts
            ? t("test.report.findings", {
                errors: counts.error,
                warnings: counts.warning,
                infos: counts.info,
            })
            : "");

    /**
     * The two silences, told apart. "No findings" is claimed only about a run that finished and
     * produced none - never about a run still going, never about a tab with no run behind it, and
     * never when the filter is what emptied the list.
     */
    const placeholder = !record
        ? t("test.report.none")
        : running
          ? ""
          : record.findings.length === 0
            ? t("test.report.empty")
            : "";

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface" data-help-topic="tests">
            <div className="flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
                {record ? (
                    <Badge className="shrink-0" tone={STATUS_TONE[record.status]}>
                        {t(TEST_STATUS_LABEL_KEYS[record.status])}
                    </Badge>
                ) : null}
                <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{headline}</span>
                {duration ? <span className="shrink-0 tabular-nums text-2xs text-fg-subtle">{duration}</span> : null}
                <Select
                    size="sm"
                    options={SEVERITY_FILTER_OPTIONS}
                    value={severityFilter}
                    onChange={value => setSeverityFilter(value as SeverityFilter)}
                    ariaLabel={t("test.report.severityFilter")}
                    portalMenu
                />
                <button
                    type="button"
                    className={controlButtonClass()}
                    aria-label={t("test.report.rerun")}
                    disabled={rerunBlocked}
                    onClick={handleRerun}
                >
                    <RefreshCw className={cn("h-4 w-4", running && "animate-spin")} />
                </button>
            </div>

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
                {findings.length === 0 ? (
                    placeholder ? <p className="px-1 py-1 text-xs text-fg-subtle">{placeholder}</p> : null
                ) : (
                    <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
                        {virtualizer.getVirtualItems().map(item => {
                            const finding = findings[item.index];
                            if (!finding) {
                                return null;
                            }
                            return (
                                <div
                                    key={item.key}
                                    className="absolute left-0 top-0 w-full"
                                    style={{ height: item.size, transform: `translateY(${item.start}px)` }}
                                >
                                    <TestFindingRow finding={finding} onJump={handleJump} />
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

/** A finding without a `target` is not a button: it must not offer a click that does nothing. */
function TestFindingRow({
    finding,
    onJump,
}: {
    finding: TestFinding;
    onJump: (finding: TestFinding) => void;
}) {
    const { t } = useTranslation();
    const message = resolveTestText(finding.message, t);
    const body = (
        <>
            <span className={cn("shrink-0 text-2xs", TEST_SEVERITY_TEXT_CLASS[finding.severity])}>
                {t(TEST_SEVERITY_LABEL_KEYS[finding.severity])}
            </span>
            <span className="min-w-0 flex-1 truncate text-xs text-fg-muted">{message}</span>
        </>
    );

    if (!finding.target) {
        return <div className="flex w-full items-baseline gap-2 rounded-md px-2 py-0.5 text-left">{body}</div>;
    }
    return (
        <button
            type="button"
            aria-label={message}
            className="flex w-full cursor-default items-baseline gap-2 rounded-md px-2 py-0.5 text-left hover:bg-fill-subtle"
            onClick={() => onJump(finding)}
        >
            {body}
        </button>
    );
}
