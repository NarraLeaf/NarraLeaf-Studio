/**
 * `narraleaf://` links a Team server's web console hands out.
 *
 *     narraleaf://team/connect?server=https://team.example:41402
 *         add this server — the Add Server dialog, its address filled in, nothing else
 *     narraleaf://team/open?server=…&project=<id>[&doc=…&element=…]
 *         open a project of a server this installation is already signed in to
 *
 * **A link never does anything on its own.** It can come from any web page or chat
 * message, so `connect` only fills in an address the person still has to confirm and sign
 * in to, and `open` is refused unless the server is one Studio already holds a sign-in
 * for. Anything that does not parse is ignored.
 */
export type TeamDeepLink =
    | { kind: "connect"; server: string }
    | { kind: "open"; server: string; project: string; doc?: string; element?: string };

/** The scheme Studio registers. */
export const TEAM_DEEP_LINK_SCHEME = "narraleaf";

const FIELD_LIMIT = 256;

function field(params: URLSearchParams, name: string): string | undefined {
    const value = params.get(name);
    if (value === null) return undefined;
    const trimmed = value.trim();
    return trimmed === "" || trimmed.length > FIELD_LIMIT ? undefined : trimmed;
}

/** The server address in a link, as an https origin, or undefined when it is not one. */
function serverOf(params: URLSearchParams): string | undefined {
    const raw = field(params, "server");
    if (raw === undefined) return undefined;
    try {
        const url = new URL(raw);
        return url.protocol === "https:" && url.username === "" && url.password === "" ? url.origin : undefined;
    } catch {
        return undefined;
    }
}

export function parseTeamDeepLink(link: string): TeamDeepLink | null {
    let url: URL;
    try {
        url = new URL(link);
    } catch {
        return null;
    }
    if (url.protocol !== `${TEAM_DEEP_LINK_SCHEME}:` || url.hostname !== "team") return null;
    const server = serverOf(url.searchParams);
    if (server === undefined) return null;
    const action = url.pathname.replace(/^\/+|\/+$/g, "");
    if (action === "connect") return { kind: "connect", server };
    if (action === "open") {
        const project = field(url.searchParams, "project");
        if (project === undefined || !/^[A-Za-z0-9_-]+$/.test(project)) return null;
        const doc = field(url.searchParams, "doc");
        const element = field(url.searchParams, "element");
        return {
            kind: "open",
            server,
            project,
            ...(doc === undefined ? {} : { doc }),
            ...(element === undefined ? {} : { element }),
        };
    }
    return null;
}

/** The first argument in a launch's argv that is one of these links (Windows and Linux). */
export function deepLinkInArgv(argv: readonly string[]): string | undefined {
    return argv.find((argument) => argument.startsWith(`${TEAM_DEEP_LINK_SCHEME}://`));
}
