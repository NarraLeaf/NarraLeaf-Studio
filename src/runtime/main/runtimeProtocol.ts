import path from "path";
import type { GameRuntimePackV1 } from "@shared/types/gameRuntime";

export function resolveInsideRoot(root: string, relativePath: string): string {
    const normalizedRoot = path.resolve(root);
    const resolved = path.resolve(normalizedRoot, relativePath.replace(/^[/\\]+/, ""));
    if (resolved !== normalizedRoot && !resolved.startsWith(normalizedRoot + path.sep)) {
        throw new Error("Resolved path escapes runtime root");
    }
    return resolved;
}

export function resolveRuntimeAssetPath(appDir: string, pack: GameRuntimePackV1, assetId: string): string {
    const id = String(assetId ?? "").trim();
    if (!id) {
        throw new Error("Asset id is required");
    }
    const item = pack.assets.items[id];
    if (!item) {
        throw new Error(`Runtime asset not found: ${id}`);
    }
    return resolveInsideRoot(appDir, item.relativePath);
}

/**
 * Turn a request against a model bundle into the manifest key that actually holds the bytes, or
 * null when this is an ordinary asset request and needs no help.
 *
 * Three request shapes arrive for one bundle, and all three are keyed off the id alone - which is
 * the point: a shipped pack says which ids are bundles and nothing else about them, so everything
 * here is derived or fetched by id rather than read from a table.
 *
 * - `{id}/` is the mount. The engine is handed the bundle's directory rather than its entry file, so
 *   nothing shipped has to name the entry; the path is fetched from the payload by id.
 * - `{id}` is the same request without the slash - what a caller holding only an id builds, such as
 *   the surface preloader, or a story asset resolved before the puppet seam sees it.
 * - `{id}/{rel}` is a sibling the model's own manifest named. It normally resolves directly and
 *   reaches here only when it did not: a bundle whose entry sits in a subdirectory has its
 *   references written relative to *that* directory, so the entry's directory is tried as a second
 *   root. That fallback is what lets the mount URL be `{id}/` for a nested bundle too, and so what
 *   lets the entry path stay out of the pack entirely.
 *
 * `readEntry` is injected rather than reached for: where the entry path lives differs between a
 * protected payload and a loose one, and this has no business knowing which it is talking to.
 */
export async function resolveModelBundleKey(
    pack: GameRuntimePackV1,
    assetId: string,
    readEntry: (assetId: string) => Promise<string | null>,
): Promise<string | null> {
    const models = pack.assets.modelBundles;
    if (!models || models.length === 0 || !assetId) {
        return null;
    }
    const mounted = assetId.endsWith("/") ? assetId.slice(0, -1) : assetId;
    if (models.includes(mounted)) {
        const entry = await readEntry(mounted);
        return entry ? `${mounted}/${entry}` : null;
    }
    const slash = assetId.indexOf("/");
    if (slash <= 0 || !models.includes(assetId.slice(0, slash))) {
        return null;
    }
    const id = assetId.slice(0, slash);
    const entry = await readEntry(id);
    const entryDir = entry && entry.includes("/") ? entry.slice(0, entry.lastIndexOf("/")) : "";
    // A root-level entry means the sibling was already addressed correctly and simply is not there,
    // which is the caller's 404 to report rather than a second guess for this to make.
    return entryDir ? `${id}/${entryDir}/${assetId.slice(slash + 1)}` : null;
}

export function resolveRuntimeStaticPath(appDir: string, requestPath: string): string {
    const cleanPath = requestPath === "/" || requestPath === "" ? "index.html" : requestPath;
    return resolveInsideRoot(appDir, cleanPath);
}
