import {
    GAME_RUNTIME_BRIDGE_KEY,
    type GameRuntimePackV1,
    type GameRuntimePreloadBridge,
} from "@shared/types/gameRuntime";
import { resolveDeclaredExternalLink } from "@shared/types/blueprint/externalLink";
import { executeBlueprintNetworkFetch } from "@shared/utils/blueprintNetworkFetch";
import { WebGameStorage } from "./webStorage";

/**
 * Web runtime shell. Loaded by the exported index.html BEFORE renderer.js, it
 * installs a browser-native implementation of the runtime bridge on
 * `window.__NLS_GAME_RUNTIME__` - the renderer bundle is byte-identical to the
 * desktop one and only talks to this contract. Everything the desktop shell
 * does in its Electron main process maps onto web platform features here:
 * pack.json and assets are plain relative fetches served by whatever static
 * host the export was uploaded to, and saves/persistence live in IndexedDB.
 */

let loadedPack: GameRuntimePackV1 | null = null;
let packPromise: Promise<GameRuntimePackV1> | null = null;
let storagePromise: Promise<WebGameStorage> | null = null;

function readPack(): Promise<GameRuntimePackV1> {
    packPromise ??= (async () => {
        const response = await fetch("./pack.json", { cache: "no-cache" });
        if (!response.ok) {
            throw new Error(`Failed to load pack.json (HTTP ${response.status})`);
        }
        const pack = await response.json() as GameRuntimePackV1;
        loadedPack = pack;
        return pack;
    })();
    return packPromise;
}

/**
 * Same lifetime rule as the desktop shell's resolveAssetVersion: asset ids are
 * stable across recompiles, so cache entries are keyed per pack via the
 * bundle id. Before the pack is loaded there is nothing to version against -
 * callers below only run after readPack() resolves.
 */
function assetVersion(): string {
    const bundleId = String(loadedPack?.bundle?.bundleId ?? "").trim();
    return bundleId || loadedPack?.generatedAt || "0";
}

function encodeRelativePath(relativePath: string): string {
    return relativePath.split("/").map(segment => encodeURIComponent(segment)).join("/");
}

function assetUrl(assetId: string): string {
    const id = String(assetId ?? "");
    const entry = loadedPack?.assets.items[id];
    if (!entry) {
        // readPack() resolves before the renderer asks for any asset, so this
        // only fires for ids missing from the manifest; the fetch then 404s
        // and surfaces through the renderer's own asset failure handling.
        console.warn(`[GameRuntime] No manifest entry for asset "${id}"`);
        return `./assets/${encodeURIComponent(id)}?v=${encodeURIComponent(assetVersion())}`;
    }
    return `./${encodeRelativePath(entry.relativePath)}?v=${encodeURIComponent(assetVersion())}`;
}

function pluginEntryUrl(entryRelativePath: string): string {
    // The "./" prefix is load-bearing: plugin entries reach the browser
    // through dynamic import(), where a bare "plugins/…" specifier is treated
    // as an unresolvable module name rather than a relative URL.
    return `./${encodeRelativePath(entryRelativePath)}?v=${encodeURIComponent(assetVersion())}`;
}

function getStorage(): Promise<WebGameStorage> {
    storagePromise ??= readPack().then(pack => {
        // IndexedDB database names are arbitrary strings; keying by project
        // identity isolates games that share an origin (e.g. one itch.io or
        // GitHub Pages account hosting several exports).
        const identity = pack.project.identifier?.trim() || pack.project.name?.trim() || "game";
        return new WebGameStorage(`narraleaf-game:${identity}`);
    });
    return storagePromise;
}

const consoleSinks = {
    info: console.info.bind(console),
    warning: console.warn.bind(console),
    error: console.error.bind(console),
} as const;

const bridge: GameRuntimePreloadBridge = {
    readPack,
    assetUrl,
    pluginEntryUrl,
    log: (level, message) => {
        (consoleSinks[level] ?? consoleSinks.info)(`[GameRuntime] ${message}`);
    },
    close: async () => {
        // A browser only honors close() for windows a script opened; when it
        // refuses there is nothing else a static page may do, so Quit
        // Application degrades to a no-op with a hint in the console.
        window.close();
        console.info("[GameRuntime] Quit requested; close the tab to exit the game.");
    },
    getFullscreen: async () => document.fullscreenElement != null,
    setFullscreen: async (fullscreen: boolean) => {
        // Browsers gate requestFullscreen behind a user gesture; a rejected
        // call (e.g. from an autorun blueprint) is a warning, not a crash.
        try {
            if (fullscreen) {
                if (!document.fullscreenElement) {
                    await document.documentElement.requestFullscreen();
                }
            } else if (document.fullscreenElement) {
                await document.exitFullscreen();
            }
        } catch (error) {
            console.warn("[GameRuntime] Fullscreen change rejected by the browser", error);
        }
    },
    onFullscreenChanged: listener => {
        const handler = () => listener(document.fullscreenElement != null);
        document.addEventListener("fullscreenchange", handler);
        return () => document.removeEventListener("fullscreenchange", handler);
    },
    // The browser owns tab/window closing and won't let a page reliably intercept it (beforeunload
    // is synchronous and heavily restricted), so there is no host-driven close request on the web:
    // registering a handler is a no-op and the blueprint close event simply never fires here.
    onCloseRequested: () => () => undefined,
    // Says out loud what the no-op above implies, so callers gate on it instead of registering a
    // handler that can never run (runtime plugins surface it as events.available("closeRequested")).
    capabilities: { closeRequested: false },
    // A page has no channel that arrives before its own scripts, so this build cannot answer until
    // the pack has been fetched. `null` says exactly that, and the renderer keeps its default
    // until `readPack` resolves rather than treating unknown as an answer.
    crashPolicy: null,
    // No log file at all here: this shell prints to the browser console, so there is no path a
    // crash screen could send anyone to.
    logPath: null,
    save: {
        write: async (id, savedGame, capture, metadata) =>
            (await getStorage()).writeSave(id, savedGame, capture, metadata),
        read: async id => (await getStorage()).readSave(id),
        listIds: async () => (await getStorage()).listSaveIds(),
        readPreview: async id => (await getStorage()).readSavePreview(id),
        delete: async id => (await getStorage()).deleteSave(id),
    },
    persistence: {
        getAll: async () => (await getStorage()).getAllPersistence(),
        getValue: async key => (await getStorage()).getPersistenceValue(key),
        setValue: async (key, value) => (await getStorage()).setPersistenceValue(key, value),
        removeValue: async key => (await getStorage()).removePersistenceValue(key),
    },
    /**
     * The Fetch node, on a page.
     *
     * Present rather than stubbed, unlike `sidecar` below: a browser can make an HTTP request, so
     * refusing would deny something this shell can genuinely do.
     *
     * Two differences from the desktop shells are inherent to being a page, not gaps to be closed
     * later, and both are documented for authors:
     *
     *  - **CORS applies.** The request carries this page's origin, so an endpoint that sends no
     *    `Access-Control-Allow-Origin` fails here and succeeds on desktop. Reported as a
     *    `networkError`, which is what it is.
     *  - **The project's Allow HTTP setting does not.** It is enforced by a CSP and a `webRequest`
     *    hook that only a desktop shell has, and a web export's pack carries no `network` block at
     *    all (see `gameRuntimeArtifactCompiler`). A game served over HTTP(S) is already on the
     *    network by construction. The build gate still refuses to produce a web build from a project
     *    that has network nodes with the setting off, so reaching this code in that state is not
     *    possible through a build.
     */
    network: {
        fetch: async request => executeBlueprintNetworkFetch(request, { allowHttp: true }),
    },
    /**
     * The Open Link node, on a page.
     *
     * The check is made here because here is where the act happens: a static site has no process
     * behind it, so "the same process that would perform it" is this one. It reads the same pack
     * field the desktop shell reads and refuses the same addresses - which is why the field is not
     * part of `pack.network`, a block a web export never carries.
     *
     * A popup blocker can still refuse a declared address when the call did not come from a click.
     * That is reported as a failure rather than a refusal: the address is declared, the browser
     * simply did not open it.
     */
    externalLink: {
        open: async request => {
            const pack = await readPack();
            const decision = resolveDeclaredExternalLink(request, pack.externalLinks);
            if (!decision.allowed) {
                console.warn(`[GameRuntime] Open Link refused: ${decision.result.error}`);
                return decision.result;
            }
            const opened = window.open(decision.url, "_blank", "noopener,noreferrer");
            return opened
                ? { outcome: "opened", error: null }
                : { outcome: "failed", error: "The browser did not open the link." };
        },
    },
    // `sidecar` is deliberately absent, not stubbed. A browser has no child
    // processes and never will, so there is no honest no-op: a stub would let a
    // plugin call start() and wait forever for a handshake nothing can answer.
    // Leaving the field off is what removes `app.game.sidecar` on the web export
    // (the runtime plugin host passes no sidecar backend without it), which is
    // the same shape a plugin already handles for a sidecar its platform lacks.
};

window[GAME_RUNTIME_BRIDGE_KEY] = bridge;

// Ask the browser not to evict saves under storage pressure; a denial is fine
// (the data is still there, just not guaranteed durable).
void navigator.storage?.persist?.().catch(() => undefined);

// Same policy as the desktop preload: a stray file drop must not navigate the
// page away from the running game.
const prevent = (event: DragEvent) => {
    event.preventDefault();
};
window.addEventListener("dragover", prevent);
window.addEventListener("drop", prevent);
