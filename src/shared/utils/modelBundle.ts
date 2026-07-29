/**
 * The shape rules for a **model bundle**: an asset that is a directory of files rather than one
 * file, imported as a unit and kept exactly as the author's tool wrote it.
 *
 * Everything here is pure and path-only - no filesystem, no format parsing. That is deliberate:
 * Studio must never learn to read `.moc3` or `.skel`. A model's manifest names its siblings by
 * *relative path*, so the only thing Studio has to get right is that the tree survives import and
 * that the entry file's URL is one those relative names resolve against. Which file is the entry is
 * a guess from the file listing, and when the guess is not clear-cut the author is asked instead of
 * being given a wrong answer silently.
 */

/**
 * The families the entry heuristic knows how to name. Purely descriptive - nothing in Studio
 * branches on it, and a bundle whose format is `unknown` is still a perfectly usable asset as long
 * as its entry is right.
 */
export type ModelBundleFormat =
    | "live2d-cubism4"
    | "live2d-cubism2"
    | "spine-binary"
    | "spine-json"
    | "unknown";

export interface ModelEntryCandidate {
    /** Path relative to the bundle root, `/`-separated. */
    path: string;
    format: ModelBundleFormat;
    /** Higher is a stronger signal. Only used to rank; the absolute value means nothing. */
    confidence: number;
}

export interface ModelEntryDetection {
    /** The entry to use, or null when the author has to pick one. */
    entry: string | null;
    /** Every plausible entry, best first. May be empty when the tree contains no manifest-ish file. */
    candidates: ModelEntryCandidate[];
    /**
     * Why {@link entry} is null. `"ambiguous"` means several files tied at the top rank (two models
     * in one folder is the usual cause); `"none"` means nothing in the tree looked like a manifest.
     */
    reason?: "ambiguous" | "none";
}

/** How many files a bundle may contain before import refuses it. */
export const MODEL_BUNDLE_MAX_FILES = 4096;
/** How deep the import walk goes. Model exports are shallow; this only stops symlink cycles. */
export const MODEL_BUNDLE_MAX_DEPTH = 16;

/**
 * Normalize a path to the bundle-relative form stored in metadata and used in URLs: `/`-separated,
 * no leading `./` or `/`, no `..` segment.
 *
 * Returns null for anything that would escape the bundle root. Callers must treat that as a hard
 * failure rather than skipping the file: a bundle missing one texture renders wrong, and silently
 * dropping it is how that becomes hard to diagnose.
 */
export function normalizeBundlePath(relativePath: string): string | null {
    const unified = relativePath.replace(/\\/g, "/");
    if (unified.includes("\0")) {
        return null;
    }
    const segments: string[] = [];
    for (const segment of unified.split("/")) {
        if (segment === "" || segment === ".") {
            continue;
        }
        if (segment === "..") {
            return null;
        }
        segments.push(segment);
    }
    return segments.length > 0 ? segments.join("/") : null;
}

/**
 * The canonical order bundle file lists are stored in.
 *
 * Stable and content-independent, because `files` is written into a project file that lives in
 * version control: a listing whose order depended on how the OS happened to enumerate the directory
 * would produce a spurious diff on every re-import of the same folder.
 */
export function sortBundlePaths(paths: readonly string[]): string[] {
    return [...paths].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

function depthOf(path: string): number {
    return path.split("/").length - 1;
}

function fileNameOf(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? path : path.slice(index + 1);
}

function dirNameOf(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
}

function stemOf(fileName: string): string {
    const index = fileName.indexOf(".");
    return index === -1 ? fileName : fileName.slice(0, index);
}

/**
 * Rank every plausible entry file in a bundle.
 *
 * The rules, strongest first:
 *
 *  - `*.model3.json` - Cubism 4's manifest, and the only file in a Live2D export that names the
 *    others. Note that the root listing does *not* imply the file set: Hiyori's `TapBody` motion
 *    appears only inside the manifest, which is exactly why nothing downstream may infer the bundle
 *    from the directory and why picking this file correctly matters.
 *  - `*.skel` next to a `*.atlas` - Spine's binary skeleton. Preferred over the JSON twin when both
 *    are exported, which is the common case.
 *  - `*.json` next to a `*.atlas` - Spine's JSON skeleton. Excludes the atlas's own name and the
 *    Live2D sidecars (`*.physics3.json`, `*.cdi3.json`, ...) so a Live2D folder that happens to
 *    contain an atlas cannot pick one of them.
 *  - `model.json` / `*.model.json` - Cubism 2. Weakest, because `model.json` is a common name.
 *
 * Ties are broken by depth (a manifest at the root beats one in a subfolder) and then by path, so
 * the result is deterministic. A genuine tie at the top rank returns no entry: two models in one
 * folder is a real thing authors do, and guessing between them silently is worse than asking.
 */
export function detectModelBundleEntry(files: readonly string[]): ModelEntryDetection {
    const normalized = files
        .map(file => normalizeBundlePath(file))
        .filter((file): file is string => file !== null);

    const atlasDirs = new Set<string>();
    const atlasStems = new Set<string>();
    for (const file of normalized) {
        const name = fileNameOf(file).toLowerCase();
        if (name.endsWith(".atlas") || name.endsWith(".atlas.txt")) {
            atlasDirs.add(dirNameOf(file));
            atlasStems.add(`${dirNameOf(file)}/${stemOf(fileNameOf(file))}`);
        }
    }

    const candidates: ModelEntryCandidate[] = [];
    for (const file of normalized) {
        const name = fileNameOf(file).toLowerCase();
        const dir = dirNameOf(file);

        if (name.endsWith(".model3.json")) {
            candidates.push({ path: file, format: "live2d-cubism4", confidence: 100 });
            continue;
        }
        if (name.endsWith(".skel") && atlasDirs.has(dir)) {
            candidates.push({ path: file, format: "spine-binary", confidence: 90 });
            continue;
        }
        if (name.endsWith(".json") && atlasDirs.has(dir) && !isLive2dSidecar(name)) {
            // The atlas itself is sometimes `foo.atlas.json`; never offer it as the skeleton.
            if (!name.endsWith(".atlas.json")) {
                candidates.push({ path: file, format: "spine-json", confidence: 80 });
            }
            continue;
        }
        if (name === "model.json" || name.endsWith(".model.json")) {
            candidates.push({ path: file, format: "live2d-cubism2", confidence: 60 });
        }
    }

    candidates.sort((a, b) =>
        b.confidence - a.confidence
        || depthOf(a.path) - depthOf(b.path)
        || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    if (candidates.length === 0) {
        return { entry: null, candidates: [], reason: "none" };
    }

    const best = candidates[0];
    const tied = candidates.filter(candidate =>
        candidate.confidence === best.confidence && depthOf(candidate.path) === depthOf(best.path));
    if (tied.length > 1) {
        // Spine exports both `foo.skel` and `foo.json` from the same skeleton; those are the same
        // model in two encodings, not two models, so they never count as a tie against each other.
        // Different stems next to the same atlas genuinely are two models.
        const stems = new Set(tied.map(candidate => stemOf(fileNameOf(candidate.path))));
        if (stems.size > 1) {
            return { entry: null, candidates, reason: "ambiguous" };
        }
    }

    return { entry: best.path, candidates };
}

/** The Live2D sidecars that sit beside a `.model3.json` and are never the entry themselves. */
function isLive2dSidecar(lowerFileName: string): boolean {
    return /\.(physics3|cdi3|pose3|userdata3|exp3|motion3|display3)\.json$/.test(lowerFileName);
}

/**
 * A stable identifier for the *shape* of a bundle, used where single-file assets use their content
 * hash (`Asset.hash`).
 *
 * Deliberately not a content digest: hashing every file of a bundle would be one IPC round trip per
 * file at import and again on every re-read, for a value whose only consumer is a cache key. What it
 * does capture is the file set - so adding, removing or renaming a file invalidates it, which is the
 * change that can make a stale reading actually wrong. Editing a texture in place does not move it;
 * nothing in Studio caches bundle bytes by this value (the served URL is minted per resolve), so
 * that is a limitation rather than a bug, and it is prefixed so it can never be mistaken for a
 * digest of the bytes.
 */
export function bundleListingFingerprint(files: readonly string[]): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (const path of sortBundlePaths(files)) {
        for (let index = 0; index < path.length; index += 1) {
            const code = path.charCodeAt(index);
            h1 = Math.imul(h1 ^ code, 0x01000193) >>> 0;
            h2 = Math.imul(h2 + code, 0x85ebca6b) >>> 0;
        }
        h1 = Math.imul(h1 ^ 0x2f, 0x01000193) >>> 0;
    }
    const count = files.length.toString(16).padStart(4, "0");
    return `bundle:${count}${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * The files an author is offered when detection could not decide. Anything text-manifest-shaped,
 * best guesses first, then everything else - so the override list is never empty even for a format
 * Studio has never heard of.
 */
export function listModelEntryChoices(files: readonly string[]): string[] {
    const detection = detectModelBundleEntry(files);
    const ranked = detection.candidates.map(candidate => candidate.path);
    const rest = sortBundlePaths(files.filter(file => !ranked.includes(file)));
    return [...ranked, ...rest];
}
