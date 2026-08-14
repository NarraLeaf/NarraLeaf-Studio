import type { Session } from "electron";
import { GAME_RUNTIME_PROTOCOL } from "@shared/types/gameRuntime";
import {
    isNetworkAddressAllowed,
    networkAllowlistCspSources,
    type NetworkAllowlist,
} from "@shared/types/networkAllowlist";

/**
 * Network enforcement for the standalone preview/packaged game runtime, gated on
 * the project's Allow HTTP flag (from `pack.network.allowHttp`).
 *
 * When HTTP is disallowed (the secure default), the renderer is confined to the
 * `nlgame://` app protocol via two independent layers:
 *   1. A main-process `webRequest` block that cancels every remote request.
 *   2. A Content-Security-Policy injected into the document.
 *
 * This mirrors the in-Studio dev preview policy
 * (src/main/app/application/managers/devMode/devModeNetworkPolicy.ts); the two
 * differ only in the app scheme (`nlgame:` here vs `app:`/`file:` there).
 */

/**
 * Remote URL schemes the game must never reach when HTTP is disallowed. The
 * `nlgame:` app scheme is intentionally absent, so game assets keep loading;
 * the Node-side preview control WebSocket server is unaffected (it is not a
 * renderer-session request).
 *
 * Also the observation set for test network blocking, which decides per request
 * rather than cancelling the lot - see {@link isNetworkBlockedUrl}.
 */
const BLOCKED_REMOTE_URL_PATTERNS = [
    "http://*/*",
    "https://*/*",
    "ws://*/*",
    "wss://*/*",
    "ftp://*/*",
];

/**
 * Schemes that never leave the machine. Blocking any of these would not test the
 * game's behaviour without a network - it would stop the game existing:
 * `nlgame:` is where every byte of the game itself comes from, `file:` is the
 * shell's own document on the web/packaged paths, `devtools:` is the inspector
 * (a blocked-network run nobody can debug is not much of a test), and
 * `data:`/`blob:`/`about:` are the renderer talking to itself.
 */
const LOCAL_URL_SCHEMES = new Set([
    `${GAME_RUNTIME_PROTOCOL}:`,
    "file:",
    "devtools:",
    "data:",
    "blob:",
    "about:",
]);

/**
 * The machine itself. Loopback stays reachable under test blocking for the same
 * reason `devtools:` does - the inspector's transport is `ws://127.0.0.1:<port>`
 * - and because Studio's own dev tooling attaches there.
 *
 * Matched on label boundaries, so `localhost.example.com` is a remote host that
 * happens to start with the word and is blocked like any other.
 */
function isLoopbackHost(hostname: string): boolean {
    // `new URL("http://[::1]/").hostname` keeps the brackets; strip them so the
    // literal compares like any other host.
    const host = hostname.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
    return host === "localhost"
        || host.endsWith(".localhost")
        || host === "::1"
        // The whole 127.0.0.0/8 block is loopback, not just 127.0.0.1.
        || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/**
 * Whether a request must be vetoed when the game was started with network
 * blocking (`NARRALEAF_TEST_NETWORK=blocked`).
 *
 * Fails closed: a URL this process cannot even parse is not one it can vouch
 * for, and letting it through would make the blocked-network verdict a guess.
 */
export function isNetworkBlockedUrl(url: string): boolean {
    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return true;
    }
    if (LOCAL_URL_SCHEMES.has(parsed.protocol)) {
        return false;
    }
    return !isLoopbackHost(parsed.hostname);
}

/**
 * Build the runtime Content-Security-Policy.
 *
 * With HTTP disallowed the renderer is limited to `nlgame:` (+ `data:`/`blob:`). With it allowed the
 * remote half is either the bare schemes - any host - or, when the project states an allowlist, the
 * origins on it. Remote scripts are never permitted either way, which is a separate concern from
 * both.
 *
 * The allowlist half is what makes this a boundary for code the main process never sees. A Fetch
 * node's request is decided in `blueprintNetworkFetch`, but a plugin's runtime code is ordinary
 * script in this page and calls `fetch` directly; `connect-src` is what decides that one, and the
 * browser applies it to every redirect hop as well.
 *
 * An empty allowlist yields no remote sources at all, which is the honest reading of "the project
 * states a list and the list is empty".
 */
export function buildRuntimeCsp(allowHttp: boolean, allowlist?: NetworkAllowlist): string {
    const scheme = `${GAME_RUNTIME_PROTOCOL}:`;
    const sources = allowHttp ? networkAllowlistCspSources(allowlist) : [];
    // `null` is the wide policy: the schemes themselves, which is what every build shipped with
    // before a list could be stated.
    const remote = !allowHttp
        ? ""
        : sources === null
            ? " http: https: ws: wss:"
            : sources.length > 0 ? ` ${sources.join(" ")}` : "";
    return [
        `default-src 'self' ${scheme} data: blob:${remote}`,
        `script-src 'self' ${scheme}`,
        `style-src 'self' ${scheme} 'unsafe-inline'`,
        `img-src 'self' ${scheme} data: blob:${remote}`,
        `media-src 'self' ${scheme} data: blob:${remote}`,
        `font-src 'self' ${scheme} data: blob:${remote}`,
        `connect-src 'self' ${scheme} data: blob:${remote}`,
        `worker-src 'self' ${scheme} blob:`,
        "object-src 'none'",
        `base-uri 'self' ${scheme}`,
        "form-action 'none'",
    ].join("; ");
}

/**
 * Inject the CSP `<meta>` into the served index.html `<head>`. Delivered as a
 * meta tag (rather than a response header) so it is honored regardless of how
 * the custom `nlgame:` scheme is treated.
 */
export function injectRuntimeCsp(html: string, allowHttp: boolean, allowlist?: NetworkAllowlist): string {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${buildRuntimeCsp(allowHttp, allowlist)}" />`;
    return html.replace(/<head(\s[^>]*)?>/i, match => `${match}\n    ${meta}`);
}

export type RuntimeNetworkPolicyOptions = {
    /** The project's Allow HTTP flag, from `pack.network.allowHttp`. */
    allowHttp: boolean;
    /**
     * The project's allowlist, from the same block. Absent, or stating the wide policy, leaves this
     * layer deciding only whether remote requests happen at all.
     */
    allowlist?: NetworkAllowlist;
    /**
     * Test network blocking (`NARRALEAF_TEST_NETWORK=blocked`). Overrides
     * `allowHttp`: the point of the test is to see what a game does when the
     * network is gone, so a project that opted into HTTP must still lose it.
     */
    blockAll: boolean;
};

/**
 * Install the main-process request block on the given session. No-op only when
 * HTTP is allowed with no allowlist to enforce and no test block in force. Must
 * be called before the window loads so the initial document and every subsequent
 * request is governed. The runtime process runs only the game, so the block
 * applies to the whole session (no per-webContents scoping).
 *
 * One registration, not two: `webRequest.onBeforeRequest` keeps only the last
 * listener attached, so a second call for the test block would silently unseat
 * the `allowHttp` one and hand a project that never wanted HTTP a working
 * network. Which is why the three questions are answered inside one callback
 * rather than by three listeners that would take turns being the only one.
 */
export function installRuntimeNetworkPolicy(session: Session, options: RuntimeNetworkPolicyOptions): void {
    const { allowHttp, allowlist, blockAll } = options;
    const narrowed = networkAllowlistCspSources(allowlist) !== null;
    if (allowHttp && !narrowed && !blockAll) {
        return;
    }
    session.webRequest.onBeforeRequest({ urls: BLOCKED_REMOTE_URL_PATTERNS }, (details, callback) => {
        // Without allowHttp the game is confined to `nlgame:` and every pattern
        // above is cancelled outright - unchanged shipped behaviour, loopback
        // included. Test blocking is the wider net (it also bites when the
        // project DID allow HTTP) and the narrower veto: it spares loopback, or
        // the game could not be inspected while it ran.
        if (!allowHttp) {
            callback({ cancel: true });
            return;
        }
        if (blockAll) {
            callback({ cancel: isNetworkBlockedUrl(details.url) });
            return;
        }
        // The allowlist. Second of the two layers over the same list - the CSP is the first - because
        // a `connect-src` governs what the page's own script may ask for and this governs the
        // session, which is what catches a subresource load the page never wrote down.
        callback({ cancel: !isNetworkAddressAllowed(details.url, allowlist) });
    });
}
