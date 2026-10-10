/**
 * Keeping the request proxies a main process runs for a renderer off the loopback services Studio
 * itself serves.
 *
 * A main-process request has no origin. That is why the Fetch node goes through main (CORS) - and it
 * is also what makes it dangerous next to a server that tells callers apart by origin: the agent MCP
 * endpoint refuses any request carrying an `Origin` header, precisely so a web page cannot talk to it,
 * and a request from main carries none. A renderer that can name the address, method, headers and body
 * of a main-process request can therefore speak to Studio's own endpoints as if it were a local
 * program - with a bearer token it read off the clipboard, as one does in the case this was written
 * for. Workspace and game renderers run plugin and project code, so that renderer is not the author.
 *
 * What is refused is narrow on purpose: a loopback address on one of the ports Studio itself is
 * listening on right now. A game's Fetch node calling the author's own local API (`localhost:3000`)
 * is ordinary and keeps working. The port is read off the URL first and the name is resolved only
 * when the port is one of Studio's, so every other request costs nothing extra and behaves exactly as
 * before.
 *
 * The name is resolved because the address bar is not the destination: `localhost`, a public name
 * whose record is `127.0.0.1`, `0.0.0.0`, `[::]` and `[::ffff:127.0.0.1]` all reach the same socket.
 * IPv4 shorthands (`127.1`, `2130706433`, `0x7f.1`) need no special case - the WHATWG parser has
 * already turned them into dotted quads by the time a `URL` names its host.
 *
 * What it does not close: a name that resolves to a public address here and to loopback a moment
 * later, when `fetch` resolves it again (DNS rebinding with a zero TTL). Pinning the address would
 * mean replacing `fetch`'s connector, which this shared code cannot do in every shell it runs in; the
 * endpoint's bearer token is what stands behind this check in that case.
 *
 * Pure apart from the lookup, which each main process passes in (`dns.lookup`), so the rules are
 * tested without a resolver and the module stays importable from every bundle.
 *
 * Comments in English per project convention.
 */

import { AGENT_MCP_DEFAULT_PORT, AGENT_MCP_FALLBACK_PORTS } from "@shared/agent/protocol";

/** The dev debug server's port unless `NLS_DEBUG_PORT` moves it (`managers/debug/studioDebugServer.ts`). */
export const STUDIO_DEBUG_DEFAULT_PORT = 9223;

/**
 * The loopback ports Studio serves on unless something moved them: the agent MCP endpoint - its
 * default and the fixed ports it moves to when the default is taken - and the dev debug server.
 * For a process that cannot ask a running Studio where it is listening - the packaged game, which
 * may run beside a Studio the player also has open. Studio's own main process reads the live ports
 * instead (`BaseApp.ownLoopbackPorts`).
 */
export const STUDIO_DEFAULT_LOOPBACK_PORTS: readonly number[] = [AGENT_MCP_DEFAULT_PORT, ...AGENT_MCP_FALLBACK_PORTS, STUDIO_DEBUG_DEFAULT_PORT];

/** Every address a host name resolves to. Rejects when it resolves to none. */
export type HostAddressLookup = (hostname: string) => Promise<readonly string[]>;

/** Whether connecting to `address` (an IP literal, IPv6 with or without brackets) lands on this machine's loopback. */
export function isLoopbackAddress(address: string): boolean {
    let value = address.trim().toLowerCase();
    if (value.startsWith("[") && value.endsWith("]")) {
        value = value.slice(1, -1);
    }
    const zone = value.indexOf("%");
    if (zone >= 0) {
        value = value.slice(0, zone);
    }
    const dotted = parseIpv4(value);
    if (dotted) {
        return isLoopbackIpv4(dotted);
    }
    const v6 = parseIpv6(value);
    if (!v6) {
        return false;
    }
    if (v6.every(group => group === 0)) {
        // `::`, the unspecified address: connecting to it reaches the local host.
        return true;
    }
    if (v6.slice(0, 7).every(group => group === 0) && v6[7] === 1) {
        return true;
    }
    if (!v6.slice(0, 5).every(group => group === 0)) {
        return false;
    }
    const v4 = [v6[6] >> 8, v6[6] & 0xff, v6[7] >> 8, v6[7] & 0xff];
    // IPv4-mapped (`::ffff:a.b.c.d`): the IPv4 address itself, as a dual-stack socket connects to it.
    if (v6[5] === 0xffff) {
        return isLoopbackIpv4(v4);
    }
    // The deprecated IPv4-compatible form (`::127.0.0.1`), refused for 127/8 alone: `::2` and its
    // neighbours read as `0.0.0.x` this way and are not this machine.
    return v6[5] === 0 && v4[0] === 127;
}

/** 127.0.0.0/8, and 0.0.0.0/8, which reaches the local host on the platforms that accept it. */
function isLoopbackIpv4(octets: readonly number[]): boolean {
    return octets[0] === 127 || octets[0] === 0;
}

function parseIpv4(value: string): number[] | null {
    const parts = value.split(".");
    if (parts.length !== 4 || !parts.every(part => /^\d{1,3}$/.test(part))) {
        return null;
    }
    const octets = parts.map(Number);
    return octets.every(octet => octet <= 255) ? octets : null;
}

function parseIpv6(value: string): number[] | null {
    if (!value.includes(":")) {
        return null;
    }
    let text = value;
    // A trailing dotted quad (`::ffff:127.0.0.1`) is the last two groups written another way.
    const lastColon = text.lastIndexOf(":");
    const embedded = parseIpv4(text.slice(lastColon + 1));
    if (embedded) {
        const hex = (high: number, low: number) => ((high << 8) | low).toString(16);
        text = `${text.slice(0, lastColon + 1)}${hex(embedded[0], embedded[1])}:${hex(embedded[2], embedded[3])}`;
    }
    const halves = text.split("::");
    if (halves.length > 2) {
        return null;
    }
    const read = (half: string): number[] | null => {
        if (half === "") {
            return [];
        }
        const groups = half.split(":");
        if (!groups.every(group => /^[0-9a-f]{1,4}$/.test(group))) {
            return null;
        }
        return groups.map(group => parseInt(group, 16));
    };
    const left = read(halves[0]);
    const right = halves.length === 2 ? read(halves[1]) : [];
    if (!left || !right) {
        return null;
    }
    if (halves.length === 1) {
        return left.length === 8 ? left : null;
    }
    const missing = 8 - left.length - right.length;
    if (missing < 1) {
        return null;
    }
    return [...left, ...new Array<number>(missing).fill(0), ...right];
}

/** The port a URL connects to: its own, or its scheme's default. Null for a scheme without one. */
function connectPort(url: URL): number | null {
    if (url.port) {
        return Number(url.port);
    }
    if (url.protocol === "http:" || url.protocol === "ws:") {
        return 80;
    }
    if (url.protocol === "https:" || url.protocol === "wss:") {
        return 443;
    }
    return null;
}

/**
 * Why a request to `address` must not be made, or null when it may.
 *
 * `ports` are the loopback ports Studio is serving on at this moment. A name that cannot be resolved
 * is refused only when its port is one of them: the request would have failed anyway, and refusing
 * it here keeps a resolver that answers differently the second time from deciding the outcome.
 */
export async function refuseOwnLoopbackService(
    address: string,
    ports: readonly number[],
    lookup: HostAddressLookup,
): Promise<string | null> {
    let url: URL;
    try {
        url = new URL(address);
    } catch {
        return null;
    }
    const port = connectPort(url);
    if (port === null || !ports.includes(port)) {
        return null;
    }
    const host = url.hostname;
    const literal = host.startsWith("[") || parseIpv4(host) !== null;
    let addresses: readonly string[];
    if (literal) {
        addresses = [host];
    } else {
        try {
            addresses = await lookup(host);
        } catch {
            return ownServiceRefusal(url);
        }
    }
    return addresses.some(isLoopbackAddress) ? ownServiceRefusal(url) : null;
}

function ownServiceRefusal(url: URL): string {
    return `${url.host} is one of NarraLeaf Studio's own local services, which cannot be requested from here.`;
}

/**
 * Request headers without `Host`.
 *
 * A browser never lets a page set it, and a main process must not either: a caller-chosen `Host` is
 * how a request to one name presents itself to a server as another, and Studio's endpoints judge a
 * request partly by it. Dropped silently rather than refused, which is what the web shell's browser
 * does with the same header, so a node answers the same in every shell.
 */
export function withoutHostHeader(headers: Readonly<Record<string, string>> | null | undefined): Record<string, string> | undefined {
    if (!headers) {
        return undefined;
    }
    const kept = Object.entries(headers).filter(([name]) => name.trim().toLowerCase() !== "host");
    return kept.length > 0 ? Object.fromEntries(kept) : undefined;
}
