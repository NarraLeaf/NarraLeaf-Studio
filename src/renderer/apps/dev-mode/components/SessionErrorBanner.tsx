import { useCallback, useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, ExternalLink, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { getInterface } from "@/lib/app/bridge";
import type { LocatedRuntimeIssue } from "./runtimeIssueModel";

/**
 * Written out per level rather than composed from a variable, because Tailwind reads these as
 * literals — and `border-current/40` is not the shortcut it looks like: `currentColor` cannot carry
 * Tailwind's alpha channel, so the opacity silently does nothing.
 */
const TONE = {
    error: {
        strip: "border-danger/40 bg-danger/15 text-danger",
        text: "text-danger",
        button: "border-danger/50 hover:bg-danger/25",
        ghost: "hover:bg-danger/20",
    },
    warning: {
        strip: "border-warning/40 bg-warning/15 text-warning",
        text: "text-warning",
        button: "border-warning/50 hover:bg-warning/25",
        ghost: "hover:bg-warning/20",
    },
} as const;

type Tone = (typeof TONE)[keyof typeof TONE];

export type SessionErrorBannerProps = {
    /** Launch/compile failure from the main process. Carries no location — there is no session yet. */
    sessionError: string | null;
    onDismissSessionError: () => void;
    /** Located failures reported by the running game, newest first. */
    issues: readonly LocatedRuntimeIssue[];
    onDismissIssue: (id: string) => void;
    onDismissAllIssues: () => void;
    /** Absent when the window has no project behind it; the "open in Studio" action needs one. */
    projectPath: string | null;
};

/**
 * What went wrong, and where in the author's story it went wrong.
 *
 * The banner this replaces printed a stack trace and nothing else, which told an author which of the
 * engine's frames noticed the problem and never which of THEIR lines caused it — so the actual
 * workflow was to give up on Dev Mode and go read the Studio console. The headline here is the
 * location, the message sits under it, and the stack is folded away: it is the least useful part of
 * an authoring error and the only part that was previously visible.
 */
export function SessionErrorBanner(props: SessionErrorBannerProps): ReactNode {
    const { sessionError, onDismissSessionError, issues, onDismissIssue, onDismissAllIssues, projectPath } = props;
    const { t } = useTranslation();

    if (!sessionError && issues.length === 0) {
        return null;
    }

    const errorCount = issues.filter(issue => issue.level === "error").length;
    const warningCount = issues.length - errorCount;
    // One warning-only banner should not be painted in the error colour; anything with a real error
    // in it should. The strip states the worst thing in it, not the newest.
    const severe = errorCount > 0 || Boolean(sessionError);
    const tone = severe ? TONE.error : TONE.warning;

    return (
        <div className={`shrink-0 border-b ${tone.strip}`}>
            <div className="flex items-start gap-2 px-3 py-2">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                    {sessionError ? (
                        <SessionFailureRow message={sessionError} tone={tone} onDismiss={onDismissSessionError} />
                    ) : null}
                    {issues.map(issue => (
                        <IssueRow
                            key={issue.id}
                            issue={issue}
                            tone={issue.level === "error" ? TONE.error : TONE.warning}
                            projectPath={projectPath}
                            onDismiss={() => onDismissIssue(issue.id)}
                        />
                    ))}
                </div>
                {issues.length > 1 ? (
                    <button
                        type="button"
                        className={`shrink-0 rounded-md border px-2 py-0.5 text-2xs ${tone.button}`}
                        onClick={onDismissAllIssues}
                    >
                        {t("devMode.issues.dismissAll", { count: issues.length })}
                    </button>
                ) : null}
            </div>
            {issues.length > 1 ? (
                <div className="px-3 pb-1.5 pl-8 text-2xs opacity-70">
                    {t("devMode.issues.summary", { errors: errorCount, warnings: warningCount })}
                </div>
            ) : null}
        </div>
    );
}

/**
 * A launch failure, which by definition happened before there was a story to point into. Kept in the
 * old shape — a preformatted block — because that is all there is to show.
 */
function SessionFailureRow(props: { message: string; tone: Tone; onDismiss: () => void }): ReactNode {
    const { t } = useTranslation();
    return (
        <div className="flex items-start justify-between gap-2">
            <pre className="max-h-24 flex-1 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-snug">
                {props.message}
            </pre>
            <button
                type="button"
                className={`shrink-0 rounded-md border px-2 py-0.5 text-2xs ${props.tone.button}`}
                onClick={props.onDismiss}
            >
                {t("devMode.dismiss")}
            </button>
        </div>
    );
}

function IssueRow(props: {
    issue: LocatedRuntimeIssue;
    tone: Tone;
    projectPath: string | null;
    onDismiss: () => void;
}): ReactNode {
    const { issue, tone, projectPath, onDismiss } = props;
    const { t } = useTranslation();
    const [stackOpen, setStackOpen] = useState(false);
    const [openFailed, setOpenFailed] = useState(false);
    const location = issue.location;

    const openInStudio = useCallback(async () => {
        if (!projectPath || !location) {
            return;
        }
        setOpenFailed(false);
        const result = await getInterface().devMode.openStoryRowInWorkspace({
            projectPath,
            storyId: location.storyId,
            sceneId: location.sceneId,
            blockId: location.blockId,
        });
        if (!result.success) {
            setOpenFailed(true);
        }
    }, [projectPath, location]);

    return (
        <div className={`flex flex-col gap-0.5 ${tone.text}`}>
            <div className="flex items-baseline justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
                    {location ? (
                        <span className="font-medium">
                            {location.lineNumber > 0
                                ? t("devMode.issues.atLine", {
                                      line: location.lineNumber,
                                      scene: location.sceneName,
                                  })
                                : t("devMode.issues.inScene", { scene: location.sceneName })}
                        </span>
                    ) : (
                        <span className="font-medium opacity-80">{t("devMode.issues.noLocation")}</span>
                    )}
                    {/* A play-head attribution is the row that was RUNNING, which for anything
                        asynchronous is a starting point rather than a verdict. Say which one it is
                        instead of letting a near miss read as a certainty. */}
                    {location && issue.origin === "playHead" ? (
                        <span className="text-2xs opacity-60">{t("devMode.issues.viaPlayHead")}</span>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {location && projectPath ? (
                        <button
                            type="button"
                            className={`flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs ${tone.button}`}
                            onClick={openInStudio}
                            title={t("devMode.issues.openInStudio")}
                        >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            {t("devMode.issues.openInStudio")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className={`rounded-md p-0.5 ${tone.ghost}`}
                        onClick={onDismiss}
                        title={t("devMode.dismiss")}
                        aria-label={t("devMode.dismiss")}
                    >
                        <X className="h-3 w-3" aria-hidden />
                    </button>
                </div>
            </div>
            {/* The row itself, quoted the way the editor writes it — so an author recognises the line
                before reading a word of the message. */}
            {location?.sentence ? (
                <div className="truncate font-mono text-2xs opacity-80" title={location.sentence}>
                    {location.speaker ? `${location.speaker}: ` : ""}
                    {location.sentence}
                </div>
            ) : null}
            <div className="text-2xs leading-snug opacity-90">{issue.message}</div>
            {openFailed ? (
                <div className="text-2xs opacity-70">{t("devMode.issues.openFailed")}</div>
            ) : null}
            {issue.stack ? (
                <div>
                    <button
                        type="button"
                        className="flex items-center gap-0.5 text-2xs opacity-60 hover:opacity-100"
                        onClick={() => setStackOpen(open => !open)}
                    >
                        {stackOpen ? (
                            <ChevronDown className="h-3 w-3" aria-hidden />
                        ) : (
                            <ChevronRight className="h-3 w-3" aria-hidden />
                        )}
                        {t("devMode.issues.stack")}
                    </button>
                    {stackOpen ? (
                        <pre className="mt-0.5 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-2xs leading-snug opacity-70">
                            {issue.stack}
                        </pre>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
