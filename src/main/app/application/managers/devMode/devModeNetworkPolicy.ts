import { session as electronSession, type Session } from "electron";
import fs from "fs/promises";
import path from "path";
import { decodeProjectConfig, findProjectConfigFileName, type ProjectConfigData } from "@shared/utils/nlproj";

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
};

/**
 * Enforces "renderer may only use the app protocol" for Dev Mode preview
 * windows, gated on the project's Allow HTTP flag.
 *
 * Enforcement is attached to the shared default session (the only session the
 * `app://` protocol handler is bound to) but is scoped by `webContents` id, so
 * the Workspace / Launcher / Settings windows that share that session are never
 * affected. When a preview allows HTTP, its window is simply absent from the
 * registry and both layers pass through.
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

    private isBlocked(webContentsId: number | undefined): boolean {
        if (webContentsId === undefined) {
            return false;
        }
        const policy = this.policies.get(webContentsId);
        return policy !== undefined && !policy.allowHttp;
    }

    private install(session: Session): void {
        if (this.installedSessions.has(session)) {
            return;
        }
        this.installedSessions.add(session);

        // Layer 1 — main-process request block. Cancels any remote request that
        // originates from a locked-down Dev Mode webContents, in any form
        // (fetch / XHR / WebSocket / <img> / <script> / <link> / media / ...).
        session.webRequest.onBeforeRequest(
            { urls: BLOCKED_REMOTE_URL_PATTERNS },
            (details, callback) => {
                if (this.isBlocked(details.webContentsId)) {
                    callback({ cancel: true });
                    return;
                }
                callback({});
            },
        );

        // Layer 2 — CSP. Constrains the Dev Mode document to the app protocol.
        // Defense in depth over Layer 1, and it surfaces a clear "refused by
        // Content-Security-Policy" error in the game console.
        session.webRequest.onHeadersReceived((details, callback) => {
            if (details.resourceType === "mainFrame" && this.isBlocked(details.webContentsId)) {
                callback({ responseHeaders: this.withCsp(details.responseHeaders) });
                return;
            }
            callback({});
        });
    }

    private withCsp(responseHeaders: Record<string, string[]> | undefined): Record<string, string[]> {
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
        headers["Content-Security-Policy"] = [LOCAL_ONLY_CSP];
        return headers;
    }
}

export const devModeNetworkPolicy = new DevModeNetworkPolicyManager();

/**
 * Read the project's Allow HTTP flag from its `.nlproj` (secure default:
 * `false`). Intentionally mirrors `normalizeNetworkConfiguration` in the
 * renderer's project configuration — replicated here so the main process has no
 * dependency on renderer modules. Any read/decode failure resolves to `false`.
 */
export async function readProjectAllowHttp(projectPath: string): Promise<boolean> {
    try {
        const config = await readProjectConfigData(projectPath);
        const network = (config?.app as { network?: { allowHttp?: unknown } } | undefined)?.network;
        return network?.allowHttp === true;
    } catch {
        return false;
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
