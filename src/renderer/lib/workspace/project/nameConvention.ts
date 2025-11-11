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
    AssetsDataShard: (hash: string) => ["assets", "content", ...splitHash(hash)],
    Scripts: ["scripts/"],
} as const;

function splitHash(hash: string): [string, string, string] {
    if (hash.length < 4) {
        // If hash is too short, pad it or use fallback
        const padded = hash.padEnd(4, '0');
        return [padded.slice(0, 2), padded.slice(2, 4), hash];
    }
    const charsA = hash.slice(0, 2);
    const charsB = hash.slice(2, 4);
    const rest = hash.slice(4);
    // Ensure rest is not empty to avoid directory paths
    return [charsA, charsB, rest || hash];
}
