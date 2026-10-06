import { USE_SYSTEM_PROXY_KEY } from "@shared/types/downloadSource";

/**
 * How Studio's own downloads meet this computer's proxy.
 *
 * Off (the default) is the path every fetch already took: Node `fetch`, no proxy. On, the same
 * calls go through a dedicated Chromium session in `system` mode, so they follow the proxy the
 * operating system already has - the one the author's browser is using - without an address to
 * type. The default session is left alone; windows do not start talking to the network.
 *
 * The build worker is a separate process and cannot see that session. It receives HTTP_PROXY
 * (and friends) derived from `session.resolveProxy`, the same way download rewrites already
 * travel in the worker config. Off, those variables are stripped so a shell that launched
 * Studio does not quietly proxy a build the author asked to go direct.
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

/** Drop proxy variables so a forked worker cannot inherit a shell's proxy. */
export function stripProxyEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    const next: NodeJS.ProcessEnv = { ...env };
    for (const key of PROXY_ENV_KEYS) {
        delete next[key];
    }
    return next;
}

/** Put a proxy URL into the variables Node and electron-builder both honour. */
export function applyProxyUrlToEnv(env: NodeJS.ProcessEnv, proxyUrl: string): NodeJS.ProcessEnv {
    const next = stripProxyEnv(env);
    next.HTTP_PROXY = proxyUrl;
    next.HTTPS_PROXY = proxyUrl;
    next.ALL_PROXY = proxyUrl;
    next.http_proxy = proxyUrl;
    next.https_proxy = proxyUrl;
    next.all_proxy = proxyUrl;
    next.NODE_USE_ENV_PROXY = "1";
    return next;
}

/**
 * Environment for a process that downloads. Off: no proxy variables. On: the system proxy
 * for `https://github.com/`, which is where Studio's own archives live.
 */
export async function envForDownloadWorker(base: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv> {
    const stripped = stripProxyEnv(base);
    if (!currentUseSystemProxy()) {
        return stripped;
    }
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

async function fetchViaSystemProxy(url: string, init?: RequestInit): Promise<Response> {
    const { session } = await import("electron");
    const downloadSession = session.fromPartition(DOWNLOAD_PARTITION);
    await downloadSession.setProxy({ mode: "system" });
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

export { USE_SYSTEM_PROXY_KEY };
