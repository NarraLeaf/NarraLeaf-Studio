import { useMemo } from "react";
import { Loader2, RotateCcw } from "lucide-react";
import type { DocumentDiffEntry } from "@shared/documents/diff";
import type { Translator } from "@shared/i18n";
import { cn } from "@/lib/utils/cn";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { DocumentChangeList } from "@/lib/vcs/DocumentChangeList";
import { buildDocumentChangeRows, CHANGE_KIND_GLYPH, CHANGE_KIND_TINT } from "@/lib/vcs/documentChangeView";
import { useDocumentDiff, type DocumentDiffRequest } from "@/lib/vcs/useDocumentDiff";
import { shortRevision, splitChangePath } from "../../components/layout/versionRailModel";
import { VcsResolvePanel } from "./VcsResolvePanel";
import type { VcsChangesPayload } from "./vcsChangesIds";

/**
 * The same `DocumentChange` list the version rail expands, at editor width.
 *
 * It exists because the rail cannot be the only home for this. A 320px column can show eight rows
 * of one file's changes and nothing more, and conflict resolution - the same list with a side to
 * take per row - has nowhere to live in a column that narrow. So this is
 * a tab rather than a modal: a comparison is a document, and the workspace already opens documents
 * in tabs, which is also what lets the author keep one open beside the editors they are about to
 * change.
 *
 * **The comparison half is read-only by construction, therefore never gated on the freeze.** Nothing
 * below can write project data even in principle, and a frozen workspace - which is what a revision
 * preview IS - is exactly the state an author is in when they want to know what changed. The rule is
 * `freezeGuard`'s third bullet: navigation, selection and inspection are never touched. The resolve
 * mode is the exception and consults the guard itself, because taking a side rewrites files; see
 * `VcsResolvePanel`, which is a separate component so that the two cannot share a hook.
 *
 * **Never re-reads on its own.** The working-tree comparison scans, and a scan records newly
 * discovered directories into staged state (docs §4.17), so the only re-read is the button in the
 * header. A revision pair is immutable and cached in the main process, so it has no button at all.
 */

/**
 * Rows this tab will draw before it stops adding documents.
 *
 * The list is not virtualised, and this is what makes that safe rather than lucky: a comparison may
 * carry up to `DIFF_PATH_LIMIT` (2000) documents of up to `DOCUMENT_DIFF_CHANGE_LIMIT` (200) changes
 * each, which is a first commit or a bulk import rather than an edit. Past this the honest answer is
 * a count of what was left out - and a restore is not something anyone reads change by change.
 */
const TAB_ROW_BUDGET = 1000;

/** Most rows any ONE document may spend of that budget, so the first file cannot take all of it. */
const DOCUMENT_ROW_CEILING = 200;

export function VcsChangesTab({ payload }: { payload?: VcsChangesPayload }) {
    // A tab restored from a persisted layout can arrive without one; the working tree is the answer
    // that is always meaningful, where a revision pair invented here would name versions at random.
    const mode: VcsChangesPayload = payload ?? { mode: "working-tree" };
    // Dispatched here rather than branched inside one body, because the two halves must not share
    // hooks: a comparison SCANS (docs §4.17), and a resolve view that mounted the comparison hook
    // would run that scan every time an author opened the merge - for a list it never draws.
    return mode.mode === "resolve" ? <VcsResolvePanel /> : <DocumentComparison mode={mode} />;
}

function DocumentComparison({ mode }: { mode: Exclude<VcsChangesPayload, { mode: "resolve" }> }) {
    const { t } = useTranslation();
    const request = useMemo<DocumentDiffRequest>(
        () => (mode.mode === "between" ? { mode: "between", from: mode.from, to: mode.to } : { mode: "working-tree" }),
        [mode.mode, mode.mode === "between" ? mode.from : null, mode.mode === "between" ? mode.to : null],
    );
    const diff = useDocumentDiff(request, { enabled: true });
    const result = diff.result;

    /**
     * How many rows each document may draw, and how many documents did not fit.
     *
     * Allotted in list order rather than by size, so the budget cannot reorder the comparison: the
     * documents that survive are the first ones the main process listed, which is the order the
     * author's own tree is in.
     */
    const plan = useMemo(() => {
        const entries: { entry: DocumentDiffEntry; limit: number }[] = [];
        let budget = TAB_ROW_BUDGET;
        let omitted = 0;
        for (const entry of result?.documents ?? []) {
            if (budget <= 0) {
                omitted += 1;
                continue;
            }
            const limit = Math.min(budget, DOCUMENT_ROW_CEILING);
            // Built once here only to charge the budget honestly - a document with two changes must
            // not cost the same as one with two hundred. The list rebuilds it from the same inputs.
            const rows = buildDocumentChangeRows(entry.diff, limit).rows.length;
            budget -= Math.max(1, rows);
            entries.push({ entry, limit });
        }
        return { entries, omitted };
    }, [result]);

    const heading = comparisonHeading(mode, result?.head, t);

    return (
        <div className="flex h-full min-h-0 flex-col bg-surface" data-help-topic="versionChanges">
            <div className="group/help flex shrink-0 items-center gap-2 border-b border-edge px-3 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-fg-subtle">{heading}</span>
                {/* Only the working tree can have moved. A revision pair is immutable and answered
                    from the main process's cache, so a button here would be a control that cannot
                    change what it is beside. */}
                {mode.mode === "working-tree" && (
                    <button
                        type="button"
                        onClick={diff.reload}
                        disabled={diff.loading}
                        title={t("documentDiff.tab.refresh")}
                        aria-label={t("documentDiff.tab.refresh")}
                        className="flex h-6 w-6 items-center justify-center rounded-md text-fg-subtle transition-colors cursor-default hover:bg-fill hover:text-fg disabled:opacity-50"
                    >
                        {diff.loading
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RotateCcw className="h-3.5 w-3.5" />}
                    </button>
                )}
                <HelpTrigger topic="versionChanges" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
                {diff.loading && result === null && (
                    <p className="flex items-center gap-2 text-xs text-fg-subtle">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        {t("documentDiff.rows.loading")}
                    </p>
                )}

                {diff.error && <p className="text-xs text-danger">{diff.error}</p>}

                {/* Null with no error is the one answer that is about the INSTALLATION rather than
                    about this project: version control ships no backend for some hosts, and that is
                    a fact rather than a failure. */}
                {!diff.loading && !diff.error && result === null && (
                    <p className="text-xs text-fg-subtle">{t("documentDiff.tab.unavailable")}</p>
                )}

                {result && result.readFailure && (
                    // Said out loud and above everything, because the empty list underneath it means
                    // the opposite of what an empty list usually means (docs §4.29).
                    <p className="mb-2 text-xs text-danger">
                        {t("documentDiff.tab.readFailure", { error: result.readFailure })}
                    </p>
                )}

                {result && !result.complete && (
                    <p className="mb-2 text-2xs text-warning">
                        {t("documentDiff.tab.incomplete", {
                            shown: String(result.documents.length),
                            total: String(result.pathCount),
                        })}
                    </p>
                )}

                {result && result.documents.length === 0 && !result.readFailure && (
                    <p className="text-xs text-fg-subtle">
                        {mode.mode === "working-tree"
                            ? t("documentDiff.tab.emptyWorkingTree")
                            : t("documentDiff.tab.empty")}
                    </p>
                )}

                {plan.entries.map(({ entry, limit }) => (
                    <DocumentSection key={entry.path} entry={entry} limit={limit} />
                ))}

                {plan.omitted > 0 && (
                    <p className="pt-2 text-2xs text-fg-subtle">
                        {t("documentDiff.tab.documentsOmitted", { count: String(plan.omitted) })}
                    </p>
                )}
            </div>
        </div>
    );
}

/**
 * One document: what happened to the file, then what changed inside it.
 *
 * The path is split the way the rail splits it - the file name is what identifies a document in this
 * project and the directory is what merely locates it - so the two surfaces name the same file the
 * same way. Here there is room for both, so neither is truncated away.
 */
function DocumentSection({ entry, limit }: { entry: DocumentDiffEntry; limit: number }) {
    const { directory, name } = splitChangePath(entry.path);

    return (
        <section className="border-b border-edge py-2 last:border-b-0">
            <div className="flex items-baseline gap-1.5 overflow-hidden">
                <span
                    aria-hidden
                    className={cn("w-2 shrink-0 text-center font-mono text-2xs", CHANGE_KIND_TINT[entry.kind])}
                >
                    {CHANGE_KIND_GLYPH[entry.kind]}
                </span>
                <span className="min-w-0 truncate text-xs font-medium text-fg">{name}</span>
                {directory !== null && (
                    <span className="min-w-0 shrink truncate text-2xs text-fg-subtle">{directory}</span>
                )}
            </div>
            <div className="mt-1 pl-3.5">
                <DocumentChangeList
                    diff={entry.diff}
                    limit={limit}
                    wholeDocument={entry.kind === "added" || entry.kind === "removed"}
                />
            </div>
        </section>
    );
}

/** What the header says this tab is comparing. Both sides are always named, or the tab is a mystery. */
function comparisonHeading(
    payload: Exclude<VcsChangesPayload, { mode: "resolve" }>,
    head: string | undefined,
    t: Translator["t"],
): string {
    switch (payload.mode) {
        case "working-tree":
            return head
                ? t("documentDiff.tab.comparingWorkingTree", { version: shortRevision(head) })
                // A repository with no revisions: there is no version to have changed since, and
                // saying so beats naming one that does not exist.
                : t("documentDiff.tab.comparingWorkingTreeUnknown");
        case "between":
            return t("documentDiff.tab.comparingRevisions", {
                from: payload.fromLabel ?? shortRevision(payload.from),
                to: payload.toLabel ?? shortRevision(payload.to),
            });
    }
}
