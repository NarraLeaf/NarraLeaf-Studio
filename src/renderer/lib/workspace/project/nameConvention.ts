import { AssetType } from "../services/assets/assetTypes";

export const ProjectNameConvention = {
    // Project Root Files
    ProjectConfig: ["project.json"],
    
    // Assets metadata and groups (stored in assets/)
    AssetsMetadataShard: (type: AssetType) => ["assets", `assets.metadata.${type}.json` as const],
    AssetsGroupsShard: (type: AssetType) => ["assets", `assets.groups.${type}.json` as const],

    // Project Root Directories
    NLCache: [".nlstudio/"],
    Plugins: [".nlstudio", "plugins/"],
    EditorConfig: [".nlstudio", "editor.json"],

    Assets: ["assets/"],
    AssetsContent: ["assets", "content/"],
    AssetsDataShard: (id: string) => ["assets", "content", ...splitId(id)],
    Scripts: ["scripts/"],

    // Editor Related Files
    // These files are not packaged into the product
    Editor: ["editor/"],
    EditorAssets: ["editor", "assets/"],
    EditorServices: ["editor", "services/"],
    EditorRemoteAssetsCache: ["editor", "assets", "remote/"],
    EditorRemoteAssetShard: (id: string) => ["editor", "assets", "remote", ...splitId(id)],
    EditorThumbnailCache: ["editor", "cache", "thumbnail/"],
    EditorThumbnailCacheShard: (id: string) => ["editor", "cache", "thumbnail", ...splitId(id), `${id}.png` as const],
    EditorUI: ["editor", "ui/"],
    EditorUIDocument: ["editor", "ui", "uidoc.json"],
    EditorUIGraphs: ["editor", "ui", "uigraphs.json"],
} as const;

/**
 * Split UUID or hash into path segments for storage
 * UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with dashes)
 * Hash format: 64 hex characters
 */
function splitId(id: string): [string, string, string] {
    // Remove dashes if it's a UUID (UUIDs contain dashes)
    const cleanId = id.replace(/-/g, '');
    
    if (cleanId.length < 4) {
        // If id is too short, pad it or use fallback
        const padded = cleanId.padEnd(4, '0');
        return [padded.slice(0, 2), padded.slice(2, 4), id];
    }
    const charsA = cleanId.slice(0, 2);
    const charsB = cleanId.slice(2, 4);
    const rest = cleanId.slice(4);
    // Ensure rest is not empty to avoid directory paths
    return [charsA, charsB, rest || id];
}
