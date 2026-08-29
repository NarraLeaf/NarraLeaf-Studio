import { useEffect, useState } from "react";
import { Share2 } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { cn } from "@/lib/utils/cn";
import { LiveMemberAvatars } from "./LiveMemberAvatars";
import { LiveSessionDialog } from "./LiveSessionDialog";
import { registerLiveSessionBridge } from "./liveSessionController";
import { livePresenceRefusal, liveStandingKey } from "./liveSessionText";
import { useTeamProjectSurface } from "./TeamProjectContext";
import { useJoinableRoom, useLiveSession } from "./useLiveSession";

/**
 * Who is collaborating on this project, in the title bar.
 *
 * **Left of the window's control cluster**, which is where an application puts the people who are
 * in a document with you. It is the only always-visible statement that a live session is running:
 * a session outlives every tab and lasts a working afternoon, and until this existed the one
 * persistent trace of it was a tinted strip wearing a history clock.
 *
 * **Drawn for every project pointed at a Team server, including the ones that cannot open a room.**
 * A control that appears only once everything is in place cannot be used to find out what is
 * missing, so a server that is not answering, has no account on this machine, does not hold this
 * project or does not offer rooms leaves the control inert with that answer on hover. Nothing at
 * all is drawn for a project on no server: there is no collaboration to describe, and the way to
 * point it at one is the Team cell in the status bar.
 *
 * **It owns no session of its own.** The reads here are the same two the Team cell makes - the
 * version surface for the address, `useTeamProject` for what the server says - and they are cheap:
 * both are local, and `useTeamProject` is driven by the server's own topics rather than a poll.
 */
export function LiveSessionPresence() {
    const { t } = useTranslation();
    const [open, setOpen] = useState(false);
    const team = useTeamProjectSurface();
    const live = useLiveSession();
    const room = useJoinableRoom(team, live.view);
    // A project on no server has no collaboration to describe, and the way to point it at one is
    // the Team cell rather than a control that would have nothing behind it.
    const drawn = team.state.kind !== "none";

    // Registered while the control is drawn and not a moment longer, so the collaboration panel and
    // the frozen strip cannot open a dialog for a project that has no server to hold a session.
    useEffect(() => {
        if (!drawn) {
            return;
        }
        return registerLiveSessionBridge({ open: () => setOpen(true) });
    }, [drawn]);

    if (!drawn) {
        return null;
    }

    const refusal = livePresenceRefusal(team.state, team.canLive);
    const inRoom = live.view.phase !== "idle";
    /*
     * Whether anybody is waiting to be let in.
     *
     * Host only by construction - a guest's session never carries requests - so this is the one
     * state where the control has something for its author to do rather than something to report.
     */
    const waiting = live.view.requests.length > 0;
    const standing = liveStandingKey(live.view);
    /*
     * The faces, and only where this is the surface carrying them.
     *
     * **Inside a session they belong to the frozen strip instead.** The strip is the session's own
     * column, it is drawn for the whole of one, and it has a height to spend where the title bar has
     * only a width - which on a small screen is the scarcest row in the window. So this control
     * keeps the stack for exactly the case the strip cannot cover: a room this window has been
     * offered and is not in, where there is no strip at all.
     */
    const offered = inRoom ? null : room;

    /*
     * What the control says on hover, in one sentence.
     *
     * The refusal wins where there is one, because it is the only sentence with something to do
     * about it. Otherwise the room being pointed at is named, and a project with neither says so
     * rather than going silent: a control with no tooltip reads as a control nobody finished.
     */
    const tip = refusal !== null
        ? t(refusal)
        : waiting
            // What is waiting wins over what is running: it is the only one of the two with
            // something for the author to do.
            ? t("workspace.shell.team.liveWaitingToJoin", { count: live.view.requests.length })
            : inRoom && standing !== null
                ? `${live.view.session?.title ?? t("workspace.shell.team.liveUntitled")} - ${t(standing)}`
                : room !== null
                    ? t("workspace.shell.team.liveRoomOpen", { name: room.openedBy })
                    : t("workspace.shell.team.liveNobody");

    return (
        <>
            <button
                type="button"
                data-live-presence={inRoom ? live.view.role ?? "entering" : room !== null ? "offered" : "idle"}
                onClick={() => setOpen(true)}
                disabled={refusal !== null}
                data-tip={tip}
                aria-label={t("workspace.shell.team.livePresence")}
                className={cn(
                    // The height of the control cluster's buttons, so the title bar stays one row of
                    // one size; the width follows the faces rather than being square. `mr-2` because
                    // this is a group of its own rather than a fourth window control - the cluster's
                    // own buttons sit a `gap-1` apart, and one step more is what reads as a seam.
                    "mr-2 flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors cursor-default",
                    "disabled:opacity-50",
                    inRoom
                        ? "bg-primary/15 text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg",
                )}
            >
                {/* The faces lead and the glyph anchors the right-hand end, so the control's own
                    edge stays where it is however many people arrive. */}
                {offered !== null && offered.members.length > 0 && (
                    <LiveMemberAvatars members={offered.members} host={offered.openedBy} />
                )}
                <span className="relative flex shrink-0">
                    <Share2 className="h-4 w-4 shrink-0" />
                    {/* Somebody is waiting to be let in. A dot rather than a count: what it has to
                        carry is "there is something here for you", and the panel behind it is one
                        press away with the names and the two answers. Drawn on the glyph rather
                        than beside it so the control keeps its width whatever happens. */}
                    {waiting && (
                        <span
                            data-live-requests="waiting"
                            aria-hidden
                            className={cn(
                                "absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full",
                                "bg-primary ring-2 ring-bg",
                            )}
                        />
                    )}
                </span>
            </button>
            <LiveSessionDialog team={team} isOpen={open} onClose={() => setOpen(false)} />
        </>
    );
}
