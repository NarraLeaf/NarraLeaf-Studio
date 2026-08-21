import { useCallback, useMemo, useState } from "react";
import { Monitor, Paperclip, Radio } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { FieldLabel } from "@/lib/components/elements/FieldLabel";
import {
    closeLiveSession,
    joinLiveSession,
    leaveLiveSession,
    openLiveSession,
    overlayIsStale,
} from "@/lib/team";
import type { TeamProjectSurface } from "../../hooks/useTeamProject";

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
 */
export function TeamCollaboration({ team, instance }: {
    team: TeamProjectSurface;
    /**
     * This window's own instance id, so its own row can be told from somebody else's.
     *
     * Absent while the announcement has not landed, which is the first moment after a
     * session opens. Nothing is drawn as "mine" until it has.
     */
    instance?: string;
}) {
    const { t } = useTranslation();
    const [busy, setBusy] = useState(false);
    const project = team.state.kind === "verified" ? team.state.project : null;
    const origin = team.remoteOrigin;

    /** The room this window is in, if it is in one. */
    const mine = useMemo(
        () => team.live.find((session) =>
            session.members.some((member) => member.instance === instance)) ?? null,
        [team.live, instance],
    );
    /** The first room it is not in, which is the one there is an offer to join. */
    const other = useMemo(
        () => team.live.find((session) => session !== mine) ?? null,
        [team.live, mine],
    );

    const run = useCallback((act: () => Promise<unknown>) => {
        setBusy(true);
        void act().finally(() => setBusy(false));
    }, []);

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
                <Row icon={<Radio className="h-3.5 w-3.5 shrink-0 text-fg-subtle" />} seam="live">
                    {mine !== null ? (
                        <>
                            <span className="min-w-0 truncate">
                                {mine.title ?? t("workspace.shell.team.liveUntitled")}
                            </span>
                            <span className="shrink-0 text-2xs text-fg-subtle">
                                {t("workspace.shell.team.liveMembers", { count: String(mine.members.length) })}
                            </span>
                            <Quiet
                                seam="live-leave"
                                busy={busy}
                                onClick={() => run(() => leaveLiveSession(origin, mine.id))}
                                label={t("workspace.shell.team.liveLeave")}
                            />
                            {mine.openedByInstance === instance && (
                                <Quiet
                                    seam="live-end"
                                    busy={busy}
                                    onClick={() => run(() => closeLiveSession(origin, mine.id))}
                                    label={t("workspace.shell.team.liveEnd")}
                                    tone="hover:text-danger"
                                />
                            )}
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
                                busy={busy}
                                onClick={() => run(() => joinLiveSession(origin, other.id))}
                                label={t("workspace.shell.team.liveJoin")}
                            />
                        </>
                    ) : (
                        <Quiet
                            seam="live-open"
                            busy={busy}
                            onClick={() => run(() => openLiveSession(origin, {
                                project: project.id,
                                // The version the server last read, which is what everybody
                                // in the room has in common. Left out where it has not read
                                // one rather than invented.
                                ...(team.head === undefined ? {} : { revision: team.head }),
                            }))}
                            label={t("workspace.shell.team.liveOpen")}
                            first
                        />
                    )}
                </Row>
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
 * A control that reads as text until it is pointed at.
 *
 * The same weight as the action rows below this section, and for the same reason: none of
 * these is pressed daily, and a bordered button beside a count would give it the weight of
 * Send and Get.
 */
function Quiet({ label, onClick, busy, seam, tone, first }: {
    label: string;
    onClick: () => void;
    busy: boolean;
    seam: string;
    tone?: string;
    /** Sits where a value would, rather than at the end of a line of them. */
    first?: boolean;
}) {
    return (
        <button
            type="button"
            data-team-seam={seam}
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
