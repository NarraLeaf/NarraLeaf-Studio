import { session as electronSession, type Session } from "electron";
import fs from "fs/promises";
import path from "path";
import { decodeProjectConfig, findProjectConfigFileName, type ProjectConfigData } from "@shared/utils/nlproj";
import {
    NETWORK_POLICY_ALLOWLIST,
    NETWORK_POLICY_ANY,
    isNetworkAddressAllowed,
    networkAllowlistCspSources,
    normalizeNetworkAllowlistEntries,
    type NetworkAllowlist,
} from "@shared/types/networkAllowlist";

/**
 * Remote URL schemes a preview game must never reach when HTTP is disallowed.
 * With these blocked and only `app://` (plus the window's own `file://` shell,
 * `data:`, `blob:`) permitted, the renderer is effectively confined to the app
 * protocol for anything network-facing.
 */
const BLOCKED_REMOTE_URL_PATTERNS = [
    "http://*/*",
    "https://*/*",
    "ws://*/*",
    "wss://*/*",
    "ftp://*/*",
];

/**
 * Local-only Content-Security-Policy for the Dev Mode document. Mirrors the
 * reference `narraleaf` renderer CSP but adds an explicit `connect-src` (so
 * `fetch`/XHR/WebSocket cannot fall back to a remote origin) and covers the
 * `file://` shell + `app://` assets this window actually uses. `'unsafe-inline'`
 * is required for the inline `<script type="importmap">` and inline styles;
 * `'unsafe-eval'` for the game runtime.
 */
const LOCAL_ONLY_CSP = [
    "default-src 'self' app: file: data: blob:",
    "script-src 'self' app: file: 'unsafe-inline' 'unsafe-eval' 'wasm-unsafe-eval'",
    "style-src 'self' app: file: 'unsafe-inline'",
    "img-src 'self' app: file: data: blob:",
    "font-src 'self' app: file: data:",
    "media-src 'self' app: file: data: blob:",
    "connect-src 'self' app: file: data: blob:",
    "worker-src 'self' app: blob:",
    "frame-src 'self' app:",
    "object-src 'none'",
    "base-uri 'self' app: file:",
    "form-action 'none'",
].join("; ");

export type PreviewNetworkPolicy = {
    allowHttp: boolean;
    /**
     * The project's allowlist, when it states one. Applies on top of {@link allowHttp}: HTTP off
     * still means nothing remote at all, and HTTP on with a list means only what is on it.
     */
    allowlist?: NetworkAllowlist;
};

/**
 * Enforces the project's network settings for Dev Mode preview windows: "app
 * protocol only" when HTTP is off, and "only the listed hosts" when it is on
 * with an allowlist.
 *
 * Enforcement is attached to the shared default session (the only session the
 * `app://` protocol handler is bound to) but is scoped by `webContents` id, so
 * the Workspace / Launcher / Settings windows that share that session are never
 * affected. When a preview reaches the whole network, its window is registered
 * with nothing to enforce and both layers pass through.
 */
class DevModeNetworkPolicyManager {
    private readonly installedSessions = new WeakSet<Session>();
    private readonly policies = new Map<number, PreviewNetworkPolicy>();

    /**
     * Register (or refresh) the policy for a Dev Mode window and ensure the
     * session-level hooks are installed. Must be called BEFORE the window loads
     * its document so the very first request is already governed.
     */
    public apply(webContentsId: number, policy: PreviewNetworkPolicy): void {
        this.policies.set(webContentsId, policy);
        this.install(electronSession.defaultSession);
    }

    /** Stop governing a Dev Mode window (call on window close). */
    public release(webContentsId: number): void {
        this.policies.delete(webContentsId);
    }

    /** A preview confined to the app protocol: no remote request of any kind leaves it. */
    private isBlocked(webContentsId: number | undefined): boolean {
        if (webContentsId === undefined) {
            return false;
        }
        const policy = this.policies.get(webContentsId);
        return policy !== undefined && !policy.allowHttp;
    }

    /**
     * Whether one request from a preview must be refused by its allowlist.
     *
     * Only reached for a window that allows HTTP - {@link isBlocked} has already answered for the
     * others - so what is left is the list, and a preview that states none passes everything.
     */
    private isRefused(webContentsId: number | undefined, url: string): boolean {
        if (webContentsId === undefined) {
            return false;
        }
        const policy = this.policies.get(webContentsId);
        if (!policy || networkAllowlistCspSources(policy.allowlist) === null) {
            return false;
        }
        return !isNetworkAddressAllowed(url, policy.allowlist);
    }

    private install(session: Session): void {
        if (this.installedSessions.has(session)) {
            return;
        }
        this.installedSessions.add(session);

        // Layer 1 - main-process request block. Cancels any remote request that
        // originates from a locked-down Dev Mode webContents, in any form
        // (fetch / XHR / WebSocket / <img> / <script> / <link> / media / ...).
        session.webRequest.onBeforeRequest(
            { urls: BLOCKED_REMOTE_URL_PATTERNS },
            (details, callback) => {
                if (this.isBlocked(details.webContentsId)) {
                    callback({ cancel: true });
                    return;
                }
                callback({ cancel: this.isRefused(details.webContentsId, details.url) });
            },
        );

        // Layer 2 - CSP. Constrains the Dev Mode document to the app protocol.
        // Defense in depth over Layer 1, and it surfaces a clear "refused by
        // Content-Security-Policy" error in the game console.
        session.webRequest.onHeadersReceived((details, callback) => {
            if (details.resourceType !== "mainFrame") {
                callback({});
                return;
            }
            if (this.isBlocked(details.webContentsId)) {
                callback({ responseHeaders: this.withCsp(details.responseHeaders, LOCAL_ONLY_CSP) });
                return;
            }
            const listed = this.listedCsp(details.webContentsId);
            if (listed) {
                callback({ responseHeaders: this.withCsp(details.responseHeaders, listed) });
                return;
            }
            callback({});
        });
    }

    /**
     * The local-only policy widened by exactly the origins on this preview's list, or null when it
     * has none. The same document the packaged game gets from `buildRuntimeCsp`, expressed against
     * `app:`/`file:` because that is the shell a preview runs in.
     */
    private listedCsp(webContentsId: number | undefined): string | null {
        const policy = webContentsId === undefined ? undefined : this.policies.get(webContentsId);
        const sources = networkAllowlistCspSources(policy?.allowlist);
        if (sources === null) {
            return null;
        }
        const remote = sources.length > 0 ? " " + sources.join(" ") : "";
        return LOCAL_ONLY_CSP
            .split("; ")
            // Only the directives that can name a remote source are widened. `script-src` is
            // deliberately not one of them: a listed host may send this game data, which is a
            // different thing from sending it code.
            .map(directive => (/^(default-src|img-src|media-src|font-src|connect-src) /.test(directive)
                ? directive + remote
                : directive))
            .join("; ");
    }

    private withCsp(
        responseHeaders: Record<string, string[]> | undefined,
        csp: string,
    ): Record<string, string[]> {
        const headers: Record<string, string[]> = {};
        if (responseHeaders) {
            for (const [key, value] of Object.entries(responseHeaders)) {
                // Drop any existing CSP (case-insensitive) so ours is authoritative.
                if (key.toLowerCase() === "content-security-policy") {
                    continue;
                }
                headers[key] = value;
            }
        }
        headers["Content-Security-Policy"] = [csp];
        return headers;
    }
}

export const devModeNetworkPolicy = new DevModeNetworkPolicyManager();

/**
 * Read the project's network settings from its `.nlproj` (secure defaults: HTTP
 * off, and the wide policy if it is on). Intentionally mirrors
 * `normalizeNetworkConfiguration` in the renderer's project configuration -
 * replicated here so the main process has no dependency on renderer modules.
 *
 * Any read/decode failure resolves to the secure end of both: a project whose
 * settings could not be read is not one this can vouch for.
 */
export async function readProjectNetworkSettings(
    projectPath: string,
): Promise<{ allowHttp: boolean; allowlist: NetworkAllowlist }> {
    try {
        const config = await readProjectConfigData(projectPath);
        const network = (config?.app as {
            network?: { allowHttp?: unknown; policy?: unknown; allowlist?: unknown };
        } | undefined)?.network;
        return {
            allowHttp: network?.allowHttp === true,
            allowlist: {
                policy: network?.policy === NETWORK_POLICY_ALLOWLIST ? NETWORK_POLICY_ALLOWLIST : NETWORK_POLICY_ANY,
                entries: normalizeNetworkAllowlistEntries(network?.allowlist),
                // Dev Mode runs the project's own plugins, whose declarations are read where
                // they are enforced; nothing on this path resolves them, so a plugin's hosts are
                // narrowed here exactly as a build would narrow them without that plugin.
                plugins: [],
            },
        };
    } catch {
        return {
            allowHttp: false,
            allowlist: { policy: NETWORK_POLICY_ALLOWLIST, entries: [], plugins: [] },
        };
    }
}

async function readProjectConfigData(projectPath: string): Promise<ProjectConfigData | null> {
    const entries = await fs.readdir(projectPath, { withFileTypes: true });
    const configFileName = findProjectConfigFileName(entries.map(entry => ({
        name: path.parse(entry.name).name,
        ext: path.extname(entry.name) || null,
        type: entry.isFile() ? "file" : entry.isDirectory() ? "directory" : "other",
    })));
    if (!configFileName) {
        return null;
    }
    const configPath = path.join(projectPath, configFileName);
    if (configFileName.endsWith(".nlproj")) {
        return decodeProjectConfig(await fs.readFile(configPath));
    }
    return JSON.parse(await fs.readFile(configPath, "utf-8")) as ProjectConfigData;
}
