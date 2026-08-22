import { useMemo } from "react";
import { Monitor, Paperclip, Radio } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import { overlayIsStale } from "@/lib/team";
import { refuseLiveSessionEntry } from "@/lib/team/liveSessionEntry";
import { useWorkspaceFreeze } from "../../hooks/useWorkspaceFrozen";
import type { TeamProjectSurface } from "../../hooks/useTeamProject";
import { liveEntryFailureSentence, liveEndSentence, liveOtherMembers, liveStandingKey } from "./liveSessionText";
import { useLiveSession, useLiveSessionStory } from "./useLiveSession";

/**
 * Who is on this project, what room is open on it, and what is attached to it.
 *
 * **Three facts and one act.** The facts are read from the server continuously - they are
 * what makes it a source rather than an address - and they are drawn as values with no
 * labels around them, in one line each. The act is starting a live session, which is the
 * only thing in this panel somebody performs on purpose; everything else here happens
 * because a window is open.
 *
 * **Silent where there is nothing to report.** A project nobody else has open and with
 * nothing attached draws the room row and no others. A strip that says "1 machine, 0
 * attached" every working day is a strip nobody reads.
 *
 * The counts are the server's. Nothing here holds a copy to keep honest: an event says a
 * collection moved and `useTeamProject` reads it again.
 *
 * **The room row drives `Services.Live`, never the server calls underneath it.** Opening a room on
 * the server is one step of entering a session: the tree is checkpointed and pushed first, the
 * workspace freezes behind it, and the story editor's gestures start going to the room. A control
 * that called `live.open` on its own would put a room on the server that this window was not in and
 * that nothing here could leave.
 */
export function TeamCollaboration({ team }: {
    team: TeamProjectSurface;
}) {
    const { t } = useTranslation();
    const project = team.state.kind === "verified" ? team.state.project : null;
    const origin = team.remoteOrigin;
    /** The session this window is in, as the session itself describes it. */
    const live = useLiveSession();
    const story = useLiveSessionStory();
    // Asked of the freeze rather than derived, because the latch is a module-level singleton: a
    // session entered while the workspace is frozen for something else would replace that freeze
    // instead of adding to it. The acts behind these controls ask again for the same reason.
    const freeze = useWorkspaceFreeze();
    const inRoom = live.view.phase !== "idle";
    /** The first room this window is not in, which is the one there is an offer to join. */
    const other = useMemo(
        () => team.live.find(session => session.id !== live.view.session?.id) ?? null,
        [team.live, live.view.session],
    );
    // Only where entering is what the author is being offered: inside a session the answer is
    // always this session's own freeze, which would read as the room refusing to let anyone in.
    const blocked = inRoom ? null : refuseLiveSessionEntry(freeze);
    const failure = live.view.entryFailure === null ? null : liveEntryFailureSentence(live.view.entryFailure);
    const ended = live.view.ended;
    // Null for a session the author left themselves: they pressed the control and watched the row
    // change, and a line confirming it is one more thing to read every time.
    const endedSentence = ended === null ? null : liveEndSentence(ended);
    const members = liveOtherMembers(live.view);
    const standing = liveStandingKey(live.view);
    // A session is about one story document, and a project with none has nothing to open a room on.
    const noStory = story === null;
    const entryTip = blocked !== null
        ? t(blocked.message)
        : noStory ? t("workspace.shell.team.liveNoStory") : undefined;

    if (project === null || origin === null) {
        return null;
    }

    const attached = team.overlay;
    // Counted against the head the server last read, and only where it read one: an
    // absent head is a repository this server has not reached, and treating that as
    // "everything is out of date" would say so for a minute after every restart.
    const outdated = attached === null
        ? 0
        : attached.records.filter((record) => overlayIsStale(record, attached.head)).length;

    return (
        <div data-team-seam="collaboration" className="border-t border-edge pt-3">
            <FieldLabel as="div">{t("workspace.shell.team.presence")}</FieldLabel>

            {team.canSeeClients && (
                <Row icon={<Monitor className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />} seam="clients">
                    <span className="min-w-0 truncate">
                        {team.clients.length > 1
                            ? t("workspace.shell.team.hereMany", { count: String(team.clients.length) })
                            : t("workspace.shell.team.hereAlone")}
                    </span>
                </Row>
            )}

            {team.canLive && (
                <>
                    <Row icon={<Radio className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />} seam="live">
                        {inRoom ? (
                            <>
                                <span className="min-w-0 truncate">
                                    {live.view.session?.title ?? t("workspace.shell.team.liveUntitled")}
                                </span>
                                {standing !== null && (
                                    <span data-team-seam="live-standing" className="shrink-0 text-2xs text-fg-subtle">
                                        {t(standing)}
                                    </span>
                                )}
                                {/* One control, and which one depends on what leaving does. A host
                                    holds the only copy that counts, so its window walking away ends
                                    the room for everybody - offering it "Leave" would name an act
                                    the others would not experience. */}
                                <Quiet
                                    seam={live.view.role === "host" ? "live-end" : "live-leave"}
                                    busy={live.busy || live.view.phase === "leaving"}
                                    onClick={live.leave}
                                    label={t(live.view.role === "host"
                                        ? "workspace.shell.team.liveEnd"
                                        : "workspace.shell.team.liveLeave")}
                                    {...(live.view.role === "host" ? { tone: "hover:text-danger" } : {})}
                                />
                            </>
                        ) : other !== null ? (
                            <>
                                <span className="min-w-0 truncate">
                                    {other.title ?? t("workspace.shell.team.liveUntitled")}
                                </span>
                                <span className="shrink-0 text-2xs text-fg-subtle">
                                    {t("workspace.shell.team.liveMembers", { count: String(other.members.length) })}
                                </span>
                                <Quiet
                                    seam="live-join"
                                    busy={live.busy || blocked !== null || noStory}
                                    {...(entryTip === undefined ? {} : { tip: entryTip })}
                                    onClick={() => {
                                        if (story !== null) {
                                            live.join({ session: other, storyId: story.id });
                                        }
                                    }}
                                    label={t("workspace.shell.team.liveJoin")}
                                />
                            </>
                        ) : (
                            <Quiet
                                seam="live-open"
                                busy={live.busy || blocked !== null || noStory}
                                {...(entryTip === undefined ? {} : { tip: entryTip })}
                                onClick={() => {
                                    if (story !== null) {
                                        // The story's own name, so the room is called what everybody
                                        // in it is looking at. The revision comes from the checkpoint
                                        // the session records on its way in, never from here.
                                        live.open({ storyId: story.id, title: story.name });
                                    }
                                }}
                                label={t("workspace.shell.team.liveOpen")}
                                first
                            />
                        )}
                    </Row>

                    {/* Who else is in it, by account. Silent in a room of one: a line saying nobody
                        else is here is the same fact as the row above it. */}
                    {members.length > 0 && (
                        <Note seam="live-members">{members.join(" · ")}</Note>
                    )}
                    {/* Behind the room rather than following it: what is on screen is the version
                        the room opened on until the host's answer has been applied. */}
                    {live.view.phase === "catching-up" && (
                        <Note seam="live-catching-up">{t("workspace.shell.team.liveCatchingUp")}</Note>
                    )}
                    {blocked !== null && (
                        <Note seam="live-blocked" tone="text-warning">{t(blocked.message)}</Note>
                    )}
                    {blocked === null && noStory && !inRoom && (
                        <Note seam="live-no-story" tone="text-warning">
                            {t("workspace.shell.team.liveNoStory")}
                        </Note>
                    )}
                    {failure !== null && (
                        <Note seam="live-failure" tone="text-warning">
                            {t(failure.key, failure.params)}
                        </Note>
                    )}
                    {/* A session that ended without the author choosing it. `diverged` is the loud
                        one: this machine's copy stopped matching the room's, so it is neither in the
                        room nor holding what the room holds. */}
                    {!inRoom && ended !== null && endedSentence !== null && (
                        <Note
                            seam="live-ended"
                            tone={ended.cause === "diverged" ? "text-danger" : "text-fg-muted"}
                        >
                            {t(endedSentence)}
                        </Note>
                    )}
                </>
            )}

            {team.canOverlay && attached !== null && attached.total > 0 && (
                <Row icon={<Paperclip className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />} seam="attached">
                    <span className="min-w-0 truncate">
                        {t("workspace.shell.team.attached", { count: String(attached.total) })}
                    </span>
                    {outdated > 0 && (
                        <span data-team-seam="attached-outdated" className="shrink-0 text-2xs text-warning">
                            {t("workspace.shell.team.attachedOutdated", { count: String(outdated) })}
                        </span>
                    )}
                </Row>
            )}
        </div>
    );
}

/** One line of values. Spacing between rows and no rules, as every panel here is. */
function Row({ icon, seam, children }: {
    icon: React.ReactNode;
    seam: string;
    children: React.ReactNode;
}) {
    return (
        <div
            data-team-seam={seam}
            className="mt-1 flex min-h-5 items-center gap-1.5 text-sm text-fg-muted"
        >
            {icon}
            {children}
        </div>
    );
}

/**
 * A line under a row, for the one thing that row cannot fit.
 *
 * The shape the address already uses for the project name under it: indented to nothing, a size
 * down, and drawn only where there is something to say.
 */
function Note({ seam, tone, children }: {
    seam: string;
    /** A tailwind text-colour class; the default is the muted one every value here uses. */
    tone?: string;
    children: React.ReactNode;
}) {
    return (
        <p data-team-seam={seam} className={cn("mt-0.5 truncate text-2xs", tone ?? "text-fg-muted")}>
            {children}
        </p>
    );
}

/**
 * A control that reads as text until it is pointed at.
 *
 * The same weight as the action rows below this section, and for the same reason: none of
 * these is pressed daily, and a bordered button beside a count would give it the weight of
 * Send and Get.
 */
function Quiet({ label, onClick, busy, seam, tone, first, tip }: {
    label: string;
    onClick: () => void;
    busy: boolean;
    seam: string;
    tone?: string;
    /** Sits where a value would, rather than at the end of a line of them. */
    first?: boolean;
    /**
     * Why it cannot act, on hover.
     *
     * `data-tip` rather than `title`, like every other tooltip in Studio - and it is resolved by
     * hit-testing the pointer, which is what makes it readable on a control that is disabled and
     * therefore receives no pointer events of its own.
     */
    tip?: string;
}) {
    return (
        <button
            type="button"
            data-team-seam={seam}
            data-tip={tip}
            onClick={onClick}
            disabled={busy}
            className={cn(
                "shrink-0 text-2xs transition-colors cursor-default disabled:opacity-50",
                first ? "" : "ml-auto",
                tone ?? "text-fg-subtle hover:text-fg",
            )}
        >
            {label}
        </button>
    );
}
