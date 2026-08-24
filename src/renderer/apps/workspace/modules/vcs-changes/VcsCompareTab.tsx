import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import type { Translator } from "@shared/i18n";
import { HelpTrigger } from "@/lib/help";
import { useTranslation } from "@/lib/i18n";
import { EmptyState } from "@/lib/components/elements";
import { splitDocumentPath } from "@/lib/vcs/changeIndex";
import { SplitComparisonView } from "@/lib/vcs/compare/SplitComparisonView";
import { useDocumentDiff, type DocumentDiffRequest } from "@/lib/vcs/useDocumentDiff";
import { revisionLabel } from "../../components/layout/versionRailModel";
import type { VcsComparePayload } from "./vcsCompareIds";

/**
 * One document at two versions, in a tab of its own.
 *
 * The comparison tab answers "what changed in this project" and sends anything that needs room here.
 * What this adds over the detail column is not more space for the same rows: it is two versions
 * side by side, so the question an author actually has - what the page, the scene, the graph looks
 * like now against what it looked like then - is answered by the document rather than by a list of
 * field names.
 *
 * **The comparison is re-read, never carried.** A payload holds what a tab is a view OF, and a
 * comparison is not that - it is an answer, and one that a commit or an edit invalidates while this
 * tab is open. Carrying it would put a picture of the project as it was when the button was pressed
 * behind a tab that outlives it.
 *
 * **Nothing here freezes the workspace.** The two halves read bytes at each version directly, the
 * way every presenter in the comparison does. Showing a revision through the freeze would reload
 * every other tab in the window into the past, for a question about one file.
 */
export function VcsCompareTab({ payload }: { payload?: VcsComparePayload }) {
    const { t } = useTranslation();

    const request = useMemo<DocumentDiffRequest>(
        () => (payload?.comparison.mode === "between"
            ? { mode: "between", from: payload.comparison.from, to: payload.comparison.to }
            : { mode: "working-tree" }),
        [payload?.comparison],
    );
    const diff = useDocumentDiff(request, { enabled: payload !== undefined });
    const entry = diff.result?.documents.find(document => document.path === payload?.path) ?? null;

    if (!payload) {
        // A tab of this kind cannot be opened without one, and a restored session that lost it has
        // no document to name - which is a different thing from a document that is not there.
        return <EmptyState size="sm" className="h-full" description={t("documentDiff.split.gone")} />;
    }

    if (!entry) {
        return (
            <div className="flex h-full min-h-0 items-center justify-center bg-surface">
                {diff.loading
                    ? (
                        <p className="flex items-center gap-2 text-xs text-fg-subtle">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            {t("documentDiff.rows.loading")}
                        </p>
                    )
                    : <EmptyState size="sm" description={diff.error ?? t("documentDiff.split.gone")} />}
            </div>
        );
    }

    const { directory, name } = splitDocumentPath(payload.path);
    const versions = compareVersionLabels(payload, t);

    return (
        <div className="h-full" data-help-topic="versionChanges">
            <SplitComparisonView
                entry={entry}
                name={payload.name || name}
                directory={directory}
                baseLabel={versions.base}
                headLabel={versions.head}
                actions={<HelpTrigger topic="versionChanges" />}
            />
        </div>
    );
}

/**
 * What each half calls the version it is showing.
 *
 * By NUMBER, through `revisionLabel`, which is what a version is called on the rail, in the status
 * cell and in the switcher menu. A working tree has no number to be given, so it is named for what
 * it is; and a comparison whose older side has no number yet - a repository with nothing recorded -
 * falls back to the word the canvases already use for the older column rather than to a hash.
 */
export function compareVersionLabels(
    payload: VcsComparePayload,
    t: Translator["t"],
): { base: string; head: string } {
    if (payload.comparison.mode === "between") {
        return {
            base: revisionLabel(payload.comparison.fromNumber),
            head: revisionLabel(payload.comparison.toNumber),
        };
    }
    return {
        base: payload.comparison.headNumber !== undefined
            ? revisionLabel(payload.comparison.headNumber)
            : t("documentDiff.canvas.before"),
        head: t("documentDiff.split.thisProject"),
    };
}
