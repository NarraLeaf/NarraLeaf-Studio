import type { Session } from "electron";

/**
 * How Studio's own downloads meet this computer's proxy.
 *
 * Off (the default) is the path every fetch already took: Node `fetch`, no proxy. On, the same
 * calls go through a dedicated Chromium session in `system` mode, so they follow the proxy the
 * operating system already has - the one the author's browser is using - without an address to
 * type. The default session is left alone; windows do not start talking to the network.
 *
 * The build worker is a separate process and cannot see that session. On, it receives HTTP_PROXY
 * (and friends) derived from `session.resolveProxy`, the same way download rewrites already
 * travel in the worker config. Off, it inherits Studio's environment untouched, as it did before
 * the switch existed: an author who exported HTTPS_PROXY in the shell that launched Studio has
 * builds that download through it, and a switch they never touched must not take that away.
 *
 * Read through a callback rather than cached: Settings can flip the switch between two
 * downloads, and the next one has to honour it.
 */

const DOWNLOAD_PARTITION = "studio-downloads";
const PROXY_ENV_KEYS = [
    "HTTP_PROXY",
    "HTTPS_PROXY",
    "ALL_PROXY",
    "http_proxy",
    "https_proxy",
    "all_proxy",
] as const;

type FlagSource = () => unknown;

let source: FlagSource | null = null;

/** Wired once by `App`, from global state. Tests set their own. */
export function setUseSystemProxySource(fn: FlagSource | null): void {
    source = fn;
}

/** Whether the author has asked Studio downloads to follow this computer's proxy. */
export function currentUseSystemProxy(): boolean {
    if (!source) {
        return false;
    }
    try {
        return source() === true;
    } catch {
        return false;
    }
}

/**
 * The first hop of a PAC string from `session.resolveProxy`, as a URL the worker can put in
 * HTTP_PROXY, or `null` for DIRECT / unreadable.
 */
export function proxyUrlFromPac(pac: string): string | null {
    const first = pac.split(";")[0]?.trim() ?? "";
    if (!first || first.toUpperCase() === "DIRECT") {
        return null;
    }
    const match = /^(PROXY|HTTP|HTTPS|SOCKS|SOCKS4|SOCKS5)\s+(\S+)$/i.exec(first);
    if (!match) {
        return null;
    }
    const kind = match[1].toUpperCase();
    const hostPort = match[2];
    if (kind === "SOCKS" || kind === "SOCKS4" || kind === "SOCKS5") {
        return `socks5://${hostPort}`;
    }
    if (kind === "HTTPS") {
        return `https://${hostPort}`;
    }
    return `http://${hostPort}`;
}

/** Drop proxy variables, so the system proxy replaces a shell's rather than mixing with it. */
export function stripProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const next: NodeJS.ProcessEnv = { ...env };
    for (const key of PROXY_ENV_KEYS) {
        delete next[key];
    }
    return next;
}

/**
 * Put a proxy URL into the variables Node and electron-builder both honour.
 *
 * Node's own `fetch` is only told to read them for an http(s) proxy. NODE_USE_ENV_PROXY makes
 * undici build its dispatcher from HTTPS_PROXY, and it throws on a `socks5:` URL - every fetch in
 * the worker would fail. app-builder reads the same variables and does speak SOCKS, so a SOCKS
 * proxy still reaches the toolchain downloads while the worker's own fetches go direct.
 */
export function applyProxyUrlToEnv(env: NodeJS.ProcessEnv, proxyUrl: string): NodeJS.ProcessEnv {
    const next = stripProxyEnv(env);
    next.HTTP_PROXY = proxyUrl;
    next.HTTPS_PROXY = proxyUrl;
    next.ALL_PROXY = proxyUrl;
    next.http_proxy = proxyUrl;
    next.https_proxy = proxyUrl;
    next.all_proxy = proxyUrl;
    if (/^https?:/i.test(proxyUrl)) {
        next.NODE_USE_ENV_PROXY = "1";
    }
    return next;
}

/**
 * Environment for a process that downloads. Off: the base environment, untouched. On: the system
 * proxy for `https://github.com/`, which is where Studio's own archives live.
 */
export async function envForDownloadWorker(base: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
    if (!currentUseSystemProxy()) {
        return base;
    }
    const stripped = stripProxyEnv(base);
    const pac = await resolveSystemPac("https://github.com/");
    const proxyUrl = pac ? proxyUrlFromPac(pac) : null;
    return proxyUrl ? applyProxyUrlToEnv(stripped, proxyUrl) : stripped;
}

/**
 * The one fetch Studio downloads go through.
 *
 * Off, this is global `fetch`, so existing tests that stub it keep seeing the same calls. On,
 * Chromium's network stack follows the system proxy.
 */
export async function studioFetch(url: string, init?: RequestInit): Promise<Response> {
    if (!currentUseSystemProxy()) {
        return fetch(url, init);
    }
    return fetchViaSystemProxy(url, init);
}

let downloadSessionReady: Promise<Session> | null = null;

/**
 * The partition, put in system mode once. Setting the proxy again before every fetch reconfigures
 * the session under requests already in flight, and the plugin store fetches several at a time.
 * A failure is not kept, so the next download tries again.
 */
function systemProxySession(): Promise<Session> {
    downloadSessionReady ??= (async () => {
        const { session } = await import("electron");
        const downloadSession = session.fromPartition(DOWNLOAD_PARTITION);
        await downloadSession.setProxy({ mode: "system" });
        return downloadSession;
    })().catch((error: unknown) => {
        downloadSessionReady = null;
        throw error;
    });
    return downloadSessionReady;
}

async function fetchViaSystemProxy(url: string, init?: RequestInit): Promise<Response> {
    const downloadSession = await systemProxySession();
    return downloadSession.fetch(url, {
        method: init?.method,
        headers: init?.headers,
        signal: init?.signal,
        redirect: init?.redirect,
    });
}

async function resolveSystemPac(url: string): Promise<string | null> {
    try {
        const { session } = await import("electron");
        return await session.defaultSession.resolveProxy(url);
    } catch {
        return null;
    }
}
