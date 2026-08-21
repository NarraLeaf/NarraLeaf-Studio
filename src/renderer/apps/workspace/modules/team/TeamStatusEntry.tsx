import { useEffect, useState } from "react";
import { Cloud, CloudOff } from "lucide-react";
import { useTranslation } from "@/lib/i18n";
import { serverDisplayName, serverHost } from "@/lib/vcs/servers";
import { StatusEntry } from "../status-bar/StatusEntry";
import { useVersionSurface } from "../../hooks/useVersionSurface";
import { useTeamProject } from "../../hooks/useTeamProject";
import { isVersionSurfaceVisible, serverFace } from "../../components/layout/versionRailModel";
import { TeamPanel } from "./TeamPanel";
import { registerTeamPresenceBridge } from "./teamPresenceController";

/**
 * The Team cell: where this project's versions go, in the corner of the window.
 *
 * **First on the left, so it sits in the bottom-left corner.** It is the one cell here that names
 * something outside this machine, and it is the door to everything about that: which server, which
 * account, connecting, disconnecting. Registration order is what places a cell (see
 * `builtInStatusBarEntries`), and the corner is where a reader looks for "where am I".
 *
 * **Drawn even where there is nothing to report**, which is the one place this strip's usual rule
 * is set aside. Every other cell goes quiet when it has no news; this one is an entry point, and an
 * entry point that appears only once the thing behind it is set up cannot be used to set it up. It
 * stays as quiet as it can instead: an icon alone for a project on no server, a name beside it for
 * one that has a server, and the state word only on hover - where things stand is what the version
 * rail's own line is for.
 *
 * It says nothing at all only where the feature does not exist for this project - no backend on
 * this host, or a project version control was never turned on for. There is no destination to
 * manage then, and the rail is where turning it on lives.
 */
export function TeamStatusEntry() {
    const { t } = useTranslation();
    // Its own reader rather than the rail's: this cell is not in the rail's tree, and the surface
    // re-reads the address and the session on `serverChanged`, so the two cannot drift apart. Both
    // reads are local and neither scans - see useVersionSurface.
    const surface = useVersionSurface();
    const [open, setOpen] = useState(false);

    // Registered while the cell is drawn and not a moment longer, so the rail's "Connect" button
    // and the palette entry cannot open a dialog for a project that has no repository to point
    // anywhere.
    const drawn = isVersionSurfaceVisible(surface.state) && surface.state.kind !== "not-a-repository";

    /**
     * **The one place the server stops being an address on disk and becomes a source.**
     *
     * Opened here rather than in the panel, because this cell is drawn for as long as the project
     * is: a session, its subscriptions and this window's presence on that project all belong to
     * the window's lifetime, not to a dialog somebody happens to have open. That is what makes the
     * check automatic - nobody presses anything - and it is what lets the cell say that a server
     * has stopped holding this project before Send is refused.
     *
     * Nulls where the cell is not drawn, so a project with no repository opens nothing.
     */
    const team = useTeamProject(drawn ? surface.remote : null, drawn ? surface.repositoryId : null);
    useEffect(() => {
        if (!drawn) {
            return;
        }
        return registerTeamPresenceBridge({ open: () => setOpen(true) });
    }, [drawn]);

    if (!drawn) {
        return null;
    }

    const { remote, serverSession } = surface;
    const name = remote === null
        ? null
        : serverSession ? serverDisplayName(serverSession) : serverHost(remote);
    const face = serverFace(surface.syncState);
    // What the server itself answered wins over what the last local check left behind: the
    // sentence a reader needs is the one about the thing that is actually wrong, and "that server
    // does not hold this project" outranks anything a sync state can say about a branch.
    const verdict = team.state.kind === "not-there"
        ? t("workspace.shell.team.notThere")
        : team.state.kind === "unreachable"
            ? t("workspace.shell.team.unreachable")
            : t(face.detail);
    const tooltip = remote === null
        ? t("workspace.shell.versionControl.server.none")
        : `${name} - ${verdict}`;
    /**
     * The one state the cell raises its voice for: something is standing between this project and
     * its server, and nothing else on screen says so.
     *
     * **Only the two answers a person acts on**, never "up to date" - a green cell in the corner
     * all working day is a colour that has stopped meaning anything. A missing account is here for
     * the same reason as the refusals: Send and Get are refused until one is added, and the rail
     * draws both buttons regardless.
     */
    const wrong = remote !== null
        && (serverSession === null
            || team.state.kind === "not-there"
            || team.state.kind === "unreachable"
            || face.tone === "text-danger"
            || face.tone === "text-warning");

    return (
        <>
            <StatusEntry
                onClick={() => setOpen(true)}
                tone={wrong ? "text-warning" : undefined}
                tooltip={tooltip}
                ariaLabel={t("workspace.shell.team.title")}
                dataAttributes={{ "data-team-cell": remote === null ? "none" : "connected" }}
            >
                {remote === null ? <CloudOff className="h-3 w-3" /> : <Cloud className="h-3 w-3" />}
                {name !== null && <span className="max-w-[18ch] truncate">{name}</span>}
            </StatusEntry>
            <TeamPanel surface={surface} team={team} isOpen={open} onClose={() => setOpen(false)} />
        </>
    );
}
