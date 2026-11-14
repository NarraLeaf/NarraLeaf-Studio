import { useCallback, useEffect, useRef, useState } from "react";

import { getInterface } from "@/lib/app/bridge";
import { serverDisplayName, serverHost } from "@/lib/vcs/servers";
import type { VcsLocalRepository, VcsServerSession } from "@shared/types/vcs";
import { normalizeProjectPath } from "@shared/utils/recentProject";

/**
 * What the launcher knows about a remembered project's server.
 *
 * A project is a team project when its repository names a server, read off `.lore/config.toml`
 * without opening anything (`vcs.listLocalRepositories`). Whether this machine is still connected
 * to that server is whether it holds a sign-in for it (`vcs.listServers`): signing out in Settings
 * takes the record away, and from then on the project has nothing to work with.
 */
export interface TeamProjectFacts {
    /** The server's origin, the key every sign-in is held under. */
    remoteOrigin: string;
    /** What to call the server: its own name where a sign-in recorded one, its host otherwise. */
    server: string;
    /** Whether this machine holds a sign-in for that server. */
    connected: boolean;
}

/** Every remembered team project, keyed by project identity. */
export type TeamProjectMap = ReadonlyMap<string, TeamProjectFacts>;

/** Put the two local reads together. Pure, so the rule is testable without a bridge. */
export function teamProjectsFrom(
    repositories: readonly VcsLocalRepository[],
    servers: readonly VcsServerSession[],
): TeamProjectMap {
    const byOrigin = new Map(servers.map(session => [session.remoteOrigin, session] as const));
    const map = new Map<string, TeamProjectFacts>();
    for (const repository of repositories) {
        if (!repository.remoteOrigin) continue;
        const session = byOrigin.get(repository.remoteOrigin);
        map.set(normalizeProjectPath(repository.path), {
            remoteOrigin: repository.remoteOrigin,
            server: session ? serverDisplayName(session) : serverHost(repository.remoteOrigin),
            connected: session !== undefined,
        });
    }
    return map;
}

/** Read both lists afresh. Two local reads: no socket opens and no repository is locked. */
export async function readTeamProjects(): Promise<TeamProjectMap> {
    const bridge = getInterface();
    const [local, servers] = await Promise.all([
        bridge.vcs.listLocalRepositories().catch(() => null),
        bridge.vcs.listServers().catch(() => null),
    ]);
    return teamProjectsFrom(
        local?.success ? local.data.repositories : [],
        servers?.success ? servers.data.servers : [],
    );
}

/**
 * The launcher's view of which remembered projects are team projects, kept current.
 *
 * Read on mount, whenever the recent list changes, and whenever the window comes back to the
 * front - signing out happens in the Settings window, which tells nobody, and focus is the moment
 * the author is about to look at this list again. Opening a project reads afresh as well (see
 * `ProjectsTab`), so a stale mark can never let a disconnected project through.
 */
export function useTeamProjects(recentKey: string): { teamProjects: TeamProjectMap; reload: () => Promise<TeamProjectMap> } {
    const [teamProjects, setTeamProjects] = useState<TeamProjectMap>(new Map());
    const latest = useRef(0);

    const reload = useCallback(async () => {
        const ticket = latest.current + 1;
        latest.current = ticket;
        const read = await readTeamProjects();
        if (ticket === latest.current) setTeamProjects(read);
        return read;
    }, []);

    useEffect(() => {
        void reload();
    }, [reload, recentKey]);

    useEffect(() => {
        const onFocus = () => void reload();
        window.addEventListener("focus", onFocus);
        return () => window.removeEventListener("focus", onFocus);
    }, [reload]);

    return { teamProjects, reload };
}
