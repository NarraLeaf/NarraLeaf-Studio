/**
 * Finding the drawing runtimes an author put in their project, from the workspace window.
 *
 * Studio ships no puppet backend and is not allowed to (card 2026-07-27-002), so the only authority
 * on what is installed is the folder itself: one directory per backend under `runtimes/puppet/`,
 * each with an `index.js`. Dev Mode already reads it this way to feed the running game; this is the
 * same reading, done from the editor, so an inspector can load a backend without a game being open.
 *
 * Nothing here names a renderer, and the module is loaded exactly as Dev Mode loads it — through a
 * grant on a file the workspace window can already read. It widens nothing: the workspace holds the
 * same recursive read grant on the project directory that Dev Mode does.
 */

import { AppHost, AppProtocol } from "@shared/types/constants";
import { appPrivilegedFacade } from "@/lib/app/privilegedFacade";
import { getInterface } from "@/lib/app/bridge";
import { ProjectNameConvention } from "@/lib/workspace/project/nameConvention";
import type { PuppetBackendModuleSource } from "@/lib/ui-editor/runtime/game/puppetBackendHost";
import type { Porject } from "@/lib/workspace/project/project";

const BACKEND_ENTRY_FILE = "index.js";

/**
 * Two read modes, and the difference matters — the same trap Dev Mode documents.
 *
 * A raw grant is served as `application/octet-stream`, which the module loader refuses outright
 * ("Expected a JavaScript-or-Wasm module script"), so the entry file has to go through the text
 * path where the handler types it from its extension. Everything the backend asks for afterwards is
 * model data and must stay raw, or the bytes are decoded into a string and ruined.
 */
async function grantUrl(filePath: string, mode: "text" | "raw"): Promise<string> {
    const request = mode === "text"
        ? await appPrivilegedFacade.fs.requestRead(filePath, "utf-8")
        : await appPrivilegedFacade.fs.requestReadRaw(filePath);
    if (!request.success) {
        throw new Error(request.error ?? `Cannot read ${filePath}`);
    }
    if (!request.data.ok) {
        throw new Error(request.data.error?.message ?? `Cannot read ${filePath}`);
    }
    return `${AppProtocol}://${AppHost.Fs}/${request.data.data}`;
}

/** The backend names this project carries. Empty is the normal case — most projects use none. */
export async function listProjectPuppetRuntimes(project: Porject): Promise<string[]> {
    const listing = await appPrivilegedFacade.fs.list(project.resolve(ProjectNameConvention.PuppetRuntimes));
    if (!listing.success || !listing.data.ok) {
        return [];
    }
    return listing.data.data
        .filter(entry => entry.type === "directory")
        .map(entry => entry.fileName)
        .sort((left, right) => (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * A stamp that changes when the runtime changes, or null when the runtime is not installed.
 *
 * Size and modification time of the module's own entry file. Not a content hash: this is read on
 * every description lookup, a built backend is megabytes, and the thing it guards against is an
 * author dropping in a new build — which moves both. A runtime edited to the same byte count within
 * the same filesystem timestamp granularity keeps a stale description, and the author can force a
 * re-read; hashing every lookup to close that would cost more than it buys.
 */
export async function readPuppetRuntimeStamp(project: Porject, backend: string): Promise<string | null> {
    const entryPath = project.resolve(ProjectNameConvention.PuppetRuntimes, backend, BACKEND_ENTRY_FILE);
    const details = await appPrivilegedFacade.fs.details(entryPath);
    if (!details.success || !details.data.ok) {
        return null;
    }
    const file = details.data.data;
    return `${file.size}@${file.mtime}`;
}

/**
 * Describe one installed backend the way {@link import("@/lib/ui-editor/runtime/game/puppetBackendHost").loadPuppetBackends}
 * wants it.
 *
 * The `resolveFile` half is what makes a real runtime work at all: a backend needs siblings of its
 * own module — an atlas, a texture page, a WASM core — and it only knows which ones after parsing
 * the first. It gets the arithmetic rather than a list, and the path is confined to the backend's
 * own directory.
 */
export async function createPuppetBackendSource(project: Porject, backend: string): Promise<PuppetBackendModuleSource> {
    const directory = project.resolve(ProjectNameConvention.PuppetRuntimes, backend);
    return {
        id: backend,
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
}

/**
 * Serve a model bundle's directory and hand back the URL of one file inside it.
 *
 * The directory grant is the point. A per-file grant is flat, so every sibling a manifest names
 * would resolve to a different opaque hash and 404 — see the same reasoning in
 * `resolveWorkspaceAssetUrl.resolveModelBundleUrl`, which mints this for the story compiler.
 */
export async function grantModelBundleUrl(bundleRoot: string, entry: string): Promise<string> {
    const grant = await getInterface().fs.requestReadDir(bundleRoot);
    if (!grant.success || !grant.data?.ok) {
        throw new Error(grant.error ?? "Failed to grant access to the model bundle");
    }
    // Each segment is encoded on its own so the separators stay separators - encoding the whole
    // relative path would turn a nested texture into a single opaque segment and break the very
    // sibling arithmetic this URL exists for.
    const encoded = entry.split("/").map(encodeURIComponent).join("/");
    return `${AppProtocol}://${AppHost.Fs}/${grant.data.data}/${encoded}`;
}
