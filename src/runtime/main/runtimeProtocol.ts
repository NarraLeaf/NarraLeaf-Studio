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

export function resolveRuntimeStaticPath(appDir: string, requestPath: string): string {
    const cleanPath = requestPath === "/" || requestPath === "" ? "index.html" : requestPath;
    return resolveInsideRoot(appDir, cleanPath);
}
