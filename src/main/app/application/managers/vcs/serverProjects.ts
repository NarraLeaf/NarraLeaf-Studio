/**
 * What a server holds, asked over the API it answers beside the sign-in
 * endpoint.
 *
 * An author is handed an address and a token. The discovery document turns the
 * address into a server; this turns the token into the list of projects on it,
 * into what the server knows about one of them, and into a way to make another.
 * Before it, the only way to reach a project was to be told a repository address
 * by hand — the one thing the address was meant to replace.
 *
 * The connection itself is `serverApi`: same host, same certificate, same token
 * as the sign-in, and one copy of the certificate handling for every question
 * asked here.
 *
 * **Everything below degrades, and every reader honours it.** A server records a
 * project the moment it is created and reads its repository afterwards, so
 * between those two moments there is a project with no history, no readable file
 * and no revisions — and none of those is a project with zero versions. What a
 * server did not say is left out rather than defaulted, all the way to the
 * renderer.
 */
import type {
    VcsServerProject,
    VcsServerProjectDetail,
    VcsServerProjectFile,
    VcsServerProjectHistory,
    VcsServerProjectHistoryPage,
    VcsServerRevision,
} from "@shared/types/vcs";

import {
    STUDIO_API_ROOT,
    asRecord,
    askServer,
    numberField,
    textField,
    type ServerApiProblem,
} from "./serverApi";

/** The one collection the server serves, versioned as the server versions it. */
const PROJECTS_PATH = `${STUDIO_API_ROOT}/projects`;

/**
 * How many revisions one ask brings back.
 *
 * A page rather than the history: this is a panel showing what happened lately, not a
 * log to scroll, and the whole history of a long project is a large answer to hold in a
 * launcher window. The server says whether there are more.
 */
export const PROJECT_HISTORY_PAGE = 20;

/**
 * Why an ask did not produce a list.
 *
 * Coded rather than worded, for the reason the probe's failures are: the
 * sentence an author reads is written in the renderer, in their language, and a
 * string invented here would arrive in English in the middle of it.
 */
export type ServerProjectsProblem = ServerApiProblem;

export type ServerProjectsResult =
    | { ok: true; projects: VcsServerProject[] }
    | { ok: false; problem: ServerProjectsProblem };

export type ServerProjectResult =
    | { ok: true; project: VcsServerProject }
    | { ok: false; problem: ServerProjectsProblem };

export type ServerProjectDetailResult =
    | {
        ok: true;
        detail: VcsServerProjectDetail;
        /**
         * The sentence the server gave for not having read this project.
         *
         * **For a log line, and nothing else.** It goes no further than the manager, which
         * is what keeps it out of the renderer by construction rather than by discipline.
         */
        reason: string;
    }
    | { ok: false; problem: ServerProjectsProblem };

export type ServerProjectHistoryResult =
    | { ok: true; page: VcsServerProjectHistoryPage }
    | { ok: false; problem: ServerProjectsProblem };

/**
 * What the server has read off a project's repository, field by field.
 *
 * **Nothing is filled in.** A server that has not read the repository yet sends this
 * object with nothing in it, which is the ordinary case for a project made a moment ago,
 * and it has to survive the trip as nothing rather than as zeroes.
 */
function readHistory(value: unknown): VcsServerProjectHistory | undefined {
    const record = asRecord(value);
    if (record === null) return undefined;
    return {
        ...numberField(record, "revisions"),
        ...textField(record, "branch"),
        ...numberField(record, "bytes"),
        ...numberField(record, "lastAt"),
        ...textField(record, "lastBy"),
        ...textField(record, "lastMessage"),
    };
}

/** Read one project out of an answer, insisting on the fields everything downstream uses. */
export function readProject(value: unknown): VcsServerProject | null {
    const record = asRecord(value);
    if (record === null) return null;
    const id = record["id"];
    const name = record["name"];
    const remote = record["remote"];
    if (typeof id !== "string" || typeof name !== "string" || typeof remote !== "string") {
        return null;
    }
    const history = readHistory(record["history"]);
    return {
        id,
        name,
        description: typeof record["description"] === "string" ? record["description"] : "",
        ...(typeof record["createdBy"] === "string" ? { createdBy: record["createdBy"] } : {}),
        createdAt: typeof record["createdAt"] === "number" ? record["createdAt"] : 0,
        remote,
        ...(history === undefined ? {} : { history }),
    };
}

/**
 * What the server could read inside the project file, when it could read it.
 *
 * **The server's `reason` is deliberately dropped here.** It is an English sentence
 * written for whoever runs the server and it names the internals it was written about;
 * putting it on screen would put untranslated machine talk in the middle of a Japanese
 * interface, and it says nothing an author can act on. `readable: false` is the whole of
 * what a reader needs, and the renderer has its own sentence for it in every language.
 *
 * Anything but an explicit `readable: true` is unreadable, so a server that answers a
 * shape this does not understand errs towards saying nothing rather than towards showing
 * a scene count it did not give.
 */
function readFile(value: unknown): VcsServerProjectFile {
    const record = asRecord(value);
    if (record === null || record["readable"] !== true) return { readable: false };
    return {
        readable: true,
        ...textField(record, "title"),
        ...numberField(record, "stageWidth"),
        ...numberField(record, "stageHeight"),
        ...numberField(record, "scenes"),
        ...numberField(record, "assets"),
        ...numberField(record, "assetBytes"),
    };
}

/** The sentence a server gave for not having read a project, for the log and nowhere else. */
function unreadableReason(value: unknown): string {
    const record = asRecord(value);
    const reason = record === null ? undefined : record["reason"];
    return typeof reason === "string" ? reason.trim() : "";
}

/**
 * One revision, as the server lists it.
 *
 * The id is the only field insisted on: a revision without one cannot be referred to, and
 * a server that has read a repository always has it. Everything else is a fact the server
 * may not carry, and an absent author is drawn as an absent author.
 */
function readRevision(value: unknown): VcsServerRevision | null {
    const record = asRecord(value);
    if (record === null) return null;
    const id = record["id"];
    if (typeof id !== "string" || id.trim() === "") return null;
    return {
        id,
        ...numberField(record, "at"),
        ...textField(record, "by"),
        ...textField(record, "message"),
    };
}

/** Every project on one server, as that server lists them. */
export async function listServerProjects(options: {
    authUrl: string;
    token: string;
    userDataDir: string;
}): Promise<ServerProjectsResult> {
    const answer = await askServer({ ...options, path: PROJECTS_PATH });
    if (!answer.ok) return answer;

    const list = asRecord(answer.value)?.["projects"];
    if (!Array.isArray(list)) return { ok: false, problem: { kind: "unknown" } };
    const projects = list.map(readProject);
    // All or nothing: a list with a hole in it is a list somebody scrolls
    // past without noticing what is missing.
    if (projects.some((project) => project === null)) {
        return { ok: false, problem: { kind: "unknown" } };
    }
    return { ok: true, projects: projects as VcsServerProject[] };
}

/**
 * What one server knows about one project.
 *
 * The list already carries the name and the remote; this carries the rest, and the rest
 * is mostly what the server read inside the project file. On a server that has not read
 * it — which is every project on a deployment whose reader is not working — the answer is
 * the project row and `readable: false`, and that is a complete answer rather than a
 * failure.
 */
export async function getServerProject(options: {
    authUrl: string;
    token: string;
    userDataDir: string;
    projectId: string;
}): Promise<ServerProjectDetailResult> {
    const { projectId, ...rest } = options;
    const answer = await askServer({
        ...rest,
        path: `${PROJECTS_PATH}/${encodeURIComponent(projectId)}`,
    });
    if (!answer.ok) return answer;

    const record = asRecord(answer.value);
    const project = readProject(record?.["project"]);
    if (project === null) return { ok: false, problem: { kind: "unknown" } };
    return {
        ok: true,
        detail: { project, file: readFile(record?.["file"]) },
        reason: unreadableReason(record?.["file"]),
    };
}

/**
 * The latest revisions on a project, newest first.
 *
 * **An absent `revisions` is not an empty one.** A server that has not read the
 * repository leaves the field out entirely, and a project that genuinely has no versions
 * yet would send an empty list; the two mean different things to a reader and both have
 * to reach one intact. So the field is carried through as absent, never normalised into
 * `[]`, and nothing here invents a count.
 */
export async function listServerProjectHistory(options: {
    authUrl: string;
    token: string;
    userDataDir: string;
    projectId: string;
    limit?: number;
    /** Page backwards from this revision id, as the previous page's last entry. */
    before?: string;
}): Promise<ServerProjectHistoryResult> {
    const { projectId, limit, before, ...rest } = options;
    const query = new URLSearchParams({ limit: String(limit ?? PROJECT_HISTORY_PAGE) });
    if (before !== undefined && before !== "") query.set("before", before);

    const answer = await askServer({
        ...rest,
        path: `${PROJECTS_PATH}/${encodeURIComponent(projectId)}/history?${query.toString()}`,
    });
    if (!answer.ok) return answer;

    const record = asRecord(answer.value);
    if (record === null) return { ok: false, problem: { kind: "unknown" } };
    const more = record["more"] === true;

    const list = record["revisions"];
    if (list === undefined || list === null) return { ok: true, page: { more } };
    if (!Array.isArray(list)) return { ok: false, problem: { kind: "unknown" } };

    const revisions = list.map(readRevision);
    // All or nothing, as with the projects list: a history missing one entry reads as a
    // history, and nobody counts the rows.
    if (revisions.some((revision) => revision === null)) {
        return { ok: false, problem: { kind: "unknown" } };
    }
    return { ok: true, page: { revisions: revisions as VcsServerRevision[], more } };
}

/** Ask a server to make a project, and get back the one it made. */
export async function createServerProject(options: {
    authUrl: string;
    token: string;
    userDataDir: string;
    name: string;
    description?: string;
}): Promise<ServerProjectResult> {
    const { name, description, ...rest } = options;
    const answer = await askServer({
        ...rest,
        path: PROJECTS_PATH,
        method: "POST",
        expect: 201,
        body: JSON.stringify({
            name,
            ...(description === undefined ? {} : { description }),
        }),
    });
    if (!answer.ok) return answer;

    const project = readProject(asRecord(answer.value)?.["project"]);
    return project === null
        ? { ok: false, problem: { kind: "unknown" } }
        : { ok: true, project };
}
