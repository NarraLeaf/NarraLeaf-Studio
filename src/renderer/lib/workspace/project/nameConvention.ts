import { AssetType } from "../services/assets/assetTypes";

export const ProjectNameConvention = {
    // Project Root Files
    ProjectConfig: ["project.json"],
    AssetsMetadata: ["assets.metadata.json"],
    AssetsMetadataShard: (type: AssetType) => [`assets.metadata.${type}.json` as const],

    // Project Root Directories
    NLCache: [".nlstudio/"],
    Plugins: [".nlstudio", "plugins/"],
    EditorConfig: [".nlstudio", "editor.json"],

    Assets: ["assets/"],
    Scripts: ["scripts/"],
} as const;

