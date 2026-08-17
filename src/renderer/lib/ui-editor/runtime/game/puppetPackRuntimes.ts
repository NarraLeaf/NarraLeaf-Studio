/**
 * Finding the author's drawing runtimes in a packaged game, and the model bundles they draw.
 *
 * The packaged counterpart of the workspace's `projectPuppetRuntimes.ts`: the same two answers (which
 * module is the backend, which URL is the model's entry file) resolved against the pack instead of
 * against a project directory. Two callers need them and they must not drift — the stage, where
 * `GameApp` registers backends before the `Player` mounts, and a Surface `nl.puppet` widget, which
 * mounts a model of its own with no stage in sight.
 *
 * Studio ships no renderer and is not allowed to. Everything here is the author's
 * own file, published with their game by `copyPuppetRuntimes` in `gameRuntimeArtifactCompiler.ts`.
 */

import type { GameRuntimePackV1, GameRuntimePreloadBridge } from "@shared/types/gameRuntime";
import type { PuppetBackendModuleSource } from "@/lib/ui-editor/runtime/game/puppetBackendHost";

/**
 * Whichever scheme this shell serves the app directory over — `nlgame://runtime/…` on desktop, a
 * relative URL on the web export. The fallback matters only if a bridge is somehow absent, and keeping
 * the desktop scheme there is the same choice the loading path has always made.
 */
function packUrl(bridge: GameRuntimePreloadBridge | null, relativePath: string): string {
    return bridge?.pluginEntryUrl(relativePath) ?? `nlgame://runtime/${relativePath}`;
}

/**
 * Turn one published runtime entry into a loadable module source.
 *
 * `resolveFile` stays confined to the backend's own directory, exactly as the editor's does — a module
 * names its own siblings and nothing else.
 */
function packBackendSource(
    bridge: GameRuntimePreloadBridge | null,
    runtime: NonNullable<GameRuntimePackV1["puppetRuntimes"]>[number],
): PuppetBackendModuleSource {
    const directory = runtime.entryRelativePath.slice(0, runtime.entryRelativePath.lastIndexOf("/"));
    return {
        id: runtime.name,
        url: packUrl(bridge, runtime.entryRelativePath),
        resolveFile: (relativePath: string) => {
            const normalized = relativePath.replace(/\\/g, "/").replace(/^\.\//, "");
            if (normalized.startsWith("/") || normalized.split("/").includes("..")) {
                return Promise.reject(new Error(`Path escapes the backend directory: ${relativePath}`));
            }
            return Promise.resolve(packUrl(bridge, `${directory}/${normalized}`));
        },
    };
}

/** Every backend published with this game, in pack order. Empty is the normal case. */
export function listPackPuppetBackendSources(
    bridge: GameRuntimePreloadBridge | null,
    pack: GameRuntimePackV1 | null,
): PuppetBackendModuleSource[] {
    return (pack?.puppetRuntimes ?? []).map(runtime => packBackendSource(bridge, runtime));
}

/** One named backend, or null when this game published none under that name. */
export function findPackPuppetBackendSource(
    bridge: GameRuntimePreloadBridge | null,
    pack: GameRuntimePackV1 | null,
    backend: string,
): PuppetBackendModuleSource | null {
    const runtime = (pack?.puppetRuntimes ?? []).find(entry => entry.name === backend);
    return runtime ? packBackendSource(bridge, runtime) : null;
}

/**
 * The URL of a model bundle's *entry file*, not of the asset id.
 *
 * The engine's `PuppetMountContext.resolveSibling(rel)` does URL arithmetic against whatever this
 * returns to find the bundle's textures and motions, which the model's own manifest names by relative
 * path. `.../asset/{id}` would make every one of those resolve to a sibling of the id;
 * `.../asset/{id}/{entry}` makes them resolve to `{id}/{rel}`, which is exactly the key the packer wrote
 * for each file.
 *
 * Read from `assets.bundleEntries` rather than from the manifest, because the manifest is not there
 * to read in a shipped protected game — that table is the one thing about its assets a pack still
 * states, and it states it for model bundles alone.
 *
 * Null when the id names no model bundle: either it is an ordinary asset, or it is a model that was
 * removed after the widget referenced it. Both callers answer null by falling back to the plain
 * asset URL, so the two cases stay indistinguishable here on purpose.
 */
export function resolvePackModelBundleUrl(
    bridge: GameRuntimePreloadBridge | null,
    pack: GameRuntimePackV1 | null,
    assetId: string,
): string | null {
    if (!bridge) {
        return null;
    }
    const bundleEntry = pack?.assets.bundleEntries?.[assetId];
    if (!bundleEntry) {
        return null;
    }
    return bridge.assetUrl(`${assetId}/${bundleEntry}`);
}
