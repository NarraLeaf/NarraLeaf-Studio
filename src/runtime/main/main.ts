import fs from "fs/promises";
import path from "path";
import { nativeImage } from "electron";
import { app, BrowserWindow, ipcMain, protocol, session } from "electron/main";
import { WebSocketServer } from "ws";
import {
    GAME_RUNTIME_PROTOCOL,
    type GameRuntimePackV1,
} from "@shared/types/gameRuntime";
import { getMimeType } from "@shared/utils/fs";
import {
    resolveRuntimeAssetPath,
    resolveRuntimeStaticPath,
} from "./runtimeProtocol";
import { injectRuntimeCsp, installRuntimeNetworkPolicy } from "./networkPolicy";
import {
    RuntimePersistenceStore,
    RuntimeSaveStore,
} from "./runtimeStorage";

const appDir = __dirname;
const packPath = path.join(appDir, "pack.json");
const userDataDir = path.resolve(appDir, "..", "userData");

let packPromise: Promise<GameRuntimePackV1> | null = null;
let mainWindow: BrowserWindow | null = null;
let controlServer: WebSocketServer | null = null;

protocol.registerSchemesAsPrivileged([
    {
        scheme: GAME_RUNTIME_PROTOCOL,
        privileges: {
            standard: true,
            secure: true,
            supportFetchAPI: true,
            corsEnabled: true,
        },
    },
]);

app.setPath("userData", userDataDir);

void app.whenReady().then(async () => {
    const pack = await readPack();
    const allowHttp = pack.network?.allowHttp === true;
    applyRuntimeAppIdentity(pack);
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

app.on("before-quit", () => {
    controlServer?.close();
    controlServer = null;
});

async function readPack(): Promise<GameRuntimePackV1> {
    if (!packPromise) {
        packPromise = fs.readFile(packPath, "utf-8").then(raw => JSON.parse(raw) as GameRuntimePackV1);
    }
    return packPromise;
}

function createWindow(pack: GameRuntimePackV1): BrowserWindow {
    const size = resolveInitialWindowSize(pack);
    const icon = createProjectIcon(pack);
    const win = new BrowserWindow({
        title: pack.project.name,
        width: size.width,
        height: size.height,
        minWidth: 480,
        minHeight: 320,
        center: true,
        frame: true,
        ...(icon ? { icon } : {}),
        backgroundColor: "#000000",
        webPreferences: {
            preload: path.join(appDir, "preload.js"),
            contextIsolation: true,
        },
    });
    win.setTitle(pack.project.name);
    win.on("closed", () => {
        if (mainWindow === win) {
            mainWindow = null;
        }
    });
    win.webContents.on("before-input-event", (_event, input) => {
        if (input.type === "keyUp" && input.key === "F12") {
            if (win.webContents.isDevToolsOpened()) {
                win.webContents.closeDevTools();
            } else {
                win.webContents.openDevTools({ mode: "detach" });
            }
        }
    });
    return win;
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
    const surfaceId = pack.entry.kind === "surface" ? pack.entry.surfaceId : null;
    const surface = surfaceId
        ? pack.bundle.ui.uidoc.surfaces.find(item => item.id === surfaceId)
        : pack.bundle.ui.uidoc.surfaces.find(item => item.kind === "appSurface");
    const width = surface?.designSize.width;
    const height = surface?.designSize.height;
    if (Number.isFinite(width) && Number.isFinite(height) && width! > 0 && height! > 0) {
        return { width: Math.round(width!), height: Math.round(height!) };
    }
    return { width: 1280, height: 720 };
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
                return serveFile(resolveRuntimeStaticPath(appDir, pathname));
            }
            if (url.hostname === "pack") {
                return serveFile(packPath, "application/json");
            }
            if (url.hostname === "asset") {
                const assetId = decodeURIComponent(url.pathname.replace(/^\/+/, ""));
                return serveFile(resolveRuntimeAssetPath(appDir, await readPack(), assetId));
            }
            return new Response("Not found", { status: 404 });
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return new Response(message, { status: 404 });
        }
    });
}

async function serveFile(filePath: string, contentType = getMimeType(filePath)): Promise<Response> {
    const data = await fs.readFile(filePath);
    return new Response(new Uint8Array(data), {
        status: 200,
        headers: {
            "Content-Type": contentType,
            "Cache-Control": "no-store",
        },
    });
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
    const saves = new RuntimeSaveStore(userDataDir);
    const persistence = new RuntimePersistenceStore(userDataDir);

    ipcMain.handle("runtime:read-pack", () => readPack());
    ipcMain.handle("runtime:close", () => {
        app.quit();
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
