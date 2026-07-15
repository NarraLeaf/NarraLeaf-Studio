import fsSync from "fs";
import fs from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { nativeImage } from "electron";
import { app, BrowserWindow, ipcMain, Menu, protocol, session } from "electron/main";
import { WebSocketServer } from "ws";
import {
    GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL,
    GAME_RUNTIME_PROTOCOL,
    type GameRuntimePackV1,
} from "@shared/types/gameRuntime";
import { getMimeType } from "@shared/utils/fs";
import { buildGameRuntimeAssetVersionArg } from "@shared/utils/gameRuntimeAssetUrl";
import {
    resolveGameRuntimeEntrySurface,
    resolveGameRuntimeInitialBackgroundColor,
} from "@shared/utils/gameRuntimeEntrySurface";
import { resolveSingleByteRange } from "@shared/utils/httpRange";
import { createRuntimeResources, type RuntimeResources } from "./runtimeResources";
import {
    PLUGIN_REACT_MODULE_SOURCES,
    PLUGIN_RUNTIME_API_MODULE_SOURCE,
} from "@shared/utils/pluginRuntimeApiModule";
import { resolveRuntimeStaticPath } from "./runtimeProtocol";
import { injectRuntimeCsp, installRuntimeNetworkPolicy } from "./networkPolicy";
import {
    RuntimePersistenceStore,
    RuntimeSaveStore,
} from "./runtimeStorage";

const appDir = __dirname;

/**
 * Early mode marker from the loose app manifest, readable synchronously before
 * app-ready so path setup and the debugger guard run before Chromium does any
 * work. The pack's own `mode` (which may live in the consolidated store) stays
 * authoritative for everything decided after the pack is open; a stripped or
 * tampered manifest only ever downgrades to the stricter checks below.
 */
function readShellMode(): "preview" | "production" {
    try {
        const manifest = JSON.parse(fsSync.readFileSync(path.join(appDir, "package.json"), "utf-8")) as {
            narraleaf?: { mode?: unknown };
        };
        return manifest.narraleaf?.mode === "production" ? "production" : "preview";
    } catch {
        return "preview";
    }
}

const shellMode = readShellMode();

// Preview keeps saves next to the compiled app; a shipped game has no sibling
// userData dir and uses the OS per-user location derived from the app name.
const previewUserDataDir = path.resolve(appDir, "..", "userData");
const useSiblingUserData = shellMode !== "production" && fsSync.existsSync(previewUserDataDir);
const userDataDir = useSiblingUserData ? previewUserDataDir : app.getPath("userData");

/**
 * Build-time placeholder. The compiler substitutes the real value when asset
 * protection is on and leaves it untouched (and unused) otherwise. Must match
 * RUNTIME_KEY_PLACEHOLDER in @narraleaf/encryption.
 */
const PACK_KEY = "__NLS_ENC_KEY_PLACEHOLDER__";

/** Node inspector / Chromium remote-debugging switches refused in production. */
const DEBUG_SWITCHES = [
    "remote-debugging-port",
    "remote-debugging-pipe",
    "inspect",
    "inspect-brk",
    "inspect-port",
    "inspect-publish-uid",
];

let packPromise: Promise<GameRuntimePackV1> | null = null;
let mainWindow: BrowserWindow | null = null;
let controlServer: WebSocketServer | null = null;
let resources: RuntimeResources | null = null;
let saveStore: RuntimeSaveStore | null = null;
let persistenceStore: RuntimePersistenceStore | null = null;
let runtimeStorageFlushedForQuit = false;

/**
 * The active resource backend. Established once at startup; every packaged read
 * (pack, assets, bundled plugin entries) goes through it.
 */
function runtimeResources(): RuntimeResources {
    if (!resources) {
        throw new Error("Runtime resources accessed before initialization");
    }
    return resources;
}

/** Whether the process was started with an inspector / remote-debugging switch. */
function hasDebuggingSwitch(): boolean {
    if (DEBUG_SWITCHES.some(name => app.commandLine.hasSwitch(name))) {
        return true;
    }
    const pattern = /^--(remote-debugging-(port|pipe)|inspect(-brk|-port|-publish-uid)?)(=|$)/;
    return [...process.argv, ...process.execArgv].some(arg => pattern.test(arg));
}

protocol.registerSchemesAsPrivileged([
    {
        scheme: GAME_RUNTIME_PROTOCOL,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
            // Media elements need streamed responses for playback and seeking;
            // without this the whole payload buffers before <video> starts.
            stream: true,
        },
    },
]);

if (useSiblingUserData) {
    app.setPath("userData", userDataDir);
}

// Earliest possible refusal to run a production game under an attached
// debugger/CDP: before app-ready, before any window or session exists. The
// post-pack-read check below stays as the authoritative (tamper-resistant on
// asar-integrity platforms) second gate.
const startupBlocked = shellMode === "production" && hasDebuggingSwitch();
if (startupBlocked) {
    app.quit();
}

void app.whenReady().then(async () => {
    if (startupBlocked) {
        return;
    }
    resources = await createRuntimeResources(appDir, PACK_KEY);
    const pack = await readPack();
    if (pack.mode === "production" && hasDebuggingSwitch()) {
        // Refuse to run a production game under an attached debugger/CDP.
        app.quit();
        return;
    }
    const allowHttp = pack.network?.allowHttp === true;
    applyRuntimeAppIdentity(pack);
    applyRuntimeMenu(pack);
    registerRuntimeProtocol(allowHttp);
    registerRuntimeIpc();
    startPreviewControlServer(pack);
    // Confine the renderer to the app protocol before it loads any document
    // unless the project opted into HTTP.
    installRuntimeNetworkPolicy(session.defaultSession, allowHttp);
    mainWindow = createWindow(pack);
    await mainWindow.loadURL(`${GAME_RUNTIME_PROTOCOL}://runtime/index.html`);
});

app.on("window-all-closed", () => {
    app.quit();
});

app.on("before-quit", event => {
    // Save/persistence writes are debounced; hold the quit open until every
    // queued write has reached disk, then quit again.
    if (!runtimeStorageFlushedForQuit && (saveStore?.hasPendingWrites() || persistenceStore?.hasPendingWrites())) {
        event.preventDefault();
        void Promise.allSettled([
            saveStore?.flush(),
            persistenceStore?.flush(),
        ]).then(() => {
            runtimeStorageFlushedForQuit = true;
            app.quit();
        });
        return;
    }
    controlServer?.close();
    controlServer = null;
    void resources?.dispose();
    resources = null;
});

async function readPack(): Promise<GameRuntimePackV1> {
    if (!packPromise) {
        packPromise = runtimeResources()
            .readPack()
            .then(raw => JSON.parse(raw.toString("utf-8")) as GameRuntimePackV1);
    }
    return packPromise;
}

function createWindow(pack: GameRuntimePackV1): BrowserWindow {
    const size = resolveInitialWindowSize(pack);
    const icon = createProjectIcon(pack);
    // Production disables DevTools outright: with devTools:false Electron ignores
    // any openDevTools call and the menu/keyboard toggles become no-ops, so there
    // is no in-app path to the inspector (the startup switch guard covers CDP).
    const devToolsEnabled = pack.mode !== "production";
    const win = new BrowserWindow({
        title: pack.project.name,
        width: size.width,
        height: size.height,
        minWidth: 480,
        minHeight: 320,
        center: true,
        frame: true,
        // Stay hidden until the renderer's first paint so launch never flashes
        // an empty window; the background matches the entry surface for the
        // brief gap between first paint and the surface rendering its content.
        show: false,
        ...(icon ? { icon } : {}),
        backgroundColor: resolveGameRuntimeInitialBackgroundColor(pack),
        webPreferences: {
            preload: path.join(appDir, "preload.js"),
            contextIsolation: true,
            devTools: devToolsEnabled,
            // The preload derives versioned asset URLs from this marker; a
            // process argument is the only synchronous channel it can read
            // before the document loads.
            additionalArguments: [buildGameRuntimeAssetVersionArg(resolveAssetVersion(pack))],
        },
    });
    win.setTitle(pack.project.name);
    // Show on first paint. The timer is a safety net: a renderer that never
    // reaches ready-to-show should still surface a window rather than leave
    // the process running invisibly.
    const fallbackShow = setTimeout(() => {
        if (!win.isDestroyed() && !win.isVisible()) {
            win.show();
        }
    }, 3000);
    win.once("ready-to-show", () => {
        clearTimeout(fallbackShow);
        if (!win.isDestroyed()) {
            win.show();
        }
    });
    win.on("closed", () => {
        if (mainWindow === win) {
            mainWindow = null;
        }
    });
    // Push fullscreen transitions to the renderer so the `On Fullscreen Changed`
    // blueprint head also fires for fullscreen toggled outside the game (macOS
    // green button, OS shortcuts), not just via the Set Fullscreen node.
    const emitFullscreen = (isFullscreen: boolean) => () => {
        if (!win.isDestroyed()) {
            win.webContents.send(GAME_RUNTIME_FULLSCREEN_CHANGED_CHANNEL, isFullscreen);
        }
    };
    win.on("enter-full-screen", emitFullscreen(true));
    win.on("leave-full-screen", emitFullscreen(false));
    if (devToolsEnabled) {
        win.webContents.on("before-input-event", (_event, input) => {
            if (input.type === "keyUp" && input.key === "F12") {
                if (win.webContents.isDevToolsOpened()) {
                    win.webContents.closeDevTools();
                } else {
                    win.webContents.openDevTools({ mode: "detach" });
                }
            }
        });
    }
    return win;
}

/**
 * Production ships without Electron's default menu: it carries Reload and
 * DevTools items (and their accelerators) that have no place in a shipped
 * game. macOS keeps a minimal menu so quit/copy/paste stay reachable; other
 * platforms drop the menu bar entirely. Preview keeps the default menu as a
 * developer affordance.
 */
function applyRuntimeMenu(pack: GameRuntimePackV1): void {
    if (pack.mode !== "production") {
        return;
    }
    if (process.platform === "darwin") {
        Menu.setApplicationMenu(Menu.buildFromTemplate([
            { role: "appMenu" },
            { role: "editMenu" },
            { role: "windowMenu" },
        ]));
    } else {
        Menu.setApplicationMenu(null);
    }
}

function applyRuntimeAppIdentity(pack: GameRuntimePackV1): void {
    app.setName(pack.project.name);
    app.setAboutPanelOptions({
        applicationName: pack.project.name,
        applicationVersion: pack.project.version ?? pack.runtimeVersion,
    });
    const icon = createProjectIcon(pack);
    if (icon && process.platform === "darwin" && app.dock) {
        app.dock.setIcon(icon);
    }
}

function createProjectIcon(pack: GameRuntimePackV1): Electron.NativeImage | undefined {
    const relativePath = pack.project.icon?.relativePath;
    if (!relativePath) {
        return undefined;
    }
    try {
        const iconPath = resolveRuntimeStaticPath(appDir, relativePath);
        const image = nativeImage.createFromPath(iconPath);
        return image.isEmpty() ? undefined : image;
    } catch (error) {
        console.warn("[GameRuntime] Failed to load project icon", error);
        return undefined;
    }
}

function resolveInitialWindowSize(pack: GameRuntimePackV1): { width: number; height: number } {
    const surface = resolveGameRuntimeEntrySurface(pack);
    const width = surface?.designSize.width;
    const height = surface?.designSize.height;
    if (Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0) {
        return { width: Math.round(width!), height: Math.round(height!) };
    }
    return { width: 1280, height: 720 };
}


/**
 * Version tag baked into every asset URL by the preload. The per-compile
 * bundle id changes whenever the Studio produces a new pack, which is exactly
 * the lifetime of "this asset id maps to these bytes": asset ids themselves
 * are stable across recompiles, so they cannot key the HTTP cache alone.
 */
function resolveAssetVersion(pack: GameRuntimePackV1): string {
    const bundleId = String(pack.bundle?.bundleId ?? "").trim();
    return bundleId || pack.generatedAt || String(Date.now());
}

function registerRuntimeProtocol(allowHttp: boolean): void {
    protocol.handle(GAME_RUNTIME_PROTOCOL, async request => {
        const url = new URL(request.url);
        try {
            if (url.hostname === "runtime") {
                const pathname = decodeURIComponent(url.pathname);
                if (isIndexDocument(pathname)) {
                    return serveIndexDocument(resolveRuntimeStaticPath(appDir, pathname), allowHttp);
                }
                // Bundled runtime files (e.g. plugin entries) come from the store;
                // static runtime files fall back to a loose read from the app dir.
                const bundled = await runtimeResources().readRuntimeFile(pathname.replace(/^\/+/, ""));
                if (bundled) {
                    return serveBytes(bundled, getMimeType(pathname));
                }
                return serveFile(resolveRuntimeStaticPath(appDir, pathname));
            }
            if (url.hostname === "pack") {
                return serveBytes(await runtimeResources().readPack(), "application/json");
            }
            if (url.hostname === "plugin-api") {
                const pathname = `/${decodeURIComponent(url.pathname).replace(/^\/+/, "")}`;
                const source = pathname === "/runtime.js"
                    ? PLUGIN_RUNTIME_API_MODULE_SOURCE
                    : PLUGIN_REACT_MODULE_SOURCES[pathname];
                if (source) {
                    return new Response(source, {
                        status: 200,
                        headers: {
                            "Content-Type": "text/javascript",
                            // Fixed per runtime build and served from memory; a
                            // modest lifetime skips re-fetches within a session
                            // without pinning sources across Studio upgrades.
                            "Cache-Control": "public, max-age=3600",
                        },
                    });
                }
                return new Response("Not found", { status: 404 });
            }
            if (url.hostname === "asset") {
                // The query string only versions the URL for HTTP cache keying
                // (see the preload's assetUrl); assets resolve by pathname alone.
                const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
                return await serveAsset(request, assetId);
            }
            return new Response("Not found", { status: 404 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return new Response(message, { status: 404 });
        }
    });
}

/**
 * Asset responses are effectively immutable: every asset URL carries a
 * per-pack version query, so a newer pack always requests different URLs and
 * long-lived cache entries can never go stale. Caching matters here — the
 * game engine drops and re-fetches images on every scene change, and without
 * it each of those requests round-trips into this process.
 */
const ASSET_CACHE_CONTROL = "public, max-age=31536000, immutable";

/** Loose assets above this size stream from disk instead of buffering fully. */
const ASSET_STREAM_THRESHOLD_BYTES = 8 * 1024 * 1024;

async function serveAsset(request: Request, assetId: string): Promise<Response> {
    const pack = await readPack();
    const contentType = pack.assets.items[assetId]?.mimeType ?? getMimeType(assetId);
    const rangeHeader = request.headers.get("range");
    const filePath = runtimeResources().getAssetFilePath(pack, assetId);
    if (filePath) {
        const { size } = await fs.stat(filePath);
        const range = resolveSingleByteRange(rangeHeader, size);
        if (range.kind === "unsatisfiable") {
            return rangeNotSatisfiable(size);
        }
        if (range.kind === "partial") {
            return streamAssetFile(filePath, contentType, range, size, 206);
        }
        if (size > ASSET_STREAM_THRESHOLD_BYTES) {
            return streamAssetFile(filePath, contentType, { start: 0, end: size - 1 }, size, 200);
        }
        return assetResponse(await fs.readFile(filePath), contentType);
    }
    const data = await runtimeResources().readAsset(pack, assetId);
    const range = resolveSingleByteRange(rangeHeader, data.byteLength);
    if (range.kind === "unsatisfiable") {
        return rangeNotSatisfiable(data.byteLength);
    }
    if (range.kind === "partial") {
        // subarray shares the underlying memory, so range requests against a
        // cached buffer cost no copy.
        return new Response(asBodyBytes(data.subarray(range.start, range.end + 1)), {
            status: 206,
            headers: partialAssetHeaders(contentType, range, data.byteLength),
        });
    }
    return assetResponse(data, contentType);
}

function assetHeaders(contentType: string): Record<string, string> {
    return {
        "Content-Type": contentType,
        "Cache-Control": ASSET_CACHE_CONTROL,
        "Accept-Ranges": "bytes",
    };
}

function partialAssetHeaders(
    contentType: string,
    range: { start: number; end: number },
    totalSize: number,
): Record<string, string> {
    return {
        ...assetHeaders(contentType),
        "Content-Range": `bytes ${range.start}-${range.end}/${totalSize}`,
        "Content-Length": String(range.end - range.start + 1),
    };
}

function assetResponse(data: Buffer, contentType: string): Response {
    return new Response(asBodyBytes(data), {
        status: 200,
        headers: assetHeaders(contentType),
    });
}

function rangeNotSatisfiable(totalSize: number): Response {
    return new Response(null, {
        status: 416,
        headers: {
            "Content-Range": `bytes */${totalSize}`,
            "Accept-Ranges": "bytes",
        },
    });
}

function streamAssetFile(
    filePath: string,
    contentType: string,
    range: { start: number; end: number },
    totalSize: number,
    status: 200 | 206,
): Response {
    const stream = fsSync.createReadStream(filePath, { start: range.start, end: range.end });
    const headers = status === 206
        ? partialAssetHeaders(contentType, range, totalSize)
        : { ...assetHeaders(contentType), "Content-Length": String(totalSize) };
    return new Response(Readable.toWeb(stream) as unknown as ReadableStream, { status, headers });
}

async function serveFile(filePath: string, contentType = getMimeType(filePath)): Promise<Response> {
    return serveBytes(await fs.readFile(filePath), contentType);
}

/** Runtime code and the pack stay no-store: preview recompiles must always be fresh. */
function serveBytes(data: Buffer, contentType: string): Response {
    return new Response(asBodyBytes(data), {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Cache-Control": "no-store",
        },
    });
}

/**
 * Hand Buffer bytes to a Response without the copy `new Uint8Array(data)`
 * would make: a Buffer already satisfies the runtime BufferSource contract,
 * the cast only bridges lib.dom's stricter ArrayBuffer-backed view type.
 */
function asBodyBytes(data: Buffer): Uint8Array<ArrayBuffer> {
    return data as Uint8Array<ArrayBuffer>;
}

function isIndexDocument(pathname: string): boolean {
    const normalized = pathname.replace(/^\/+/, "").toLowerCase();
    return normalized === "" || normalized === "index.html";
}

/** Serve the runtime document with the gated Content-Security-Policy injected. */
async function serveIndexDocument(filePath: string, allowHttp: boolean): Promise<Response> {
    const html = await fs.readFile(filePath, "utf-8");
    return new Response(injectRuntimeCsp(html, allowHttp), {
        status: 200,
        headers: {
            "Content-Type": "text/html; charset=utf-8",
            "Cache-Control": "no-store",
        },
    });
}

function registerRuntimeIpc(): void {
    // Module-level refs so the before-quit handler can flush pending writes.
    const saves = new RuntimeSaveStore(userDataDir);
    const persistence = new RuntimePersistenceStore(userDataDir);
    saveStore = saves;
    persistenceStore = persistence;

    ipcMain.handle("runtime:read-pack", () => readPack());
    ipcMain.handle("runtime:close", () => {
        app.quit();
    });
    ipcMain.handle("runtime:fullscreen:get", () => mainWindow?.isFullScreen() === true);
    ipcMain.handle("runtime:fullscreen:set", (_event, fullscreen: boolean) => {
        mainWindow?.setFullScreen(fullscreen === true);
    });
    ipcMain.on("runtime:log", (_event, data: { level?: string; message?: string }) => {
        const level = data?.level === "error" ? "error" : data?.level === "warning" ? "warn" : "log";
        console[level](`[GameRuntime] ${String(data?.message ?? "")}`);
    });

    ipcMain.handle("runtime:save:write", (_event, data: { id: string; savedGame: unknown; capture?: string; metadata?: unknown }) =>
        saves.write(data.id, data.savedGame, data.capture, data.metadata));
    ipcMain.handle("runtime:save:read", (_event, id: string) => saves.read(id));
    ipcMain.handle("runtime:save:listIds", () => saves.listIds());
    ipcMain.handle("runtime:save:readPreview", (_event, id: string) => saves.readPreview(id));
    ipcMain.handle("runtime:save:delete", (_event, id: string) => saves.delete(id));

    ipcMain.handle("runtime:persistence:getAll", () => persistence.getAll());
    ipcMain.handle("runtime:persistence:getValue", (_event, key: string) => persistence.getValue(key));
    ipcMain.handle("runtime:persistence:setValue", (_event, key: string, value: unknown) => persistence.setValue(key, value));
    ipcMain.handle("runtime:persistence:removeValue", (_event, key: string) => persistence.removeValue(key));
}

function startPreviewControlServer(pack: GameRuntimePackV1): void {
    const preview = pack.preview;
    if (!preview?.controlPort || !preview.controlToken) {
        return;
    }
    controlServer = new WebSocketServer({
        host: "127.0.0.1",
        port: preview.controlPort,
    });
    controlServer.on("connection", socket => {
        socket.on("message", raw => {
            let payload: { type?: unknown; token?: unknown };
            try {
                payload = JSON.parse(raw.toString()) as { type?: unknown; token?: unknown };
            } catch {
                socket.send(JSON.stringify({ ok: false, error: "Invalid JSON" }));
                return;
            }
            if (payload.token !== preview.controlToken) {
                socket.send(JSON.stringify({ ok: false, error: "Invalid token" }));
                return;
            }
            if (payload.type === "shutdown") {
                socket.send(JSON.stringify({ ok: true }));
                setTimeout(() => app.quit(), 20);
                return;
            }
            socket.send(JSON.stringify({ ok: false, error: "Unknown command" }));
        });
    });
    controlServer.on("error", error => {
        console.error("[GameRuntime] Preview control server error", error);
    });
}
