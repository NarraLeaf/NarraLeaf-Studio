import { splitAssetStorageId } from "@shared/utils/assetStorageId";
export { isValidAssetStorageId } from "@shared/utils/assetStorageId";
import { AssetCategory, AssetType } from "../services/assets/assetTypes";

export const ProjectNameConvention = {
    // Project Root Files
    // .nlproj is the primary format (msgpack-encoded); project.json is legacy
    ProjectConfig: ["project.json"],
    ProjectConfigLegacy: ["project.json"],
    
    // Assets metadata and groups (stored in assets/)
    AssetsMetadataShard: (type: AssetType) => ["assets", `assets.metadata.${type}.json` as const],
    /**
     * Folders, sharded by {@link AssetCategory} rather than by type: a folder under "Media" holds
     * audio and video alike, so it cannot belong to either type's file.
     *
     * `image` / `font` / `model` / `other` name the same file they always did, because those
     * categories have exactly one member type with the same id. `media` and `data` are new files;
     * the `audio` / `video` / `json` / `blueprint` shards they were merged from are left on disk
     * untouched (see {@link import("../services/assets/mgr/GroupAssetsManager").GroupAssetsManager}).
     */
    AssetsGroupsShard: (category: AssetCategory) => ["assets", `assets.groups.${category}.json` as const],
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
    AssetsOrderShard: (category: AssetCategory) => ["assets", `assets.order.${category}.json` as const],

    // Project Root Directories
    NLCache: [".nlstudio/"],
    Plugins: [".nlstudio", "plugins/"],
    EditorConfig: [".nlstudio", "editor.json"],
    /**
     * Service stores that hold Studio's own state rather than the author's project -
     * panel layout, toast history, recent colours. Same flat `<namespace>.json` layout
     * as {@link EditorServices}; which of the two a store uses is decided by one table,
     * `@shared/vcs/serviceStores`.
     *
     * Under `.nlstudio/` because that is what `isVersioned` excludes, and the layout
     * being versioned is what made freezing the workspace freeze the author's panels
     * (plan 2026-07-28-002 §4.1).
     */
    StudioServices: [".nlstudio", "services/"],
    /**
     * Scratch space for media that is on its way into the library and not in it yet: the file a
     * conversion writes before the importer copies it in, and the copy of a downloaded file that
     * `RemoteAssetsManager` probes before deciding whether to keep it.
     *
     * Inside the project because that is the only tree the workspace window is allowed to write to
     * (`windowPermissionDeclarations`), and under `.nlstudio/` because the file is scaffolding: it
     * exists for the few seconds between ffmpeg finishing and the asset being copied, and must not
     * be versioned, packaged or backed up.
     *
     * One directory per file rather than one shared folder. The converted file has to keep the
     * author's own name so the asset is called `intro` and not a hex string, and two folders on
     * disk can each hold an `intro.avi`; a shared scratch folder would make the second one collide
     * with the first, which the transcoder refuses (it never overwrites) rather than silently
     * resolving.
     */
    MediaConvertScratch: [".nlstudio", "convert/"],
    MediaConvertScratchDir: (id: string) => [".nlstudio", "convert", id],

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
    /**
     * What each puppet model said about itself the last time one was mounted - its motions, skins
     * and parameters.
     *
     * Derived, and therefore here rather than on the asset record: it is a reading of the model
     * bundle and the author's runtime, and re-reading them reproduces it exactly. Each record
     * carries the fingerprint of the inputs it was taken from, so a file that no longer matches is
     * a miss rather than something to migrate - which is why nothing here is versioned by path.
     *
     * Flat rather than sharded. The id is already a fixed-width digest of the model/runtime pair, a
     * project has as many of these as it has puppet characters, and the two-level shard the
     * thumbnail cache uses is a no-op in practice (every encoded id starts with the same prefix).
     */
    EditorPuppetDescriptionCache: ["editor", "cache", "puppet/"],
    EditorPuppetDescriptionCacheShard: (key: string) =>
        ["editor", "cache", "puppet", `${encodePathSegmentId(key)}.json` as const],
    /**
     * What a probe said about each media asset's bytes: whether the engine can play them, and what
     * to convert them into if not.
     *
     * Derived, like its neighbours here, and belongs under `editor/cache/` for the reason that
     * directory exists: `@shared/vcs/workingSet` excludes it from version control, so this file is
     * never committed, never in a change list, and never a merge conflict about a fact nobody
     * decided. Every entry is reproducible by running ffprobe over the file again.
     *
     * One document rather than a shard per asset. The only reader is a sweep of the whole library,
     * so N reads would buy nothing, and the entries are keyed by content hash - a few hundred short
     * records at most.
     */
    EditorMediaSupportCache: ["editor", "cache", "media/"],
    EditorMediaSupportCacheFile: ["editor", "cache", "media", "support.json"],
    EditorUI: ["editor", "ui/"],
    EditorUIDocument: ["editor", "ui", "uidoc.json"],
    EditorUIGraphs: ["editor", "ui", "uigraphs.json"],
    // Project-level persistent variable registry (M-VAR). Cross-cutting (blueprint + story), so it
    // sits at editor root rather than under ui/ or story/. Not packaged into the product.
    EditorVariableRegistry: ["editor", "variables.json"],
    // The project's audio tracks (the authoring-time mix presets story rows, blueprint sound nodes
    // and widgets point at). Cross-cutting like the variable registry, so it sits at editor root.
    EditorAudioTracks: ["editor", "audio-tracks.json"],
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
