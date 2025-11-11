import { AssetType } from "../services/assets/assetTypes";

export const ProjectNameConvention = {
    // Project Root Files
    ProjectConfig: ["project.json"],
    AssetsMetadataShard: (type: AssetType) => [`assets.metadata.${type}.json` as const],

    // Project Root Directories
    NLCache: [".nlstudio/"],
    Plugins: [".nlstudio", "plugins/"],
    EditorConfig: [".nlstudio", "editor.json"],

    Assets: ["assets/"],
    AssetsDataShard: (hash: string) => ["assets", ...splitHash(hash)],
    Scripts: ["scripts/"],
} as const;

function splitHash(hash: string): [string, string, string] {
    const charsA = hash.slice(0, 2);
    const charsB = hash.slice(2, 4);
    const rest = hash.slice(4);
    return [charsA, charsB, rest];
}
