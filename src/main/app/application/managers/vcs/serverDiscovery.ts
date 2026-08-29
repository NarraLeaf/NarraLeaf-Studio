import https from "https";
import tls from "tls";
import { TEAM_PROTOCOL_VERSION } from "@shared/types/team";
import type { VcsServerDiscovery, VcsServerPolicy, VcsServerProbe } from "@shared/types/vcs";
import {
    describeAuthority,
    isTrustFailure,
    reachThroughTrustStores,
    writeAuthorityCertificate,
} from "./authorityTrust";

/**
 * Asking one address what is behind it.
 *
 * **An author is given an address and nothing else.** `nlteam://host:port` is what the
 * operator writes in a chat message, and everything Studio needs after that - whether a
 * token is wanted, where to present one, which data remote the projects live on - is read
 * off the server itself. Before this, all three were things somebody was told and asked to
 * retype, which is to say three chances to be told a wrong one.
 *
 * The answer is one of four kinds because four different things happen next, and only one
 * of them is a question for the author. What makes the difference worth the code is that
 * they are indistinguishable from the outside: a port nothing listens on, a web server that
 * is not this, and a Team server this machine has not trusted yet all fail a plain fetch,
 * and telling an author "it did not work" leaves them guessing which.
 *
 * Two things about the connection are decided here rather than inherited:
 *
 *  - **ALPN `http/1.1`, explicitly.** The endpoint speaks gRPC over h2 on the same
 *    listener and the same certificate; the document is the one thing served over
 *    HTTP/1.1. Negotiating h2 by default would reach the gRPC side and get nothing a
 *    fetch understands.
 *  - **The platform's trust store, and what the author accepted here.** Node builds chains
 *    against its own bundled roots and says so in the error text ("try running Node.js
 *    with --use-system-ca"). The authority an author installs through the trust prompt
 *    goes into the operating system's store, which is what the Lore client checks - so a
 *    probe reading only node's roots would answer `untrusted` forever. Reading the
 *    platform's store is not enough on its own either: node memoises it on first use, so
 *    an authority installed a minute ago is not in this process's copy of it. The list
 *    comes from `authorityTrust`, which adds the certificates an author has accepted here
 *    - and only those, so an authority somebody was shown and refused is trusted by
 *    nothing.
 */

/** The scheme an author is given. Anything else is refused before a socket is opened. */
const SERVER_SCHEME = "nlteam:";

/** Where the endpoint listens when the address does not say. */
const DEFAULT_PORT = 41402;

/** The path the document is served at, and the only path this speaks to. */
const DISCOVERY_PATH = "/.well-known/nlteam";

/** How long to wait for an answer. Long enough for a slow LAN, short enough to be a wait. */
const TIMEOUT_MS = 5_000;

/**
 * As much body as is read before the connection is dropped.
 *
 * The document is a few hundred characters. The cap is not a limit on servers, it is what
 * stops something that is not one - a media stream, a file listing - from being read into
 * memory because it answered on the right path.
 */
const MAX_BODY_LENGTH = 64 * 1024;

/** An address taken apart, once it is one. */
export interface ServerEndpoint {
    host: string;
    port: number;
    /** The address as it will be stored: lower case, with the port written out. */
    address: string;
    /** The same endpoint as the connection sees it, which is what `diagnoseEndpoint` takes. */
    origin: string;
}

/**
 * Take an address apart, or answer null because it is not one.
 *
 * Host and port and nothing else: a path, a query or a user name in an address means the
 * author has pasted something that is not the address they were given - a browser URL, most
 * likely - and quietly ignoring the extra would connect somewhere they did not name.
 */
export function parseServerAddress(address: string): ServerEndpoint | null {
    let parsed: URL;
    try {
        parsed = new URL(address.trim());
    } catch {
        return null;
    }
    if (parsed.protocol !== SERVER_SCHEME) return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== "" && parsed.pathname !== "/") return null;

    // A non-special scheme keeps the case it was typed in, and the same server typed two
    // ways has to come out as one stored address.
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) return null;
    const port = parsed.port ? Number(parsed.port) : DEFAULT_PORT;

    return {
        // Brackets belong to the address, not to the host: `tls.connect` wants the address
        // itself, and passing `[::1]` resolves to nothing.
        host: hostname.startsWith("[") ? hostname.slice(1, -1) : hostname,
        port,
        address: `${SERVER_SCHEME}//${hostname}:${port}`,
        origin: `https://${hostname}:${port}`,
    };
}

/**
 * The address to ask again at, for a server that was added before.
 *
 * A session records where its tokens are presented (`https://host:port`) and never the
 * `nlteam://` address that was typed, because that address answered once and its answers
 * are what got stored. The endpoint is the same machine and the same listener - the
 * document is served over HTTP/1.1 on the port the tokens go to - so the address can be
 * written back out rather than kept a second time.
 */
export function serverAddressForAuthUrl(authUrl: string): string | null {
    let parsed: URL;
    try {
        parsed = new URL(authUrl.trim());
    } catch {
        return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    if (!hostname) return null;
    return `${SERVER_SCHEME}//${hostname}:${parsed.port || DEFAULT_PORT}`;
}

/** What one attempt at the document came back with. */
interface Answer {
    status: number;
    body: string;
}

/**
 * Fetch the document once, and let the failure through as it is.
 *
 * Failure is the interesting half here and must not be flattened: the code on the error is
 * the whole of what separates a machine that is not there from one whose certificate is not
 * trusted, and both arrive as a rejected request.
 *
 * `trust` names the authorities to build a chain against, or is null to build none and
 * accept whatever is presented - which is what the untrusted answer needs in order to
 * describe the server whose certificate is the question.
 */
function fetchDiscovery(
    endpoint: ServerEndpoint,
    trust: { ca: string[] | undefined } | null,
): Promise<Answer> {
    // Typed as both halves because it is both: `ALPNProtocols` belongs to the connection
    // underneath and is handed down to it, and `https.RequestOptions` describes only the
    // request on top.
    const options: https.RequestOptions & tls.ConnectionOptions = {
        host: endpoint.host,
        port: endpoint.port,
        path: DISCOVERY_PATH,
        method: "GET",
        headers: { accept: "application/json" },
        rejectUnauthorized: trust !== null,
        ca: trust?.ca,
        ALPNProtocols: ["http/1.1"],
        // An IP address is not a valid SNI name, and passing one makes node warn. It is
        // also what the certificate is then checked against, and an address without a
        // matching IP entry fails that check - which is a certificate answer, correctly.
        servername: /^[\d.]+$/.test(endpoint.host) || endpoint.host.includes(":")
            ? undefined
            : endpoint.host,
        // No agent, so nothing is kept alive afterwards: this is one question asked once,
        // and a pooled socket to a server the author may not add is a socket for nothing.
        agent: false,
    };

    return new Promise<Answer>((resolve, reject) => {
        let deadline: NodeJS.Timeout | undefined;
        const answer = (value: Answer): void => { clearTimeout(deadline); resolve(value); };
        const failed = (error: Error): void => { clearTimeout(deadline); reject(error); };

        const call = https.request(options, (response) => {
            const status = response.statusCode ?? 0;
            let body = "";
            response.setEncoding("utf-8");
            response.on("data", (chunk: string) => {
                body += chunk;
                if (body.length < MAX_BODY_LENGTH) return;
                // Answered with, rather than failed on: whatever this is, it is not the
                // document, and the truncated body says so as clearly as the whole one would.
                // Dropping the socket and waiting for `end` would wait for an end that a
                // destroyed response never reaches.
                response.destroy();
                answer({ status, body });
            });
            response.on("end", () => answer({ status, body }));
            response.on("error", failed);
        });
        // A deadline over the whole exchange, rather than `request.setTimeout`. That one is
        // an inactivity timer which the handshake restarts, so it waits twice the number it
        // is given - measured, ten seconds for a five second timeout against a port that
        // accepts and then says nothing. What is wanted here is a bound on the wait.
        deadline = setTimeout(() => {
            call.destroy(Object.assign(new Error(`${endpoint.host}:${endpoint.port} did not answer`), {
                code: "ETIMEDOUT",
            }));
        }, TIMEOUT_MS);
        call.on("error", failed);
        call.end();
    });
}

/**
 * Read the answer as the document, or say what it was instead.
 *
 * Strict about the shape and deliberately so: everything downstream of a probe treats these
 * fields as facts about a server, and a page that happens to be JSON must not become one.
 * A string back is a reason a person can act on.
 */
export function readDiscoveryDocument(answer: Answer): VcsServerDiscovery | string {
    if (answer.status !== 200) {
        return `that address answered ${answer.status} rather than with a server description`;
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(answer.body);
    } catch {
        return "something answered there, and it was not a NarraLeaf Team server";
    }
    if (typeof parsed !== "object" || parsed === null) {
        return "something answered there, and it was not a NarraLeaf Team server";
    }

    const document = parsed as Partial<VcsServerDiscovery>;
    if (typeof document.protocol !== "number") {
        return "something answered there, and it was not a NarraLeaf Team server";
    }
    if (document.protocol !== TEAM_PROTOCOL_VERSION) {
        // One comparison, which is the reason the field is a number: this server speaks a
        // version of the protocol this Studio was not written against, and that is a
        // different remedy from every other answer here. The version this build speaks is
        // the one constant both the discovery check and the socket's opening frame read,
        // so the next bump is a single edit.
        return `that server speaks version ${document.protocol} of the protocol, and this`
            + ` version of Studio speaks ${TEAM_PROTOCOL_VERSION}. Updating Studio is what`
            + " closes the gap.";
    }

    const auth = document.auth;
    const data = document.data;
    const authority = document.authority;
    if (
        typeof document.name !== "string"
        || typeof document.version !== "string"
        || typeof auth !== "object" || auth === null
        || typeof auth.required !== "boolean"
        || typeof auth.url !== "string"
        || typeof data !== "object" || data === null
        || typeof data.url !== "string"
        || typeof authority !== "object" || authority === null
        || typeof authority.sha256 !== "string"
    ) {
        return "that server's description is missing something Studio needs from it";
    }
    // The data remote is the one field with no fallback anywhere: it is never typed, never
    // shown, and a project pointed at a server without one has nowhere to push.
    if (!data.url.trim()) {
        return "that server's description does not say where its projects live";
    }
    if (auth.required && !auth.url.trim()) {
        return "that server asks for a token and does not say where to present one";
    }

    return {
        name: document.name.trim() || auth.url.trim(),
        protocol: TEAM_PROTOCOL_VERSION,
        auth: { required: auth.required, url: auth.url.trim() },
        data: { url: data.url.trim() },
        authority: { sha256: authority.sha256.trim() },
        version: document.version.trim(),
        policy: readPolicy(document.policy),
        capabilities: readCapabilities(document.capabilities),
    };
}

/**
 * What a deployment asks of its clients, or nothing.
 *
 * Read the way capabilities are and for the same reason: a server that says nothing here
 * is one from before the field, and refusing it would take away the deployments this is
 * meant to describe. A rule that is not one of the words this Studio knows is dropped
 * rather than kept - what is left then is "nothing said", which every caller already
 * has an answer for, where a word nobody can act on would be a third state.
 */
function readPolicy(offered: unknown): VcsServerPolicy {
    if (typeof offered !== "object" || offered === null) return {};
    const rule = (offered as { publishLineage?: unknown }).publishLineage;
    return rule === "merge" || rule === "refuse" ? { publishLineage: rule } : {};
}

/**
 * The capability names a document offered, or none.
 *
 * Optional rather than required, and a malformed one is none rather than a refusal: a
 * server that says nothing here is a server from before the field, and refusing it would
 * take away the deployments this is meant to describe. Names are not checked against a
 * list - one this Studio does not know is still worth recording.
 */
function readCapabilities(offered: unknown): string[] {
    if (!Array.isArray(offered)) return [];
    const names: string[] = [];
    for (const entry of offered) {
        if (typeof entry !== "string") continue;
        const name = entry.trim();
        if (name && !names.includes(name)) names.push(name);
    }
    return names;
}

/** Which of the three failures a rejected request was. */
type Failure = "unreachable" | "certificate" | "other";

/**
 * Sort a rejected request into what the author has to do about it.
 *
 * The codes are node's rather than this product's, and the three groups are three different
 * sentences: nothing is there, something is there and its certificate is the question, or
 * something is there and it is not this.
 */
function classifyFailure(error: NodeJS.ErrnoException): Failure {
    const code = error.code ?? "";
    if (/^(ENOTFOUND|ECONNREFUSED|ECONNRESET|EHOSTUNREACH|ENETUNREACH|ETIMEDOUT|EAI_AGAIN|EPIPE|ECONNABORTED|ERR_SOCKET_CONNECTION_TIMEOUT)$/.test(code)) {
        return "unreachable";
    }
    // The same reading `reachThroughTrustStores` makes, from the same function: what it
    // retried against another store and what it gave up on have to be one judgement, or a
    // failure it stopped at could be reported here as one it had not finished trying.
    return isTrustFailure(error) ? "certificate" : "other";
}

/**
 * What reaching an address came to.
 *
 * Writes nothing except on the untrusted answer, where the authority's certificate is put
 * on disk before anybody is asked anything - the file is half of what makes that answer
 * actionable, since the fingerprint on screen has to be that file's and on Linux the printed
 * command names it.
 */
export async function probeVcsServer(
    address: string,
    options: { userDataDir: string },
): Promise<VcsServerProbe> {
    const endpoint = parseServerAddress(address);
    if (!endpoint) {
        return {
            kind: "not-a-server",
            detail: "A server address looks like nlteam://team.example.lan, with an optional"
                + " :port after it.",
        };
    }

    try {
        const document = readDiscoveryDocument(
            await reachThroughTrustStores(options.userDataDir, (ca) => fetchDiscovery(endpoint, { ca })),
        );
        return typeof document === "string"
            ? { kind: "not-a-server", detail: document }
            : { kind: "ready", address: endpoint.address, discovery: document };
    } catch (error) {
        const failure = classifyFailure(error as NodeJS.ErrnoException);
        const message = error instanceof Error ? error.message : String(error);
        if (failure === "unreachable") {
            const code = (error as NodeJS.ErrnoException).code;
            return { kind: "unreachable", detail: `${endpoint.host}:${endpoint.port}: ${code ?? message}` };
        }
        if (failure === "other") {
            return { kind: "not-a-server", detail: message };
        }
        return await describeUntrusted(endpoint, options.userDataDir);
    }
}

/**
 * The answer for a server whose authority this machine does not know yet.
 *
 * The document is read again over a connection that verifies nothing, because it is what
 * the trust prompt names - an author deciding whether to trust an authority is owed the
 * name of the deployment it answers for. Nothing is acted on until they say yes, and a
 * second failure here is not fatal: an authority with no document beside it is still a
 * decision that can be put to somebody.
 */
async function describeUntrusted(endpoint: ServerEndpoint, userDataDir: string): Promise<VcsServerProbe> {
    // Loaded here rather than at the top of the file: `diagnoseEndpoint` reaches nothing but
    // `tls`, and the module it lives in reaches the Lore binding at module scope. Nothing
    // above `backend.ts` may do that through a static import, and only this answer - already
    // the slow one, and the rare one - needs it at all.
    const { diagnoseEndpoint } = await import("./serverSession");
    const verdict = await diagnoseEndpoint(endpoint.origin, TIMEOUT_MS);
    if (verdict.kind === "unreachable") {
        return { kind: "unreachable", detail: verdict.detail };
    }
    if (verdict.kind !== "authority") {
        // It refused the handshake and offered no chain to look at, which is something other
        // than a Team server answering.
        return { kind: "not-a-server", detail: verdict.detail };
    }

    const certificatePath = await writeAuthorityCertificate(
        userDataDir,
        verdict.fingerprint,
        verdict.pem,
    ).catch(() => "");
    const document = await fetchDiscovery(endpoint, null)
        .then(readDiscoveryDocument)
        .catch(() => "unreadable");

    return {
        kind: "untrusted",
        address: endpoint.address,
        authority: describeAuthority({
            fingerprint: verdict.fingerprint,
            // Nothing has vouched for anything at this point. A token names an authority and
            // there is no token yet - the whole of what has happened is that an address was
            // typed - so the interface compares by eye, as it did before tokens carried one.
            expected: "",
            subject: verdict.subject,
            expiresAt: verdict.expiresAt,
            certificatePath,
        }),
        discovery: typeof document === "string" ? null : document,
    };
}
