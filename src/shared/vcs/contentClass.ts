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
 *
 * **A name is not always available, and in this project it usually is not.** Studio stores an
 * asset's contents under its id, sharded two levels deep and with no extension at all -
 * `assets/content/99/55/3d15abb54213bad7203798a1adc4` - so a table keyed on extensions answers
 * `unknown` for every asset a real project holds. That is why {@link contentClassOfBytes} exists
 * beside the table: the same question, asked of the file's first few dozen bytes.
 */

/**
 * A path's kind, as far as comparing two versions of it is concerned.
 *
 * `text` and `unknown` are the two classes whose bytes are worth reading, and they are
 * separate because only one of them is a claim: `text` says a parser has a chance, `unknown`
 * says neither the name nor the header placed this file and the bytes get a look anyway in case
 * they are JSON.
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

/* ---------------------------------------------------------------------------------------- */
/* The same question, asked of the bytes                                                      */
/* ---------------------------------------------------------------------------------------- */

/**
 * Bytes {@link contentClassOfBytes} needs to answer.
 *
 * The furthest thing it looks at is an ISO base media brand, which sits at offset 8, so this is
 * generous rather than tight - nobody should have to count to call it. A caller that can only
 * get fewer may still pass them: every check below is bounded by the buffer it is handed and a
 * truncated one simply answers `null`.
 */
export const CONTENT_CLASS_SNIFF_BYTES = 64;

/**
 * What kind of thing these bytes are, or `null` for no opinion.
 *
 * **It answers the family, not the format.** That is a different question from the one
 * `shared/utils/mediaHeader.ts` and `shared/utils/imageDimensions.ts` answer, and it is why this
 * is a table of its own rather than a wrapper over theirs: those two walk a container for
 * NUMBERS, over a prefix measured in kilobytes, and neither can tell an `.m4a` from an `.mp4`
 * without reaching a track box that a few dozen bytes never contain. Here the brand at offset 8
 * settles it outright. The two are used one after the other - this picks the provider, the
 * provider reads the header - and being wrong here costs a less specific change row.
 *
 * `text` is deliberately not among the answers. A file this cannot place stays `unknown`, which
 * already means "read the bytes anyway, they may be JSON" - so there is nothing for a text
 * heuristic to add and a wrong one would stop a document being parsed.
 */
export function contentClassOfBytes(head: Uint8Array): ContentClass | null {
    if (head.length < 4) {
        return null;
    }
    // ISO base media first, because it is the most specific test here - four exact characters at
    // a fixed offset - and because its leading box length is four bytes that a weaker signature
    // below could otherwise claim.
    return sniffIsoBmff(head)
        ?? sniffStill(head)
        ?? sniffFont(head)
        ?? sniffRiff(head)
        ?? sniffStream(head);
}

/**
 * The class to describe this file by: its name where that says something, its bytes otherwise.
 *
 * **The name wins whenever it has an answer**, and that ordering is the same one the whole diff
 * engine already runs on: a class is a guess used to pick a provider, and the provider confirms
 * the format from the bytes itself (see `vcs/diff/contentDiff.ts`). So a `.png` holding a JPEG
 * needs nothing from here - both are `bitmap` - while a `.txt` holding PNG bytes stays text and
 * is read, which is what an author who named it that would expect. The bytes only fill a blank.
 */
export function resolveContentClass(repositoryRelativePath: string, head?: Uint8Array | null): ContentClass {
    const named = contentClassOf(repositoryRelativePath);
    if (named !== "unknown" || !head) {
        return named;
    }
    return contentClassOfBytes(head) ?? named;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const EBML_SIGNATURE = [0x1a, 0x45, 0xdf, 0xa3];

/** `length` bytes read as ASCII, or `""` when they are not all there. */
function tag(bytes: Uint8Array, offset: number, length = 4): string {
    if (offset < 0 || offset + length > bytes.length) {
        return "";
    }
    let out = "";
    for (let i = 0; i < length; i += 1) {
        out += String.fromCharCode(bytes[offset + i]);
    }
    return out;
}

function startsWith(bytes: Uint8Array, signature: readonly number[]): boolean {
    return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte);
}

/** Stills that announce themselves at offset zero. WebP and the HEIF family are containers, below. */
function sniffStill(head: Uint8Array): ContentClass | null {
    if (startsWith(head, PNG_SIGNATURE)) {
        return "bitmap";
    }
    if (tag(head, 0, 6) === "GIF87a" || tag(head, 0, 6) === "GIF89a") {
        return "bitmap";
    }
    // Start of image, plus the 0xFF opening the next marker - which every JPEG has and two
    // stray 0xFF bytes in some other file's payload do not.
    if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) {
        return "bitmap";
    }
    if (tag(head, 0, 2) === "II" && head[2] === 0x2a && head[3] === 0x00) {
        return "bitmap";
    }
    if (tag(head, 0, 2) === "MM" && head[2] === 0x00 && head[3] === 0x2a) {
        return "bitmap";
    }
    // A Windows icon (1) or cursor (2), whose type field sits between two pairs of zeroes, with
    // an image count that is never zero. No clash with an sfnt's `00 01 00 00`, whose second byte
    // is the one that is set.
    if (head[0] === 0 && head[1] === 0 && (head[2] === 1 || head[2] === 2) && head[3] === 0
        && head.length >= 6 && head[4] > 0 && head[5] === 0) {
        return "bitmap";
    }
    // "BM" is two bytes and two bytes are not evidence - it is also how a sentence can start -
    // so the four reserved bytes of the file header, zero in anything a tool writes, come too.
    if (tag(head, 0, 2) === "BM" && head.length >= 10
        && head[6] === 0 && head[7] === 0 && head[8] === 0 && head[9] === 0) {
        return "bitmap";
    }
    return null;
}

function sniffFont(head: Uint8Array): ContentClass | null {
    const flavour = tag(head, 0);
    if (flavour === "wOFF" || flavour === "wOF2" || flavour === "ttcf" || flavour === "OTTO" || flavour === "true") {
        return "font";
    }
    // sfnt version 1.0 - the TrueType outline flavour - and embedded OpenType, which is the
    // same two words the other way round.
    if (startsWith(head, [0x00, 0x01, 0x00, 0x00]) || startsWith(head, [0x00, 0x02, 0x00, 0x01])) {
        return "font";
    }
    return null;
}

/** RIFF, whose four-character type is the only thing separating three unrelated formats. */
function sniffRiff(head: Uint8Array): ContentClass | null {
    if (tag(head, 0) !== "RIFF") {
        return null;
    }
    switch (tag(head, 8)) {
        case "WEBP": return "bitmap";
        case "WAVE": return "audio";
        case "AVI ": return "video";
        default: return null;
    }
}

/** Brands that make an ISO base media file a still rather than a movie. */
const ISO_STILL_BRANDS: ReadonlySet<string> = new Set([
    "avif", "avis", "heic", "heix", "heim", "heis", "hevc", "hevx", "mif1", "msf1",
]);
/** Brands that make it a sound file. The trailing space is part of the brand. */
const ISO_SOUND_BRANDS: ReadonlySet<string> = new Set(["M4A ", "M4B ", "M4P ", "F4A ", "F4B "]);

/**
 * MP4 and its relatives, told apart by BRAND rather than by container.
 *
 * One format, three answers: `.m4a`, `.mp4` and `.avif` are all `ftyp` at offset 4, and calling
 * an AVIF a video would hand it to a reader that looks for a track box and reports nothing.
 */
function sniffIsoBmff(head: Uint8Array): ContentClass | null {
    if (tag(head, 4) !== "ftyp") {
        return null;
    }
    const brand = tag(head, 8);
    if (ISO_STILL_BRANDS.has(brand)) {
        return "bitmap";
    }
    if (ISO_SOUND_BRANDS.has(brand)) {
        return "audio";
    }
    // isom, mp41, mp42, qt, 3gp, M4V and the rest: a movie, which is what every one of them is.
    return "video";
}

/** Everything else that leads with a signature. */
function sniffStream(head: Uint8Array): ContentClass | null {
    const leading = tag(head, 0);
    if (leading === "fLaC") {
        return "audio";
    }
    /**
     * Ogg, which in a game project is Vorbis or Opus. A Theora stream would be filed as sound
     * and end up described by its size - the honest price of not reading past the first page,
     * and the same trade the extension table makes by listing `ogg` under audio.
     */
    if (leading === "OggS") {
        return "audio";
    }
    if (tag(head, 0, 3) === "ID3") {
        return "audio";
    }
    if (tag(head, 0, 3) === "FLV" && head[3] === 0x01) {
        return "video";
    }
    if (startsWith(head, EBML_SIGNATURE)) {
        // Matroska and WebM. Whether it carries video is in a track entry far past these bytes,
        // so it is filed as the thing both of those extensions mean.
        return "video";
    }
    if (leading === "MOC3") {
        return "model";
    }
    // An MPEG audio frame sync, which is also the eleven bits ADTS AAC opens with. Last, because
    // it is the weakest test here - eleven set bits and nothing else.
    if (head[0] === 0xff && (head[1] & 0xe0) === 0xe0) {
        return "audio";
    }
    return null;
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
