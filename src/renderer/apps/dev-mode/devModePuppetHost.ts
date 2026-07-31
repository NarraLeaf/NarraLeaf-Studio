/**
 * Finding the author's drawing runtimes and their models from a Dev Mode window.
 *
 * Lifted out of `DevModeContent`'s `listPuppetBackendModules`, unchanged in behaviour, because a second
 * caller appeared: a Surface `nl.puppet` widget mounts a model of its own with no stage in sight, and
 * duplicating this would have produced a Dev Mode where stage puppets draw and widget puppets do not —
 * with the two diverging silently, since only one of them is exercised by launching a story.
 *
 * A Dev Mode window has no workspace services, but it does have the project: `projectPath` plus a
 * recursive read grant on that directory, held since the window opened. So nothing here widens what the
 * preview can reach; every file becomes a single-use `app://fs/{hash}` URL, the same currency assets
 * travel in.
 *
 * Studio ships no renderer and is not allowed to (card 2026-07-27-002). `<project>/runtimes/puppet/<name>/index.js`
 * is the author's own file, installed the way Ren'Py and TyranoScript have authors install the SDKs.
 */

import { AppHost, AppProtocol } from "@shared/types/constants";
import { getInterface } from "@/lib/app/bridge";
import type { PuppetBackendModuleSource } from "@/lib/ui-editor/runtime/game/puppetBackendHost";
import type { SurfacePuppetHost } from "@/lib/ui-editor/runtime/game/surfacePuppetHosts";

const BACKEND_ENTRY_FILE = "index.js";

/**
 * Two read modes, and the difference matters.
 *
 * A raw grant is served as `application/octet-stream`, which the module loader refuses outright
 * ("Expected a JavaScript-or-Wasm module script"), so the entry file has to go through the text path
 * where the handler types it from its extension. Everything the backend asks for afterwards is model
 * data — textures, skeletons — and must stay raw, or the bytes are decoded into a string and ruined.
 */
async function grantUrl(filePath: string, mode: "text" | "raw"): Promise<string> {
    const request = mode === "text"
        ? await getInterface().fs.requestRead(filePath, "utf-8")
        : await getInterface().fs.requestReadRaw(filePath);
    if (!request.success) {
        throw new Error(request.error ?? `Cannot read ${filePath}`);
    }
    if (!request.data.ok) {
        throw new Error(request.data.error.message ?? `Cannot read ${filePath}`);
    }
    return `${AppProtocol}://${AppHost.Fs}/${request.data.data}`;
}

/**
 * The author-supplied backends in an open project, as `loadPuppetBackends` wants them.
 *
 * One directory per runtime under `<project>/runtimes/puppet/`. No such directory is the normal case —
 * most projects use no puppet runtime at all — and comes back empty rather than throwing.
 */
export async function listDevModePuppetBackendModules(
    projectPath: string | null,
): Promise<PuppetBackendModuleSource[]> {
    if (!projectPath) {
        return [];
    }
    const root = `${projectPath}/runtimes/puppet`;
    const listing = await getInterface().fs.list(root);
    if (!listing.success || !listing.data.ok) {
        return [];
    }
    return Promise.all(listing.data.data
        .filter(entry => entry.type === "directory")
        .map(async entry => {
            const directory = `${root}/${entry.fileName}`;
            return {
                id: entry.fileName,
                url: await grantUrl(`${directory}/${BACKEND_ENTRY_FILE}`, "text"),
                resolveFile: (relativePath: string) => {
                    const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
                    // The module names its own siblings; it does not get to name anything else.
                    if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
                        return Promise.reject(new Error(`Path escapes the backend directory: ${relativePath}`));
                    }
                    return grantUrl(`${directory}/${normalized}`, "raw");
                },
            };
        }));
}

/**
 * A model bundle's entry-file URL, through the same IPC the stage's assets use.
 *
 * `devMode.resolveAssetUrl` forwards to the workspace window's resolver, whose `AssetType.Model` arm
 * mints a *directory* grant and returns the entry inside it — which is the only shape
 * `resolveSibling()` arithmetic can work against. Dev Mode then promotes that grant to a session-lived
 * repeatable read, so a model re-fetched after a cache eviction does not 404.
 *
 * Null rather than a throw when it cannot be resolved: to a widget this is `missing-backend`, an empty
 * box, not an error.
 */
export async function resolveDevModeModelBundleUrl(assetId: string): Promise<string | null> {
    const result = await getInterface().devMode.resolveAssetUrl(assetId, "model").catch(() => null);
    return result?.success && result.data?.url ? result.data.url : null;
}

/** The Dev Mode arm of the chain in `surfacePuppetHosts.ts`, bound to one open project. */
export function createDevModePuppetHost(projectPath: string | null): SurfacePuppetHost {
    return {
        kind: "dev-mode",
        listBackendModules: () => listDevModePuppetBackendModules(projectPath),
        resolveModelBundleUrl: resolveDevModeModelBundleUrl,
    };
}
