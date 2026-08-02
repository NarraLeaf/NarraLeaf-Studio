/**
 * Turning a folder an author pointed at into the list of model bundles inside it.
 *
 * The wizard's middle step. Given one directory and a declared family, this finds every model of
 * that family beneath it, decides which directory each one's asset should be, and checks that the
 * files its manifest names are actually there.
 *
 * Two shapes drive everything else here:
 *
 *  - **A model's asset is the directory its manifest sits in**, not the folder that was picked. So
 *    pointing at one character's folder imports one asset, and pointing at a folder of twelve
 *    characters imports twelve - the author does not have to know which of those they have.
 *  - **The listing is authoritative for "is this file there"**, so a listing that could be short is
 *    worse than no listing at all: it would report present files as missing and turn a good export
 *    into a wall of errors. That is why the file cap is fatal here rather than a truncation.
 *
 * The filesystem is injected so the whole thing is testable against an in-memory tree, following
 * `importPathExpansion`.
 */

import { basename, join } from "@shared/utils/path";
import { sortBundlePaths, type ModelBundleFormat } from "@shared/utils/modelBundle";
import {
    collectLive2dReferences,
    collectSpineAtlasPages,
    dirNameOf,
    fileNameOf,
    isAncestorDirectory,
    isRequiredModelRole,
    isSpineAtlasName,
    isSpineSkeletonBinaryName,
    live2dBundleFormat,
    live2dManifestKind,
    looksLikeSpineSkeletonJson,
    stemOf,
    type ModelFamily,
    type ModelFileReference,
    type ModelReferenceRole,
} from "@shared/utils/modelImportScan";

/** The filesystem surface the scan needs. Both methods answer `null` for "could not read". */
export interface ModelScanFs {
    /**
     * Every regular file beneath `root`, keyed by its `/`-joined path relative to it, valued in
     * bytes. One call for the whole tree - the same measurement the bundle importer takes.
     */
    listTree(root: string): Promise<Record<string, number> | null>;
    /** UTF-8 contents of one file. */
    readText(path: string): Promise<string | null>;
}

/**
 * How many files a scanned folder may hold before the scan refuses it.
 *
 * Generous, because it is not a budget - it is the point past which a folder is not a model library
 * but a disk, and a validation pass over it would be both slow and meaningless. Deliberately larger
 * than `MODEL_BUNDLE_MAX_FILES`, which caps one bundle; a folder of twenty characters is a normal
 * thing to point this at.
 */
export const MODEL_SCAN_MAX_FILES = 20000;

/**
 * The largest `.json` the Spine probe will read to ask "is this a skeleton?".
 *
 * Only a guard against reading something enormous by accident; a Spine JSON skeleton for a complex
 * character runs to a few megabytes, so nothing real is near this.
 */
const SPINE_JSON_PROBE_MAX_BYTES = 32 * 1024 * 1024;

/** One thing wrong with a model, in the form the wizard lists it. */
export type ModelScanProblem =
    /** A file the manifest names that is not in the folder. */
    | { kind: "missing"; role: ModelReferenceRole; path: string }
    /** A reference that cannot point at a file inside the model's folder (absolute, a URL, `..` out). */
    | { kind: "unusableReference"; role: ModelReferenceRole; raw: string }
    /** The manifest is not readable, or not JSON. Nothing about this model can be checked. */
    | { kind: "manifestUnreadable"; path: string }
    /** A Spine skeleton with no atlas beside it - the expected name is given. */
    | { kind: "atlasMissing"; path: string }
    /** An atlas that parsed but named no page image, so the model has no textures at all. */
    | { kind: "atlasEmpty"; path: string }
    /** Another model of the same family lives inside this one's folder, and would be imported with it. */
    | { kind: "nestedModel"; path: string };

/**
 * Whether a problem is a reason not to import by default.
 *
 * Advisory, not a gate. The listing this is computed from can be short in ways the scan cannot see
 * (a subdirectory the OS would not hand over), and an author who knows their export is fine must
 * not be left with a dialog that only says no - so an error unticks a row rather than removing it.
 */
export function isBlockingModelProblem(problem: ModelScanProblem): boolean {
    switch (problem.kind) {
        case "missing":
            return isRequiredModelRole(problem.role);
        case "unusableReference":
            return isRequiredModelRole(problem.role);
        case "manifestUnreadable":
        case "atlasMissing":
        case "atlasEmpty":
            return true;
        case "nestedModel":
            return false;
    }
}

/** One importable model: a directory that becomes one bundle asset. */
export interface ScannedModel {
    /** Absolute path of the directory to import. Unique across a result. */
    rootPath: string;
    /** That directory relative to the scanned folder; `""` when the scanned folder is itself a model. */
    relativePath: string;
    /** Display name - the folder's own name, or the scanned folder's name at the root. */
    name: string;
    /** The manifest to use as the entry, relative to {@link rootPath}. */
    entry: string;
    /** Every manifest found in this directory, best first. More than one means two models share a folder. */
    entryChoices: string[];
    format: ModelBundleFormat;
    fileCount: number;
    totalBytes: number;
    /** Everything wrong, in a stable order: blocking problems first. */
    problems: ModelScanProblem[];
}

export type ModelScanOutcome =
    | { ok: true; models: ScannedModel[] }
    /** The scan could not run at all; `reason` picks the message rather than carrying one. */
    | { ok: false; reason: "unreadable" | "tooManyFiles"; fileCount?: number };

/**
 * Find every model of `family` beneath `root` and check its referenced files.
 *
 * Ordering of the result is by path, so two scans of the same folder list the same models in the
 * same order and a re-scan does not reshuffle what the author was reading.
 */
export async function scanFolderForModels(
    family: ModelFamily,
    root: string,
    fs: ModelScanFs,
): Promise<ModelScanOutcome> {
    const tree = await fs.listTree(root);
    if (!tree) {
        return { ok: false, reason: "unreadable" };
    }

    const allFiles = sortBundlePaths(Object.keys(tree));
    if (allFiles.length > MODEL_SCAN_MAX_FILES) {
        return { ok: false, reason: "tooManyFiles", fileCount: allFiles.length };
    }

    const present = new Set(allFiles);
    const manifests = family === "live2d"
        ? findLive2dManifests(allFiles)
        : await findSpineManifests(allFiles, tree, root, fs);

    // One candidate per directory: the folder is what gets copied, so two manifests in one folder
    // are one asset with a choice of entry, never two assets over the same bytes.
    const byDirectory = new Map<string, ManifestHit[]>();
    for (const manifest of manifests) {
        const directory = dirNameOf(manifest.path);
        const bucket = byDirectory.get(directory);
        if (bucket) {
            bucket.push(manifest);
        } else {
            byDirectory.set(directory, [manifest]);
        }
    }

    const directories = [...byDirectory.keys()].sort();
    const models: ScannedModel[] = [];

    for (const directory of directories) {
        const problems: ModelScanProblem[] = [];
        const references: ModelFileReference[] = [];
        const hits: ManifestHit[] = [];

        for (const hit of [...byDirectory.get(directory)!].sort(compareManifests)) {
            const collected = family === "live2d"
                ? await collectLive2dFor(hit, root, fs)
                : await collectSpineFor(hit, allFiles, root, fs);
            if (!collected.recognised) {
                continue;
            }
            hits.push(hit);
            problems.push(...collected.problems);
            references.push(...collected.references);
        }

        // Every manifest in this folder turned out not to be one. `model.json` is the reason this
        // can happen: the name belongs to Cubism 2 and to any number of unrelated files, so it is
        // claimed on the strength of what is inside rather than what it is called.
        if (hits.length === 0) {
            continue;
        }

        // Checked against the whole tree rather than the model's own subtree: a manifest that
        // reaches a sibling folder is unusual but legal, and reporting such a file as missing when
        // it is right there would be a lie. What it does mean is that the copy will not include it,
        // which is what the `..` refusal in `resolveModelReference` is there to catch.
        for (const reference of dedupeReferences(references)) {
            if (!present.has(reference.path)) {
                problems.push({
                    kind: "missing",
                    role: reference.role,
                    path: toModelRelative(directory, reference.path),
                });
            }
        }

        const files = allFiles.filter(file => isInDirectory(directory, file));
        models.push({
            rootPath: directory === "" ? root : join(root, ...directory.split("/")),
            relativePath: directory,
            name: directory === "" ? (basename(root) || root) : fileNameOf(directory),
            entry: toModelRelative(directory, hits[0].path),
            entryChoices: hits.map(hit => toModelRelative(directory, hit.path)),
            format: hits[0].format,
            fileCount: files.length,
            totalBytes: files.reduce((total, file) => total + (tree[file] ?? 0), 0),
            problems,
        });
    }

    // The folder is imported whole, so a model nested inside another is imported twice: once as
    // itself, once as part of its parent. Said out loud rather than silently de-duplicated, because
    // which of the two the author wants is not something the scan can know. Done here, over the
    // models that survived, so a directory whose manifest turned out not to be one cannot warn
    // about containing something that is no longer on the list.
    for (const model of models) {
        for (const other of models) {
            if (isAncestorDirectory(model.relativePath, other.relativePath)) {
                model.problems.push({
                    kind: "nestedModel",
                    path: toModelRelative(model.relativePath, other.relativePath),
                });
            }
        }
        model.problems = sortProblems(model.problems);
    }

    return { ok: true, models };
}

// ==================== finding manifests ====================

interface ManifestHit {
    /** Scan-root-relative path of the manifest. */
    path: string;
    format: ModelBundleFormat;
    /** Higher wins when a directory holds several. */
    rank: number;
}

function compareManifests(a: ManifestHit, b: ManifestHit): number {
    return b.rank - a.rank || (a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}

function findLive2dManifests(files: readonly string[]): ManifestHit[] {
    const hits: ManifestHit[] = [];
    for (const file of files) {
        const kind = live2dManifestKind(fileNameOf(file));
        if (kind) {
            hits.push({ path: file, format: live2dBundleFormat(kind), rank: kind === "cubism4" ? 100 : 60 });
        }
    }
    return hits;
}

/**
 * Spine's skeletons: every `.skel`, plus every `.json` that reads like a skeleton.
 *
 * The JSON probe is the awkward half - `.json` says nothing about what is inside - so it is narrowed
 * before any file is opened: Live2D's own sidecars are skipped by name (a Cubism folder is full of
 * `.motion3.json`, and the author who picked Spine by mistake should get one clean "no models
 * found", not a hundred reads), and anything implausibly large is skipped by size.
 *
 * When a skeleton is exported in both encodings - `raptor.skel` and `raptor.json`, which is the
 * usual case - they are one model, so the JSON twin is dropped rather than offered as a second entry.
 */
async function findSpineManifests(
    files: readonly string[],
    sizes: Record<string, number>,
    root: string,
    fs: ModelScanFs,
): Promise<ManifestHit[]> {
    const hits: ManifestHit[] = [];
    const binaryStems = new Set<string>();

    for (const file of files) {
        if (isSpineSkeletonBinaryName(fileNameOf(file))) {
            hits.push({ path: file, format: "spine-binary", rank: 90 });
            binaryStems.add(`${dirNameOf(file)}/${stemOf(fileNameOf(file))}`);
        }
    }

    for (const file of files) {
        const name = fileNameOf(file);
        if (!name.toLowerCase().endsWith(".json") || isLive2dOwnedJsonName(name)) {
            continue;
        }
        if (binaryStems.has(`${dirNameOf(file)}/${stemOf(name)}`)) {
            continue;
        }
        if ((sizes[file] ?? 0) > SPINE_JSON_PROBE_MAX_BYTES) {
            continue;
        }
        const text = await fs.readText(join(root, ...file.split("/")));
        if (text === null) {
            continue;
        }
        let parsed: unknown;
        try {
            parsed = JSON.parse(text);
        } catch {
            continue;
        }
        if (looksLikeSpineSkeletonJson(parsed)) {
            hits.push({ path: file, format: "spine-json", rank: 80 });
        }
    }

    return hits;
}

/**
 * The `.json` names Live2D owns, manifest and sidecars alike.
 *
 * Only used to keep the Spine probe from opening a Cubism folder file by file. Being wrong in the
 * permissive direction costs a read; being wrong in the other direction would hide a real skeleton,
 * so the list stays exactly Live2D's documented suffixes.
 */
function isLive2dOwnedJsonName(fileName: string): boolean {
    return /\.(model3|physics3|cdi3|pose3|userdata3|exp3|motion3|display3)\.json$/i.test(fileName);
}

// ==================== per-family reference collection ====================

interface CollectedReferences {
    /**
     * Whether the file really is a manifest of this family. `false` drops it from the results
     * entirely rather than listing it with problems - see the `model.json` note at the call site.
     */
    recognised: boolean;
    references: ModelFileReference[];
    problems: ModelScanProblem[];
}

async function collectLive2dFor(hit: ManifestHit, root: string, fs: ModelScanFs): Promise<CollectedReferences> {
    const directory = dirNameOf(hit.path);
    const kind = live2dManifestKind(fileNameOf(hit.path)) ?? "cubism4";
    // A `*.model3.json` that will not parse is a broken Cubism 4 model and is reported as one; a
    // `model.json` that will not parse was probably never a model at all, and saying so would be a
    // guess about a file this scan has no claim on.
    const unreadable: CollectedReferences = {
        recognised: kind === "cubism4",
        references: [],
        problems: [{ kind: "manifestUnreadable", path: fileNameOf(hit.path) }],
    };

    const text = await fs.readText(join(root, ...hit.path.split("/")));
    if (text === null) {
        return unreadable;
    }
    let parsed: unknown;
    try {
        parsed = JSON.parse(text);
    } catch {
        return unreadable;
    }

    const collected = collectLive2dReferences(parsed, kind, directory);
    // Cubism 2's manifest is called `model.json`, a name a hundred unrelated files also use, so it
    // has to earn the claim: a real one names a `.moc`. Cubism 4's name is specific enough that a
    // manifest naming no moc is a broken model rather than a stranger, and is kept and reported.
    const namesAModel = collected.references.some(reference => reference.role === "moc")
        || collected.unusable.some(entry => entry.role === "moc");

    return {
        recognised: kind === "cubism4" || namesAModel,
        references: collected.references,
        problems: collected.unusable.map(entry => ({
            kind: "unusableReference" as const,
            role: entry.role,
            raw: entry.raw,
        })),
    };
}

/**
 * A Spine skeleton's referenced files, which live in its atlas rather than in the skeleton itself.
 *
 * The atlas is looked for by the skeleton's own stem first; failing that, a directory holding
 * exactly one atlas is unambiguous enough to pair with. Two atlases and no stem match is not, and is
 * reported as the missing one that was expected - naming the file the exporter would have written
 * is more use than saying the pairing was ambiguous.
 */
async function collectSpineFor(
    hit: ManifestHit,
    allFiles: readonly string[],
    root: string,
    fs: ModelScanFs,
): Promise<CollectedReferences> {
    const directory = dirNameOf(hit.path);
    const stem = stemOf(fileNameOf(hit.path));
    const siblingAtlases = allFiles.filter(file =>
        dirNameOf(file) === directory && isSpineAtlasName(fileNameOf(file)));

    const atlas = siblingAtlases.find(file => stemOf(fileNameOf(file)) === stem)
        ?? (siblingAtlases.length === 1 ? siblingAtlases[0] : undefined);

    if (!atlas) {
        return { recognised: true, references: [], problems: [{ kind: "atlasMissing", path: `${stem}.atlas` }] };
    }

    const text = await fs.readText(join(root, ...atlas.split("/")));
    if (text === null) {
        return {
            recognised: true,
            references: [],
            problems: [{ kind: "manifestUnreadable", path: fileNameOf(atlas) }],
        };
    }

    const collected = collectSpineAtlasPages(text, directory);
    const problems: ModelScanProblem[] = collected.unusable.map(entry => ({
        kind: "unusableReference" as const,
        role: entry.role,
        raw: entry.raw,
    }));
    if (collected.references.length === 0 && problems.length === 0) {
        problems.push({ kind: "atlasEmpty", path: fileNameOf(atlas) });
    }

    return { recognised: true, references: collected.references, problems };
}

// ==================== helpers ====================

function dedupeReferences(references: readonly ModelFileReference[]): ModelFileReference[] {
    const seen = new Set<string>();
    const unique: ModelFileReference[] = [];
    for (const reference of references) {
        if (!seen.has(reference.path)) {
            seen.add(reference.path);
            unique.push(reference);
        }
    }
    return unique;
}

/** Whether a scan-relative file sits inside a scan-relative directory (`""` being the whole tree). */
function isInDirectory(directory: string, file: string): boolean {
    return directory === "" || file.startsWith(`${directory}/`);
}

/**
 * Re-base a scan-relative path onto the model's own directory, which is what the author sees.
 *
 * A reference that reaches outside the model's folder keeps its scan-relative form with a `../`
 * prefix, so it is visibly not part of this bundle rather than silently reading as one of its files.
 */
function toModelRelative(directory: string, path: string): string {
    if (directory === "") {
        return path;
    }
    return path.startsWith(`${directory}/`) ? path.slice(directory.length + 1) : `../${path}`;
}

/** Blocking problems first, then by kind, so the first line of a row is its worst news. */
function sortProblems(problems: readonly ModelScanProblem[]): ModelScanProblem[] {
    return [...problems].sort((a, b) => {
        const blocking = Number(isBlockingModelProblem(b)) - Number(isBlockingModelProblem(a));
        return blocking || (a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0);
    });
}
