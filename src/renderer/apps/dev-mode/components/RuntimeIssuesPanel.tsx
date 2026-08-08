import { useCallback, useState, type ReactNode } from "react";
import { ChevronDown, ChevronRight, ExternalLink, X } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { ToolbarButton } from "@/lib/components/elements/ToolbarButton";
import { getInterface } from "@/lib/app/bridge";
import { DevModePanelModeToggle, type DevModePanelChrome } from "./DevModePanelChrome";
import { countRuntimeIssues, type LocatedRuntimeIssue } from "./runtimeIssueModel";
import { RUNTIME_ISSUE_TONE, type RuntimeIssueTone } from "./runtimeIssueTone";

export type RuntimeIssuesPanelProps = {
    /** Launch/compile failure from the main process. Carries no location — there is no session yet. */
    sessionError: string | null;
    onDismissSessionError: () => void;
    /** Located failures reported by the running game, newest first. */
    issues: readonly LocatedRuntimeIssue[];
    onDismissIssue: (id: string) => void;
    onDismissAllIssues: () => void;
    /** Absent when the window has no project behind it; the "open in Studio" action needs one. */
    projectPath: string | null;
    className?: string;
    /** Dock/float mode toggle + title-bar drag, owned by DevModeContent. */
    chrome?: DevModePanelChrome;
};

/**
 * What went wrong, and where in the author's story it went wrong.
 *
 * This is a drawer panel rather than a strip across the top of the window, and that IS the design:
 * the previous banner grew a paragraph per failure downward from the title bar, so a scene that
 * reported a handful of them left no stage to debug. Docked, the drawer takes width from the stage
 * and the stage re-fits (nothing is cropped); floating, it can be dragged off whatever it covers.
 * Either way the list scrolls inside its own box and the game keeps its pixels.
 *
 * The headline of each entry is the LOCATION — the banner this descends from printed a stack trace
 * and nothing else, which told an author which of the engine's frames noticed the problem and never
 * which of THEIR lines caused it. The message sits under it and the stack is folded away.
 */
export function RuntimeIssuesPanel(props: RuntimeIssuesPanelProps): ReactNode {
    const {
        sessionError,
        onDismissSessionError,
        issues,
        onDismissIssue,
        onDismissAllIssues,
        projectPath,
        className,
        chrome,
    } = props;
    const { t } = useTranslation();

    const { errors, warnings } = countRuntimeIssues(issues);
    const empty = !sessionError && issues.length === 0;

    // One press clears what the panel is showing, session failure included: two separate "dismiss
    // everything" controls for one visible list is a distinction only the data model cares about.
    const dismissEverything = useCallback(() => {
        onDismissAllIssues();
        onDismissSessionError();
    }, [onDismissAllIssues, onDismissSessionError]);

    return (
        <div
            className={cn(
                "flex h-full min-h-0 shrink-0 flex-col bg-surface-sunken text-2xs text-fg-muted",
                // See StoryRuntimeDebugPanel: the left hairline is the seam against the stage, and a
                // floating panel already has a frame of its own.
                !chrome?.floating && "border-l border-edge",
                className,
            )}
        >
            {/* Also the drag handle while floating (see StoryRuntimeDebugPanel). */}
            <div
                className={cn(
                    "flex shrink-0 items-center justify-between gap-2 border-b border-edge px-2 py-1.5",
                    chrome?.floating && "cursor-grab select-none active:cursor-grabbing",
                )}
                onPointerDown={chrome?.onTitleBarPointerDown}
            >
                <div className="flex min-w-0 items-baseline gap-2">
                    <span className="text-xs font-medium text-fg">{t("devMode.issues.title")}</span>
                    {issues.length > 0 ? (
                        <span className="truncate">{t("devMode.issues.summary", { errors, warnings })}</span>
                    ) : null}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    {empty ? null : (
                        <ToolbarButton
                            size="xs"
                            aria-label={t("devMode.issues.dismissAll", { count: issues.length })}
                            title={t("devMode.issues.dismissAll", { count: issues.length })}
                            onClick={dismissEverything}
                        >
                            <X className="h-3.5 w-3.5" aria-hidden />
                        </ToolbarButton>
                    )}
                    <DevModePanelModeToggle chrome={chrome} />
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-auto p-2">
                {empty ? (
                    <p className="text-2xs text-fg-subtle">{t("devMode.issues.empty")}</p>
                ) : (
                    <div className="flex flex-col gap-2">
                        {sessionError ? (
                            <SessionFailureEntry message={sessionError} onDismiss={onDismissSessionError} />
                        ) : null}
                        {issues.map(issue => (
                            <RuntimeIssueEntry
                                key={issue.id}
                                issue={issue}
                                tone={issue.level === "error" ? RUNTIME_ISSUE_TONE.error : RUNTIME_ISSUE_TONE.warning}
                                projectPath={projectPath}
                                onDismiss={() => onDismissIssue(issue.id)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

/** The frame every entry shares: a hairline under it, none under the last. */
function entryClass(tone: RuntimeIssueTone): string {
    return cn("flex flex-col gap-0.5 border-b border-edge-subtle pb-2 last:border-0 last:pb-0", tone.text);
}

/**
 * A launch failure, which by definition happened before there was a story to point into. Kept in the
 * old shape — a preformatted block — because that is all there is to show. It wraps rather than
 * scrolling on its own: the panel around it already scrolls, and a scroll region inside a scroll
 * region is how the second half of a compile error stays unread.
 */
function SessionFailureEntry(props: { message: string; onDismiss: () => void }): ReactNode {
    const { t } = useTranslation();
    const tone = RUNTIME_ISSUE_TONE.error;
    return (
        <div className={entryClass(tone)}>
            <div className="flex items-baseline justify-between gap-2">
                <span className="font-medium">{t("devMode.issues.sessionFailure")}</span>
                <button
                    type="button"
                    className={cn("shrink-0 rounded-md p-0.5", tone.ghost)}
                    onClick={props.onDismiss}
                    title={t("devMode.dismiss")}
                    aria-label={t("devMode.dismiss")}
                >
                    <X className="h-3 w-3" aria-hidden />
                </button>
            </div>
            <pre className="whitespace-pre-wrap break-words font-mono text-2xs leading-snug opacity-90">
                {props.message}
            </pre>
        </div>
    );
}

function RuntimeIssueEntry(props: {
    issue: LocatedRuntimeIssue;
    tone: RuntimeIssueTone;
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
        <div className={entryClass(tone)}>
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
                            className={cn(
                                "flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-2xs",
                                tone.button,
                            )}
                            onClick={openInStudio}
                            title={t("devMode.issues.openInStudio")}
                        >
                            <ExternalLink className="h-3 w-3" aria-hidden />
                            {t("devMode.issues.openInStudio")}
                        </button>
                    ) : null}
                    <button
                        type="button"
                        className={cn("rounded-md p-0.5", tone.ghost)}
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
            {openFailed ? <div className="text-2xs opacity-70">{t("devMode.issues.openFailed")}</div> : null}
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
                        <pre className="mt-0.5 whitespace-pre-wrap break-words font-mono text-2xs leading-snug opacity-70">
                            {issue.stack}
                        </pre>
                    ) : null}
                </div>
            ) : null}
        </div>
    );
}
