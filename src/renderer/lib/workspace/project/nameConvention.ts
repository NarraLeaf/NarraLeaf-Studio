import { splitAssetStorageId } from "@shared/utils/assetStorageId";
export { isValidAssetStorageId } from "@shared/utils/assetStorageId";
import { AssetType } from "../services/assets/assetTypes";

export const ProjectNameConvention = {
    // Project Root Files
    // .nlproj is the primary format (msgpack-encoded); project.json is legacy
    ProjectConfig: ["project.json"],
    ProjectConfigLegacy: ["project.json"],
    
    // Assets metadata and groups (stored in assets/)
    AssetsMetadataShard: (type: AssetType) => ["assets", `assets.metadata.${type}.json` as const],
    AssetsGroupsShard: (type: AssetType) => ["assets", `assets.groups.${type}.json` as const],

    // Project Root Directories
    NLCache: [".nlstudio/"],
    Plugins: [".nlstudio", "plugins/"],
    EditorConfig: [".nlstudio", "editor.json"],

    Assets: ["assets/"],
    /** Reserved logical folder for shared blueprints; M2 persists bytes via {@link AssetsDataShard} like other assets. */
    AssetsBlueprints: ["assets", "blueprints/"],
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
    EditorThumbnailCacheShard: (id: string) => {
        const safeId = encodePathSegmentId(id);
        return ["editor", "cache", "thumbnail", ...splitEncodedPathSegmentId(safeId), `${safeId}.png` as const];
    },
    EditorUI: ["editor", "ui/"],
    EditorUIDocument: ["editor", "ui", "uidoc.json"],
    EditorUIGraphs: ["editor", "ui", "uigraphs.json"],
    EditorStory: ["editor", "story/"],
    EditorStoryStories: ["editor", "story", "stories/"],
    EditorStoryIndex: ["editor", "story", "index.json"],
    EditorStoryDocument: (storyId: string) => ["editor", "story", "stories", storyId, "storydoc.json"],
} as const;

/**
 * Split UUID or hash into path segments for storage
 * UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars with dashes)
 * Hash format: 64 hex characters
 */
function splitId(id: string): [string, string, string] {
    return splitAssetStorageId(id);
}

function splitEncodedPathSegmentId(id: string): [string, string, string] {
    return [
        id.slice(0, 2) || "id",
        id.slice(2, 4) || "id",
        id.slice(4) || "empty",
    ];
}


/**
 * Encode untrusted ids before embedding them in editor-cache path segments.
 * Asset ids can originate from project metadata, so keep every emitted
 * character inside a conservative filename alphabet and avoid path
 * separators, absolute paths, and traversal-only segments.
 */
function encodePathSegmentId(id: string): string {
    const encoded = Array.from(id)
        .map(char => char.codePointAt(0)?.toString(16).padStart(2, '0') ?? '')
        .join('');

    return `asset-${encoded || 'empty'}`;
}
