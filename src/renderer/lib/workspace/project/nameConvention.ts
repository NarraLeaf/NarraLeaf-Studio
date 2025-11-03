export const ProjectNameConvention = {
    // Project Root Files
    ProjectConfig: ["project.json"],
    AssetsMetadata: ["assets.metadata.json"],

    // Project Root Directories
    NLCache: [".nlstudio/"],
    Plugins: [".nlstudio", "plugins/"],
    EditorConfig: [".nlstudio", "editor.json"],

    Assets: ["assets/"],
    Scripts: ["scripts/"],
} as const;

