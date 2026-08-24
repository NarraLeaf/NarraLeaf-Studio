import { useEffect, useState } from "react";
import { Radio } from "lucide-react";
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
    // The room whose faces are on the control: the one this window is in, or the one it is being
    // offered. A window in a session never shows somebody else's room - it can only be in one.
    const shown = inRoom ? live.view.session : room;
    const standing = liveStandingKey(live.view);

    /*
     * What the control says on hover, in one sentence.
     *
     * The refusal wins where there is one, because it is the only sentence with something to do
     * about it. Otherwise the room being pointed at is named, and a project with neither says so
     * rather than going silent: a control with no tooltip reads as a control nobody finished.
     */
    const tip = refusal !== null
        ? t(refusal)
        : inRoom && standing !== null
            ? `${shown?.title ?? t("workspace.shell.team.liveUntitled")} - ${t(standing)}`
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
                    // one size; the width follows the faces rather than being square.
                    "flex h-8 items-center gap-1.5 rounded-md px-2 transition-colors cursor-default",
                    "disabled:opacity-50",
                    inRoom
                        ? "bg-primary/15 text-fg"
                        : "text-fg-muted hover:bg-fill hover:text-fg",
                )}
            >
                <Radio className="h-4 w-4 shrink-0" />
                {shown !== null && shown.members.length > 0 && (
                    <LiveMemberAvatars members={shown.members} host={shown.openedBy} />
                )}
            </button>
            <LiveSessionDialog team={team} isOpen={open} onClose={() => setOpen(false)} />
        </>
    );
}
