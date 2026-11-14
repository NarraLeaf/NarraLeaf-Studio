import { useEffect, useState } from "react";
import { LiveSessionDialog } from "./LiveSessionDialog";
import { registerLiveSessionBridge } from "./liveSessionController";
import { useTeamProjectSurface } from "./TeamProjectContext";

/**
 * Where the live session dialog is mounted, with nothing drawn of its own.
 *
 * The title bar used to carry a collaboration control that both drew the room's faces and owned
 * this dialog. The control is gone; the dialog stays reachable from the places that still open it
 * (the frozen strip during a session, and the collaboration panel) through the same bridge.
 *
 * Registered only for a project pointed at a Team server, so those entry points cannot open a
 * dialog for a project that has no server to hold a session.
 */
export function LiveSessionDialogHost() {
    const [open, setOpen] = useState(false);
    const team = useTeamProjectSurface();
    const drawn = team.state.kind !== "none";

    useEffect(() => {
        if (!drawn) {
            return;
        }
        return registerLiveSessionBridge({ open: () => setOpen(true) });
    }, [drawn]);

    if (!drawn) {
        return null;
    }
    return <LiveSessionDialog team={team} isOpen={open} onClose={() => setOpen(false)} />;
}
