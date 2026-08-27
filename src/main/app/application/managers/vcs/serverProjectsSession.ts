/**
 * What a server holds, asked over the session it keeps open rather than over the REST route.
 *
 * The socket answers the same questions `serverProjects` asks over HTTPS, in the same
 * shapes - a project row is a project row whichever transport carried it - so this reuses
 * that module's reader and only swaps how the bytes arrive. Two of those questions are
 * behind the publish flow, which is a main-process act: it lists the server's projects to
 * see whether one it is about to send is already there, and records a new one when it is
 * not. Both now go through the one session the {@link TeamManager} holds for that server,
 * so publishing asks over the same connection every screen does.
 *
 * The session is opened on demand by the client underneath - a stored server with a
 * readable token needs nothing said first - so the only thing a caller supplies is the
 * one function that makes a call. Everything a server can refuse for is carried back in the
 * one vocabulary these screens already have sentences for, by {@link serverProblemFromTeam}.
 */
import { TeamMethod, type TeamCallOutcome } from "@shared/types/team";
import { serverProblemFromTeam, type VcsServerProject } from "@shared/types/vcs";

import { asRecord } from "./serverApi";
import { readProject, type ServerProjectResult, type ServerProjectsResult } from "./serverProjects";

/** How a call over one server's session is made. Supplied so a test needs no socket. */
export type TeamSessionCall = (
    remoteOrigin: string,
    method: string,
    params?: unknown,
) => Promise<TeamCallOutcome>;

/** Every project on one server, as that server lists them over the session. */
export async function listServerProjectsOverSession(
    call: TeamSessionCall,
    remoteOrigin: string,
): Promise<ServerProjectsResult> {
    const answered = await call(remoteOrigin, TeamMethod.projectsList);
    if (!answered.ok) return { ok: false, problem: serverProblemFromTeam(answered.problem) };

    const list = asRecord(answered.value)?.["projects"];
    if (!Array.isArray(list)) return { ok: false, problem: { kind: "unknown" } };
    const projects = list.map(readProject);
    // All or nothing, as the REST list is: a list with a hole in it is a list somebody
    // scrolls past without noticing what is missing.
    if (projects.some((project) => project === null)) {
        return { ok: false, problem: { kind: "unknown" } };
    }
    return { ok: true, projects: projects as VcsServerProject[] };
}

/**
 * Ask a server to record a project over the session, and get back the one it recorded.
 *
 * **The id that comes back is checked against the one that was sent**, exactly as the REST
 * path checks it: a server that answered with a different repository is reported as
 * `wrong-repository` rather than acted on, because pushing at the name it chose would push
 * into a repository nobody made. `clientId` names the write, so a retry after a session
 * dropped between the request and its answer records one project rather than two.
 */
export async function createServerProjectOverSession(
    call: TeamSessionCall,
    remoteOrigin: string,
    input: { name: string; description?: string; repositoryId?: string; clientId?: string },
): Promise<ServerProjectResult> {
    const { name, description, repositoryId, clientId } = input;
    const answered = await call(remoteOrigin, TeamMethod.projectsCreate, {
        name,
        ...(description === undefined ? {} : { description }),
        ...(repositoryId === undefined ? {} : { repositoryId }),
        ...(clientId === undefined ? {} : { clientId }),
    });
    if (!answered.ok) return { ok: false, problem: serverProblemFromTeam(answered.problem) };

    const project = readProject(asRecord(answered.value)?.["project"]);
    if (project === null) return { ok: false, problem: { kind: "unknown" } };
    if (repositoryId !== undefined && project.id.toLowerCase() !== repositoryId.toLowerCase()) {
        return { ok: false, problem: { kind: "wrong-repository" } };
    }
    return { ok: true, project };
}
