import type { Session } from "electron";
import { GAME_RUNTIME_PROTOCOL } from "@shared/types/gameRuntime";

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
 */
const BLOCKED_REMOTE_URL_PATTERNS = [
    "http://*/*",
    "https://*/*",
    "ws://*/*",
    "wss://*/*",
    "ftp://*/*",
];

/**
 * Build the runtime Content-Security-Policy. With HTTP disallowed the renderer
 * is limited to `nlgame:` (+ `data:`/`blob:`); enabling HTTP additionally
 * permits remote resource/connection origins (but never remote scripts, which
 * remain a separate concern).
 */
export function buildRuntimeCsp(allowHttp: boolean): string {
    const scheme = `${GAME_RUNTIME_PROTOCOL}:`;
    const remote = allowHttp ? " http: https: ws: wss:" : "";
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
export function injectRuntimeCsp(html: string, allowHttp: boolean): string {
    const meta = `<meta http-equiv="Content-Security-Policy" content="${buildRuntimeCsp(allowHttp)}" />`;
    return html.replace(/<head(\s[^>]*)?>/i, match => `${match}\n    ${meta}`);
}

/**
 * Install the main-process request block on the given session. No-op when HTTP
 * is allowed. Must be called before the window loads so the initial document
 * and every subsequent request is governed. The runtime process runs only the
 * game, so the block applies to the whole session (no per-webContents scoping).
 */
export function installRuntimeNetworkPolicy(session: Session, allowHttp: boolean): void {
    if (allowHttp) {
        return;
    }
    session.webRequest.onBeforeRequest({ urls: BLOCKED_REMOTE_URL_PATTERNS }, (_details, callback) => {
        callback({ cancel: true });
    });
}
