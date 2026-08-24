import { createContext, useContext } from "react";
import { useTeamProject, type TeamProjectSurface } from "../../hooks/useTeamProject";
import { isVersionSurfaceVisible } from "../../components/layout/versionRailModel";
import type { VersionSurface } from "../../hooks/useVersionSurface";

/**
 * This project's server as a live source, opened once for the whole window.
 *
 * **One session, one presence, one set of subscriptions.** `useTeamProject` is not a read: it
 * announces this window on the project, subscribes to four of the server's topics, and withdraws
 * the presence when it unmounts. Calling it from two surfaces would announce twice and, worse,
 * withdraw once - the first of the two to unmount would take this window off everybody else's
 * screen while the other was still drawing it.
 *
 * So it is opened here, above both surfaces that need it: the Team cell in the status bar, which
 * says where this project's versions go, and the collaboration control in the title bar, which says
 * who is in it. Both were otherwise going to hold their own.
 *
 * Nulls where there is nothing to follow - a project with no repository, or one on no server - so
 * that no session is opened for a window that has no project on a server to be present on.
 */

const NOTHING: TeamProjectSurface = {
    state: { kind: "none" },
    remoteOrigin: null,
    clients: [],
    live: [],
    overlay: null,
    canLive: false,
    canOverlay: false,
    canSeeClients: false,
    refresh: () => undefined,
};

const TeamProjectContext = createContext<TeamProjectSurface>(NOTHING);

export function TeamProjectProvider({ surface, children }: {
    /** The workspace's own version surface, which is where the address and the repository id are. */
    surface: VersionSurface;
    children: React.ReactNode;
}) {
    const followed = isVersionSurfaceVisible(surface.state) && surface.state.kind !== "not-a-repository";
    const team = useTeamProject(
        followed ? surface.remote : null,
        followed ? surface.repositoryId : null,
    );
    return <TeamProjectContext.Provider value={team}>{children}</TeamProjectContext.Provider>;
}

/** What the server says about this project. `none` outside the provider. */
export function useTeamProjectSurface(): TeamProjectSurface {
    return useContext(TeamProjectContext);
}
