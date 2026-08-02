import type { Translator } from "@shared/i18n";
import type { TranslationKey } from "@shared/i18n";
import {
    TEST_CATEGORY_ORDER,
    TEST_FINDING_SEVERITY_ORDER,
    TEST_TERMINAL_STATUSES,
    type RegisteredTest,
    type TestCategory,
    type TestFinding,
    type TestFindingSeverity,
    type TestPresentation,
    type TestRunRecord,
    type TestRunStatus,
    type TestText,
} from "@/lib/testing/types";

/**
 * Everything both test surfaces (the picker and the report tab) have to agree about, in one place
 * that neither of them imports the other for.
 *
 * The four label tables below are `Record<Union, TranslationKey>` on purpose rather than a
 * `\`test.category.${id}\`` template: widening one of those unions in `lib/testing/types.ts` then
 * fails to compile here, instead of shipping a row whose label renders as a raw dotted key. The
 * picker's category test holds the same line from the other side.
 */

/** One author-visible string, from either producer. See `TestText`: a key for us, a literal for a plugin. */
export function resolveTestText(text: TestText | undefined, t: Translator["t"]): string {
    if (!text) {
        return "";
    }
    return text.key !== undefined ? t(text.key, text.params) : text.text;
}

export const TEST_CATEGORY_LABEL_KEYS: Record<TestCategory, TranslationKey> = {
    integrity: "test.category.integrity",
    runtime: "test.category.runtime",
    compatibility: "test.category.compatibility",
    custom: "test.category.custom",
};

export const TEST_PRESENTATION_LABEL_KEYS: Record<TestPresentation, TranslationKey> = {
    headless: "test.presentation.headless",
    windowed: "test.presentation.windowed",
};

export const TEST_STATUS_LABEL_KEYS: Record<TestRunStatus, TranslationKey> = {
    running: "test.status.running",
    passed: "test.status.passed",
    failed: "test.status.failed",
    skipped: "test.status.skipped",
    cancelled: "test.status.cancelled",
    errored: "test.status.errored",
};

export const TEST_SEVERITY_LABEL_KEYS: Record<TestFindingSeverity, TranslationKey> = {
    error: "test.severity.error",
    warning: "test.severity.warning",
    info: "test.severity.info",
};

/** The toast raised once a run settles. Absent for `running`, which is not something to announce. */
export const TEST_TOAST_KEYS: Record<TerminalTestStatus, TranslationKey> = {
    passed: "test.toast.passed",
    failed: "test.toast.failed",
    skipped: "test.toast.skipped",
    cancelled: "test.toast.cancelled",
    errored: "test.toast.errored",
};

/**
 * How loudly that toast lands.
 *
 * `skipped` and `cancelled` are `info` on purpose: neither is bad news about the game. A test that
 * declined, and a run the author stopped themselves, are not errors to be alarmed about - only
 * `failed` and `errored` are the game (or the test) having gone wrong.
 */
export const TEST_TOAST_TONE: Record<TerminalTestStatus, "success" | "error" | "info"> = {
    passed: "success",
    failed: "error",
    skipped: "info",
    cancelled: "info",
    errored: "error",
};

/** Same three colours the lint report and the blueprint problems list use; severity is never a pill. */
export const TEST_SEVERITY_TEXT_CLASS: Record<TestFindingSeverity, string> = {
    error: "text-danger",
    warning: "text-warning",
    info: "text-fg-muted",
};

/**
 * A status a run has settled in. Exactly the statuses that are not `running`, which is what makes
 * the toast tables below total without a cast at the call site.
 */
export type TerminalTestStatus = Exclude<TestRunStatus, "running">;

export function isTerminalTestStatus(status: TestRunStatus): status is TerminalTestStatus {
    return TEST_TERMINAL_STATUSES.includes(status);
}

export type TestCategoryGroup = {
    category: TestCategory;
    tests: RegisteredTest[];
};

/**
 * The picker's list, in `TEST_CATEGORY_ORDER`.
 *
 * A definition with no `category` lands in `custom`, which is what the type says that group is for.
 * An empty category produces no group at all - a heading over nothing is furniture.
 */
export function groupTestsByCategory(tests: readonly RegisteredTest[]): TestCategoryGroup[] {
    const byCategory = new Map<TestCategory, RegisteredTest[]>();
    for (const test of tests) {
        const category = test.definition.category ?? "custom";
        const bucket = byCategory.get(category);
        if (bucket) {
            bucket.push(test);
        } else {
            byCategory.set(category, [test]);
        }
    }
    return TEST_CATEGORY_ORDER.flatMap(category => {
        const bucket = byCategory.get(category);
        return bucket && bucket.length > 0 ? [{ category, tests: bucket }] : [];
    });
}

/** Error first, info last - the order `TEST_FINDING_SEVERITY_ORDER` states, applied stably. */
export function sortTestFindings(findings: readonly TestFinding[]): TestFinding[] {
    return [...findings].sort(
        (a, b) => TEST_FINDING_SEVERITY_ORDER[a.severity] - TEST_FINDING_SEVERITY_ORDER[b.severity],
    );
}

export type TestFindingCounts = Record<TestFindingSeverity, number>;

/**
 * How long the run took, or "" while it is still going.
 *
 * Seconds below a minute and minutes above it, because a test that took 154 seconds is a test the
 * author reads as "two and a half minutes" - and a bare millisecond count is a number nobody
 * converts in their head.
 */
export function formatTestDuration(record: TestRunRecord, t: Translator["t"]): string {
    if (record.finishedAt === undefined) {
        return "";
    }
    const elapsedMs = Math.max(0, record.finishedAt - record.startedAt);
    const totalSeconds = elapsedMs / 1000;
    if (totalSeconds < 60) {
        return t("test.report.durationSeconds", { seconds: totalSeconds.toFixed(1) });
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = Math.round(totalSeconds - minutes * 60);
    return t("test.report.durationMinutes", { minutes, seconds: String(seconds).padStart(2, "0") });
}
