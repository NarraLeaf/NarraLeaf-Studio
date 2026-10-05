import { useSyncExternalStore } from "react";
import type { LintReport, LintReportEntry, LintRuleId } from "@/lib/lint";

/**
 * The project checks' findings, by story row - what the scene editor marks its rows with.
 *
 * The Problems panel lists every finding; this is the same report seen from the other side, so an
 * author reading a scene sees which of its rows something is wrong with without opening the panel,
 * the way a code editor underlines a line. One store per window, filled from the report the panel
 * shows and keyed by row, so each row subscribes to its own findings and a new report re-renders only
 * the rows whose findings actually changed - a scene can be thousands of rows, and the report is
 * replaced after every pause in editing.
 *
 * Some findings are deliberately not marked on rows:
 *
 *  - **`story/invalid-command`**: a row the compiler refuses is already drawn as one, with the reason
 *    under it.
 *  - **Translation and voice findings**: they say a row has no translation or recording yet, which in
 *    a project being translated is true of nearly every row. A mark on all of them would be a column
 *    of marks that means nothing on the rows that need one; the translation table and the voice table
 *    are where that work is tracked.
 */

const UNMARKED_RULES: ReadonlySet<LintRuleId> = new Set<LintRuleId>(["story/invalid-command"]);
const UNMARKED_CATEGORIES: ReadonlySet<string> = new Set(["localization", "voice"]);

const EMPTY: readonly LintReportEntry[] = Object.freeze([]);

/** Whether a finding belongs on its row in the scene editor. */
export function isRowMarked(entry: LintReportEntry): boolean {
    if (entry.location.kind !== "story" || !entry.location.blockId) {
        return false;
    }
    if (UNMARKED_RULES.has(entry.ruleId)) {
        return false;
    }
    return !UNMARKED_CATEGORIES.has(entry.ruleId.split("/")[0]);
}

/** A row's findings, compared by what a reader would see: which rule said what. */
function signature(entries: readonly LintReportEntry[]): string {
    return entries
        .map(entry => `${entry.severity}|${entry.ruleId}|${entry.messageKey}|${JSON.stringify(entry.messageParams ?? null)}`)
        .join("\n");
}

/**
 * Group a report's row findings by row, keeping the previous array for every row whose findings did
 * not change - which is what lets a row's subscription see "unchanged" and skip its render.
 */
export function indexRowProblems(
    report: LintReport | null,
    previous: ReadonlyMap<string, readonly LintReportEntry[]>,
): Map<string, readonly LintReportEntry[]> {
    const grouped = new Map<string, LintReportEntry[]>();
    for (const entry of report?.entries ?? []) {
        if (!isRowMarked(entry) || entry.location.kind !== "story" || !entry.location.blockId) {
            continue;
        }
        const list = grouped.get(entry.location.blockId);
        if (list) {
            list.push(entry);
        } else {
            grouped.set(entry.location.blockId, [entry]);
        }
    }
    const next = new Map<string, readonly LintReportEntry[]>();
    for (const [blockId, entries] of grouped) {
        const kept = previous.get(blockId);
        next.set(blockId, kept && signature(kept) === signature(entries) ? kept : entries);
    }
    return next;
}

let byRow: ReadonlyMap<string, readonly LintReportEntry[]> = new Map();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Replace the store's contents from a new report. Called by the window's lint host. */
export function publishRowProblems(report: LintReport | null): void {
    byRow = indexRowProblems(report, byRow);
    for (const listener of [...listeners]) {
        listener();
    }
}

/** A row's findings; the same array until they change. */
export function useRowProblems(blockId: string): readonly LintReportEntry[] {
    return useSyncExternalStore(subscribe, () => byRow.get(blockId) ?? EMPTY, () => EMPTY);
}

/**
 * How the row mark opens the Problems panel. Set by the window's lint host, which holds the
 * workspace; a row has no business reaching for services.
 */
let problemsOpener: (() => void) | null = null;

export function setProblemsPanelOpener(open: (() => void) | null): void {
    problemsOpener = open;
}

export function openProblemsPanel(): void {
    problemsOpener?.();
}
