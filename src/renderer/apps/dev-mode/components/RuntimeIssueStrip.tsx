import { type ReactNode } from "react";
import { AlertTriangle, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { countRuntimeIssues, type LocatedRuntimeIssue } from "./runtimeIssueModel";
import { RUNTIME_ISSUE_TONE } from "./runtimeIssueTone";

export type RuntimeIssueStripProps = {
    /**
     * Launch/compile failure from the main process, or null once it has been acknowledged here.
     * Carries no location — there is no session yet.
     */
    sessionError: string | null;
    /**
     * Located failures the author has not acknowledged yet, newest first. NOT the whole list — the
     * Issues panel holds that, and this is only what has still to be announced.
     */
    issues: readonly LocatedRuntimeIssue[];
    /**
     * Take the strip down.
     *
     * An acknowledgement, NOT a delete: everything on it stays in the Issues panel, where it can be
     * read and cleared deliberately. Getting a notice out of the way and throwing the report away
     * are different intentions, and the ✕ on a one-line strip can only credibly mean the first.
     */
    onDismiss: () => void;
    /**
     * Opens the Issues panel, which is where the failures are actually read. Null while the window
     * has no running session to hang a drawer off — and the strip then carries the session failure
     * in full, because a launch error with nowhere to open is the one message an author cannot be
     * left without.
     */
    onOpenIssues: (() => void) | null;
};

/**
 * That something went wrong, in one line that never becomes two.
 *
 * This used to be the whole report: a paragraph per failure, stacked, growing down over the stage
 * until a scene with a handful of them left nothing of the game to look at. The report now lives in
 * the Issues panel (`RuntimeIssuesPanel`); what stays up here is the notice and the way in. It shows
 * the newest failure because that is the one being caused right now, truncates it because the panel
 * is one click away, and states the tally because "one thing broke" and "eleven things broke" are
 * different situations.
 */
export function RuntimeIssueStrip(props: RuntimeIssueStripProps): ReactNode {
    const { sessionError, issues, onDismiss, onOpenIssues } = props;
    const { t } = useTranslation();

    if (!sessionError && issues.length === 0) {
        return null;
    }

    const { errors, warnings } = countRuntimeIssues(issues);
    // One warning-only strip should not be painted in the error colour; anything with a real error
    // in it should. The strip states the worst thing in it, not the newest.
    const severe = errors > 0 || Boolean(sessionError);
    const tone = severe ? RUNTIME_ISSUE_TONE.error : RUNTIME_ISSUE_TONE.warning;

    // With no drawer to open, the session failure is shown whole rather than cropped to a line
    // nobody can expand. It is one message and it is capped, so it cannot do what the old banner did.
    const inlineFailure = !onOpenIssues && Boolean(sessionError);

    const newest = issues[0];
    let headline = "";
    if (newest) {
        const location = newest.location;
        // No place, no place column. An issue that has no row is normal here - a refused load, a
        // boot failure - and prefixing it with a phrase about not finding one reads as part of the
        // message and turns the line into a sentence that says two things at once.
        const where = location
            ? location.lineNumber > 0
                ? t("devMode.issues.atLine", { line: location.lineNumber, scene: location.sceneName })
                : t("devMode.issues.inScene", { scene: location.sceneName })
            : newest.surface
              // A Game UI failure has a place too, and it is the one that identifies it: several
              // surfaces can fail with the same sentence, and only the surface name tells them apart.
              ? t("devMode.issues.onSurface", { surface: newest.surface.surfaceName })
              : null;
        headline = where ? `${where} · ${newest.message}` : newest.message;
    } else if (sessionError) {
        headline = sessionError.split("\n").find(line => line.trim().length > 0)?.trim() ?? sessionError;
    }

    return (
        <div
            className={cn(
                "flex shrink-0 gap-2 border-b px-3 py-1.5",
                tone.strip,
                inlineFailure ? "items-start" : "items-center",
            )}
        >
            <AlertTriangle className={cn("h-3.5 w-3.5 shrink-0", inlineFailure && "mt-0.5")} aria-hidden />
            {inlineFailure ? (
                <pre className="max-h-24 min-w-0 flex-1 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-snug">
                    {sessionError}
                </pre>
            ) : onOpenIssues ? (
                <button
                    type="button"
                    className="min-w-0 flex-1 cursor-default truncate text-left text-2xs leading-snug"
                    onClick={onOpenIssues}
                >
                    {headline}
                </button>
            ) : (
                <span className="min-w-0 flex-1 truncate text-2xs leading-snug">{headline}</span>
            )}
            {issues.length > 1 ? (
                <span className="shrink-0 text-2xs opacity-70">
                    {t("devMode.issues.summary", { errors, warnings })}
                </span>
            ) : null}
            <button
                type="button"
                className={cn("shrink-0 rounded-md p-0.5", tone.ghost, inlineFailure && "mt-0.5")}
                onClick={onDismiss}
                title={t("devMode.dismiss")}
                aria-label={t("devMode.dismiss")}
            >
                <X className="h-3 w-3" aria-hidden />
            </button>
        </div>
    );
}
