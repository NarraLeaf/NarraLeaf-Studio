/**
 * What kind of thing a repository path holds, coarsely enough to decide whether reading it
 * can teach anyone anything.
 *
 * This exists for **one** consumer: the diff engine's decision about which paths to pull
 * bytes for. A comparison walks a revision's tree and learns every file's path, size and
 * content address without reading a byte; the question this answers is which of those paths
 * are worth turning into bytes. A story document is - it can be parsed and compared field by
 * field. A 200 MB video is not: reading both sides costs 400 MB of main-process memory to
 * produce the sentence "changed, 209715200 -> 209800000 bytes", which the tree already knew.
 *
 * **This is not the media support matrix and must never grow into one.**
 * `shared/utils/mediaSupport.ts` decides whether the engine can PLAY a file, and its
 * judgement is on the pair (container, codec of every stream) read out of an ffprobe report -
 * because a `.mp4` holding H.264 plays and a `.mp4` holding HEVC does not, and no rule
 * written against a file name is right about both. Nothing here is qualified to make that
 * call and nothing here tries to: a class is a guess from the name, used only to pick which
 * diff provider looks at the file, and the provider then confirms the format from the bytes
 * themselves. Being wrong here costs a less specific change row. Being wrong there ships a
 * black rectangle.
 *
 * **Nothing here may import `fs` or `path`.** Same reason as `workingSet.ts`, spelled out at
 * the top of that file: both processes ask this question - main to decide what to read, the
 * renderer to caption what it was given - and a second copy of the table on the other side of
 * the process boundary is drift with a hiding place. Paths arrive as text and are treated as
 * text.
 *
 * The extension lists are **derived from the asset browser's own**
 * (`renderer/lib/workspace/services/assets/assetTypes.ts`, `AssetExtensions`), which cannot be
 * imported here - it is renderer code, and `shared` has no path alias to reach it. So
 * `contentClass.test.ts` reads that file as text and holds every extension it names against
 * this classifier. The divergences are few and each one is spelled out there.
 */

/**
 * A path's kind, as far as comparing two versions of it is concerned.
 *
 * `text` and `unknown` are the two classes whose bytes are worth reading, and they are
 * separate because only one of them is a claim: `text` says a parser has a chance, `unknown`
 * says nobody here recognised the name and the bytes get a look anyway in case they are JSON.
 */
export type ContentClass =
    /** A raster or vector-free still image. */
    | "bitmap"
    | "audio"
    | "video"
    /** A font file - the binary kind. */
    | "font"
    /**
     * A binary file belonging to a model bundle: Cubism's `.moc3`, Spine's `.skel`.
     *
     * A bundle's other files already classify on their own - its textures are `bitmap`, its
     * manifests are `text` - so this covers only the ones Studio deliberately never learns to
     * read. See `shared/utils/modelBundle.ts`, which says so as a rule rather than a backlog.
     */
    | "model"
    /** Source, markup or data that a parser can be pointed at. */
    | "text"
    /** No opinion. The bytes are read anyway; see the note on the type. */
    | "unknown";

/**
 * Extension to class, lowercase and without the dot.
 *
 * Kept as one flat table rather than one set per class so a name cannot be filed under two
 * classes at once - which is how `svg` would have become both an image and a font, following
 * the asset browser, where it legitimately appears under both.
 */
const CLASS_OF_EXTENSION: ReadonlyMap<string, ContentClass> = new Map<string, ContentClass>([
    // Raster stills. `svg` is deliberately absent - see TEXT below.
    ...asEntries("bitmap", [
        "png", "apng", "avif", "jpg", "jpeg", "jpe", "jfif", "pjpeg", "pjp",
        "bmp", "dib", "gif", "webp", "tif", "tiff", "ico", "cur", "xbm",
    ]),
    ...asEntries("audio", [
        "mp3", "wav", "wave", "ogg", "oga", "opus", "aac", "m4a", "flac", "weba", "mka",
        "aiff", "aif", "aifc", "mp2",
    ]),
    // `ts` is deliberately absent - see the note below.
    ...asEntries("video", [
        "mp4", "m4v", "m4b", "m4r", "mov", "qt", "webm", "mkv",
        "3gp", "3g2", "f4v", "ogv", "ogm", "ogx",
        "avi", "flv", "wmv", "asf", "mpg", "mpeg", "mpe", "mpv", "m2v", "m2ts", "mts", "m2t", "vob",
    ]),
    ...asEntries("font", ["ttf", "otf", "ttc", "otc", "woff", "woff2", "eot"]),
    /**
     * Model binaries. Cubism's runtime model and motion files, Spine's binary skeleton.
     *
     * `.atlas` is text and `.model3.json` is JSON, so neither is here - they land on `text`
     * and get read like any other manifest.
     */
    ...asEntries("model", ["moc", "moc3", "can3", "mtn", "skel", "cmo3", "cmox"]),
    ...asEntries("text", [
        // Everything Studio itself writes.
        "json", "jsonc", "nlbp", "nlproj",
        // The author's own notes and data.
        "txt", "md", "markdown", "csv", "tsv", "xml", "yml", "yaml", "ini", "toml", "cfg",
        "log", "atlas",
        // Translation exchange formats - see shared/utils/localizationExchange.ts.
        "po", "pot", "xliff", "xlf", "srt", "vtt",
        // Source, in a project directory that can hold the author's own build scripts.
        "js", "cjs", "mjs", "jsx", "ts", "tsx", "html", "htm", "css", "scss", "glsl", "frag", "vert",
        /**
         * SVG, which the asset browser files under BOTH image and font.
         *
         * It is neither here. An SVG is XML: two versions of one differ in text, a structural
         * or line comparison of them says something an author can act on, and a header probe
         * would report nothing at all. Filing it as a bitmap would stop it being read for the
         * sake of dimensions no parser here extracts.
         */
        "svg",
    ]),
    /**
     * `ts` is TEXT and not video, and the collision is worth naming.
     *
     * The asset browser lists `ts` as an MPEG transport stream, and in a file picker that is
     * right. In a repository it is not: a project directory can hold the author's own
     * TypeScript, and MPEG-TS is on the browser's own "visible in the picker, refused on
     * import" list because Chromium has no demuxer for it - so it can never be a working game
     * asset in the first place. Classifying it as video would leave an author's source file
     * unread and described by its size.
     */
]);

function asEntries(contentClass: ContentClass, extensions: readonly string[]): [string, ContentClass][] {
    return extensions.map((extension) => [extension, contentClass]);
}

/**
 * The lowercase extension of a path, without the dot, or `""` when it has none.
 *
 * A leading dot is a whole file name (`.gitignore`), not an extension, which is why the
 * index has to be past zero within the last segment.
 */
export function extensionOf(repositoryRelativePath: string): string {
    const name = repositoryRelativePath.replace(/\\/g, "/").split("/").pop() ?? "";
    const dot = name.lastIndexOf(".");
    return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/** What kind of thing this path holds. `unknown` is an ordinary answer. */
export function contentClassOf(repositoryRelativePath: string): ContentClass {
    return CLASS_OF_EXTENSION.get(extensionOf(repositoryRelativePath)) ?? "unknown";
}

/**
 * Whether a comparison should pull this path's whole contents.
 *
 * The rule is "reading it can change the answer", not "it might be interesting". A `text`
 * path is read because a parser can be pointed at it; an `unknown` path is read because it
 * may well be JSON under a name nobody listed. The five media classes are not, because
 * nothing in Studio parses a whole video, and the answer for them - what the header says,
 * plus both sizes - is reachable from the tree and a few kilobytes.
 */
export function contentClassIsReadable(contentClass: ContentClass): boolean {
    return contentClass === "text" || contentClass === "unknown";
}
