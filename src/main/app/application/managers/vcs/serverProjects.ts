/**
 * What a server holds, asked over the API it answers beside the sign-in
 * endpoint.
 *
 * An author is handed an address and a token. The discovery document turns the
 * address into a server; this turns the token into the list of projects on it,
 * and into a way to make another. Before it, the only way to reach a project
 * was to be told a repository address by hand — the one thing the address was
 * meant to replace.
 *
 * It is the same host, port and certificate the sign-in uses, so a machine that
 * can sign in can ask this. **The authority the author accepted is passed in
 * explicitly**, and that is not belt and braces: node reads the system
 * certificate store once per process and memoises it, so a certificate
 * installed after this process started is invisible to it until Studio is
 * restarted. Handing the PEM over is what makes trusting a server take effect
 * at the moment it is trusted.
 */
import https from "https";
import tls from "tls";

import type { VcsServerProject } from "@shared/types/vcs";

import { authorityDirectory } from "./authorityTrust";
import { parseServerAddress, type ServerEndpoint } from "./serverDiscovery";

import fs from "fs";
import path from "path";

/** The one collection the server serves, versioned as the server versions it. */
const PROJECTS_PATH = "/api/studio/v1/projects";

/** A bound on the whole exchange, for the reason `serverDiscovery` sets one. */
const TIMEOUT_MS = 15_000;

/** More than any list of projects, and small enough that a page cannot be mistaken for one. */
const MAX_BODY_LENGTH = 2 * 1024 * 1024;

/** What an attempt came back with, before it is read as anything. */
interface Answer {
    status: number;
    body: string;
}

/**
 * Why an ask did not produce a list.
 *
 * Coded rather than worded, for the reason the probe's failures are: the
 * sentence an author reads is written in the renderer, in their language, and a
 * string invented here would arrive in English in the middle of it.
 */
export type ServerProjectsProblem =
    /** This installation has no token for that server, or cannot unseal the one it has. */
    | { kind: "no-token" }
    /** The server refused the token: expired, revoked, or an account that was disabled. */
    | { kind: "refused" }
    /** Reached, and it said no for a reason of its own. */
    | { kind: "rejected"; detail: string }
    /** Not reached at all. */
    | { kind: "unreachable" }
    /** Reached, and what came back was not the shape this understands. */
    | { kind: "unknown" };

export type ServerProjectsResult =
    | { ok: true; projects: VcsServerProject[] }
    | { ok: false; problem: ServerProjectsProblem };

export type ServerProjectResult =
    | { ok: true; project: VcsServerProject }
    | { ok: false; problem: ServerProjectsProblem };

/**
 * Every authority this machine believes, plus the ones the author accepted here.
 *
 * The stored copies are the half that matters on the day somebody trusts a
 * server: node's view of the system store is fixed when this process first asks
 * for it, so a certificate installed a moment ago is not in it. The file
 * `authorityTrust` wrote is.
 */
function trustedCertificates(userDataDir: string): string[] | undefined {
    const collected: string[] = [];
    if (typeof tls.getCACertificates === "function") {
        try {
            collected.push(...tls.getCACertificates("default"), ...tls.getCACertificates("system"));
        } catch {
            // Left out rather than fatal: what is below may be enough on its own.
        }
    }
    try {
        const directory = authorityDirectory(userDataDir);
        for (const entry of fs.readdirSync(directory)) {
            if (!entry.endsWith(".crt")) continue;
            collected.push(fs.readFileSync(path.join(directory, entry), "utf-8"));
        }
    } catch {
        // No directory means nothing was ever accepted here, which is ordinary.
    }
    return collected.length === 0 ? undefined : collected;
}

/** Ask once, and let the failure through as it is. */
function request(
    endpoint: ServerEndpoint,
    options: { method: "GET" | "POST"; token: string; userDataDir: string; body?: string },
): Promise<Answer> {
    const payload = options.body === undefined ? undefined : Buffer.from(options.body, "utf-8");
    const settings: https.RequestOptions & tls.ConnectionOptions = {
        host: endpoint.host,
        port: endpoint.port,
        path: PROJECTS_PATH,
        method: options.method,
        headers: {
            accept: "application/json",
            authorization: `Bearer ${options.token}`,
            ...(payload === undefined
                ? {}
                : { "content-type": "application/json", "content-length": payload.length }),
        },
        rejectUnauthorized: true,
        ca: trustedCertificates(options.userDataDir),
        ALPNProtocols: ["http/1.1"],
        // An IP address is not a valid SNI name; the same reasoning as the probe.
        servername: /^[\d.]+$/.test(endpoint.host) || endpoint.host.includes(":")
            ? undefined
            : endpoint.host,
        agent: false,
    };

    return new Promise<Answer>((resolve, reject) => {
        let deadline: NodeJS.Timeout | undefined;
        const answer = (value: Answer): void => { clearTimeout(deadline); resolve(value); };
        const failed = (error: Error): void => { clearTimeout(deadline); reject(error); };

        const call = https.request(settings, (response) => {
            const status = response.statusCode ?? 0;
            let body = "";
            response.setEncoding("utf-8");
            response.on("data", (chunk: string) => {
                body += chunk;
                if (body.length < MAX_BODY_LENGTH) return;
                response.destroy();
                answer({ status, body });
            });
            response.on("end", () => answer({ status, body }));
            response.on("error", failed);
        });
        deadline = setTimeout(() => {
            call.destroy(Object.assign(new Error(`${endpoint.host}:${endpoint.port} did not answer`), {
                code: "ETIMEDOUT",
            }));
        }, TIMEOUT_MS);
        call.on("error", failed);
        if (payload !== undefined) call.write(payload);
        call.end();
    });
}

/** The sentence a server put in its refusal, if it put one there. */
function detailOf(body: string): string {
    try {
        const parsed: unknown = JSON.parse(body);
        if (typeof parsed === "object" && parsed !== null && "error" in parsed) {
            const message = (parsed as { error: unknown }).error;
            if (typeof message === "string" && message.trim() !== "") return message.trim();
        }
    } catch {
        // Not JSON, so there is nothing in it to quote.
    }
    return "";
}

/** Read one project out of an answer, insisting on the fields everything downstream uses. */
function readProject(value: unknown): VcsServerProject | null {
    if (typeof value !== "object" || value === null) return null;
    const record = value as Record<string, unknown>;
    const id = record["id"];
    const name = record["name"];
    const remote = record["remote"];
    if (typeof id !== "string" || typeof name !== "string" || typeof remote !== "string") {
        return null;
    }
    return {
        id,
        name,
        description: typeof record["description"] === "string" ? record["description"] : "",
        ...(typeof record["createdBy"] === "string" ? { createdBy: record["createdBy"] } : {}),
        createdAt: typeof record["createdAt"] === "number" ? record["createdAt"] : 0,
        remote,
    };
}

/** Turn a status that is not a success into the problem it stands for. */
function problemFor(answer: Answer): ServerProjectsProblem {
    if (answer.status === 401 || answer.status === 403) return { kind: "refused" };
    const detail = detailOf(answer.body);
    return detail === "" ? { kind: "unknown" } : { kind: "rejected", detail };
}

/** Every project on one server, as that server lists them. */
export async function listServerProjects(options: {
    authUrl: string;
    token: string;
    userDataDir: string;
}): Promise<ServerProjectsResult> {
    const endpoint = endpointOf(options.authUrl);
    if (endpoint === null) return { ok: false, problem: { kind: "unknown" } };

    let answer: Answer;
    try {
        answer = await request(endpoint, {
            method: "GET",
            token: options.token,
            userDataDir: options.userDataDir,
        });
    } catch {
        return { ok: false, problem: { kind: "unreachable" } };
    }
    if (answer.status !== 200) return { ok: false, problem: problemFor(answer) };

    try {
        const parsed: unknown = JSON.parse(answer.body);
        const list = (parsed as { projects?: unknown }).projects;
        if (!Array.isArray(list)) return { ok: false, problem: { kind: "unknown" } };
        const projects = list.map(readProject);
        // All or nothing: a list with a hole in it is a list somebody scrolls
        // past without noticing what is missing.
        if (projects.some((project) => project === null)) {
            return { ok: false, problem: { kind: "unknown" } };
        }
        return { ok: true, projects: projects as VcsServerProject[] };
    } catch {
        return { ok: false, problem: { kind: "unknown" } };
    }
}

/** Ask a server to make a project, and get back the one it made. */
export async function createServerProject(options: {
    authUrl: string;
    token: string;
    userDataDir: string;
    name: string;
    description?: string;
}): Promise<ServerProjectResult> {
    const endpoint = endpointOf(options.authUrl);
    if (endpoint === null) return { ok: false, problem: { kind: "unknown" } };

    let answer: Answer;
    try {
        answer = await request(endpoint, {
            method: "POST",
            token: options.token,
            userDataDir: options.userDataDir,
            body: JSON.stringify({
                name: options.name,
                ...(options.description === undefined ? {} : { description: options.description }),
            }),
        });
    } catch {
        return { ok: false, problem: { kind: "unreachable" } };
    }
    if (answer.status !== 201) return { ok: false, problem: problemFor(answer) };

    try {
        const parsed: unknown = JSON.parse(answer.body);
        const project = readProject((parsed as { project?: unknown }).project);
        return project === null
            ? { ok: false, problem: { kind: "unknown" } }
            : { ok: true, project };
    } catch {
        return { ok: false, problem: { kind: "unknown" } };
    }
}

/**
 * The endpoint behind a stored `authUrl`.
 *
 * Sessions keep `https://host:port`, and `parseServerAddress` takes the
 * `nlteam://` form an author was given; the two describe one machine, so the
 * scheme is swapped rather than a second parser written.
 */
function endpointOf(authUrl: string): ServerEndpoint | null {
    return parseServerAddress(authUrl.replace(/^https:/, "nlteam:"));
}
