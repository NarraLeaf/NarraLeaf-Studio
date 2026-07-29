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
    /**
     * Row order for the two shards above, which are ordered maps: the asset browser draws them in
     * key order and shift-range selection slices that order, so canonical serialization — which
     * sorts object keys — would silently rearrange the library.
     *
     * A sibling rather than a field inside those shards, because the shards are also read by the
     * Dev Mode bundler and the runtime packer, and by every Studio ever shipped. All of them parse
     * the file's top level as `{ id: record }`. Moving the records down a level to make room for an
     * array would empty the asset library on any build that has not been taught the new shape, and
     * an author who opens their project to an empty library re-imports everything. A file nobody
     * else looks for costs those readers nothing.
     */
    AssetsOrderShard: (type: AssetType) => ["assets", `assets.order.${type}.json` as const],

    // Project Root Directories
    NLCache: [".nlstudio/"],
    Plugins: [".nlstudio", "plugins/"],
    EditorConfig: [".nlstudio", "editor.json"],

    Assets: ["assets/"],
    ProjectResources: ["resources/"],
    ProjectIcons: ["resources", "icons/"],
    /** The images the author supplied: the master, plus any per-target override. */
    ProjectIconSources: ["resources", "icons", "source/"],
    ProjectIconSource: (slot: string, ext: string) => ["resources", "icons", "source", `${slot}.${ext}` as const],
    /**
     * The baked per-target PNGs. Under `resources/` on purpose: these are project
     * content, not cache - they ride along in the .nlspkg and belong in version
     * control, which is also why the bake never rewrites an unchanged file.
     */
    ProjectIconDerived: ["resources", "icons", "derived/"],
    ProjectIconDerivedFile: (fileName: string) => ["resources", "icons", "derived", fileName],
    /** Reserved logical folder for shared blueprints; M2 persists bytes via {@link AssetsDataShard} like other assets. */
    AssetsBlueprints: ["assets", "blueprints/"],
    AssetsContent: ["assets", "content/"],
    AssetsDataShard: (id: string) => ["assets", "content", ...splitId(id)],
    Scripts: ["scripts/"],
    /**
     * Author-supplied drawing runtimes for the engine's puppet seam — one directory per backend,
     * each with an `index.js`. Studio ships none and is not allowed to (card 2026-07-27-002), so
     * this is where the author puts theirs, the way Ren'Py and TyranoScript ask for an SDK.
     */
    PuppetRuntimes: ["runtimes", "puppet/"],

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
    // Project-level persistent variable registry (M-VAR). Cross-cutting (blueprint + story), so it
    // sits at editor root rather than under ui/ or story/. Not packaged into the product.
    EditorVariableRegistry: ["editor", "variables.json"],
    EditorStory: ["editor", "story/"],
    EditorStoryStories: ["editor", "story", "stories/"],
    EditorStoryIndex: ["editor", "story", "index.json"],
    EditorStoryDocument: (storyId: string) => ["editor", "story", "stories", storyId, "storydoc.json"],
    EditorStoryAnimations: ["editor", "story", "animations/"],
    EditorStoryAnimationIndex: ["editor", "story", "animations", "index.json"],
    EditorStoryAnimationDocument: (animationId: string) => ["editor", "story", "animations", `${animationId}.json`],
    // Game localization translation library (one document per locale).
    // Locale codes are validated against a conservative alphabet (see
    // isValidLocaleCode in @shared/types/localization) before touching disk.
    EditorLocalization: ["editor", "localization/"],
    EditorLocalizationDocument: (locale: string) => ["editor", "localization", `${locale}.json`],
    EditorLocalizationKeys: ["editor", "localization", "keys.json"],
    // Game voice library (one document per voice language). Locale codes are
    // validated against the same conservative alphabet as localization before
    // touching disk (see isValidLocaleCode in @shared/types/voice).
    EditorVoice: ["editor", "voice/"],
    EditorVoiceDocument: (locale: string) => ["editor", "voice", `${locale}.json`],
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
