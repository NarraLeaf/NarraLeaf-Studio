/**
 * The format rules the model import wizard needs: what a Live2D or Spine model looks like on disk,
 * and which sibling files its manifest names.
 *
 * This is the one place in Studio that reads inside a model file, and the licence for doing so is
 * narrow: **only the text manifests** - `*.model3.json`, Cubism 2's `model.json`, and Spine's
 * `.atlas` - and only to learn *file names*. Nothing here opens a `.moc3` or a `.skel`, nothing
 * here understands geometry, and nothing downstream may start depending on it to: the manifest is
 * still authoritative at runtime and Studio's copy of the tree is still verbatim. What this buys is
 * the one thing an author cannot get any other way - being told at import time that a texture is
 * missing, rather than at mount time by a model that renders with holes in it.
 *
 * Everything here is pure and synchronous. The walk that feeds it lives in
 * `services/assets/modelImportScanner`.
 */

import { normalizeBundlePath, type ModelBundleFormat } from "./modelBundle";

/**
 * The model families the wizard can be pointed at.
 *
 * A *family*, not a runtime: the author picks this before any runtime is installed, and picking it
 * only decides which manifests the scan looks for. Deliberately not reusing `KnownPuppetRuntimeId`
 * from `puppetRuntimes` even though the two happen to spell the same ids - that registry is about
 * which drawing runtime is on disk and under what licence, and importing files answers to neither.
 */
export type ModelFamily = "live2d" | "spine";

export const MODEL_FAMILIES: readonly ModelFamily[] = ["live2d", "spine"];

/** How a reference was named, so a missing one can be reported as the thing it is. */
export type ModelReferenceRole =
    | "moc"
    | "texture"
    | "physics"
    | "pose"
    | "displayInfo"
    | "userData"
    | "expression"
    | "motion"
    | "sound"
    | "skeleton"
    | "atlas"
    | "page";

/**
 * Which roles a model cannot render without.
 *
 * The split is what lets a bundle with a missing idle motion still be imported: that model works,
 * minus one animation, and refusing it would be Studio being stricter than the runtime. A missing
 * `.moc3` or texture is a different thing - there is no partial model to import.
 */
const REQUIRED_ROLES: ReadonlySet<ModelReferenceRole> = new Set<ModelReferenceRole>([
    "moc",
    "texture",
    "skeleton",
    "atlas",
    "page",
]);

export function isRequiredModelRole(role: ModelReferenceRole): boolean {
    return REQUIRED_ROLES.has(role);
}

/** One file a manifest names, resolved against the folder being scanned. */
export interface ModelFileReference {
    /** Path relative to the scanned folder, `/`-separated. */
    path: string;
    role: ModelReferenceRole;
    /** What the manifest literally said, kept for the "this reference is unusable" report. */
    raw: string;
}

export interface ModelReferenceCollection {
    references: ModelFileReference[];
    /**
     * References that could not be turned into a path inside the scanned folder - a `..` that
     * escapes it, or an absolute path or URL. Reported rather than dropped: a model whose manifest
     * points outside its own folder will not survive being copied into the project, and finding
     * that out at import is the whole point of the check.
     */
    unusable: { raw: string; role: ModelReferenceRole }[];
}

// ==================== Live2D ====================

export type Live2dManifestKind = "cubism4" | "cubism2";

/**
 * Which Live2D manifest a file name is, if any.
 *
 * `model.json` is the weak one - it is a common name and Cubism 2 is the only reason to claim it -
 * so it is only ever accepted when the family being scanned is already Live2D.
 */
export function live2dManifestKind(fileName: string): Live2dManifestKind | null {
    const lower = fileName.toLowerCase();
    if (lower.endsWith(".model3.json")) {
        return "cubism4";
    }
    if (lower === "model.json" || lower.endsWith(".model.json")) {
        return "cubism2";
    }
    return null;
}

export function live2dBundleFormat(kind: Live2dManifestKind): ModelBundleFormat {
    return kind === "cubism4" ? "live2d-cubism4" : "live2d-cubism2";
}

/**
 * The files a Live2D manifest names, resolved against `manifestDir`.
 *
 * Reads defensively at every level, because a hand-edited manifest is a normal thing to meet and
 * the wizard's job when it meets one is to say which reference is wrong - not to throw. Anything
 * that is not a string where a path belongs is simply not a reference, and the file it would have
 * named cannot go missing.
 *
 * Cubism 4 keys are PascalCase, Cubism 2's are lowercase; the two shapes are otherwise the same
 * idea and are walked by one function so a change to the role table cannot land on only one of them.
 */
export function collectLive2dReferences(
    manifest: unknown,
    kind: Live2dManifestKind,
    manifestDir: string,
): ModelReferenceCollection {
    const collector = createCollector(manifestDir);
    if (!isRecord(manifest)) {
        return collector.result();
    }

    // Cubism 4 nests everything under FileReferences; Cubism 2 puts it at the top level.
    const root = kind === "cubism4"
        ? (isRecord(manifest.FileReferences) ? manifest.FileReferences : {})
        : manifest;

    const key = (pascal: string, lower: string): string => (kind === "cubism4" ? pascal : lower);

    collector.one(root[key("Moc", "model")], "moc");
    collector.each(root[key("Textures", "textures")], "texture");
    collector.one(root[key("Physics", "physics")], "physics");
    collector.one(root[key("Pose", "pose")], "pose");
    collector.one(root[key("DisplayInfo", "display_info")], "displayInfo");
    collector.one(root[key("UserData", "userdata")], "userData");

    // Expressions: [{ Name, File }] in both generations, spelt differently.
    const expressions = root[key("Expressions", "expressions")];
    if (Array.isArray(expressions)) {
        for (const expression of expressions) {
            if (isRecord(expression)) {
                collector.one(expression[key("File", "file")], "expression");
            }
        }
    }

    // Motions: { GroupName: [{ File, Sound }] }. The group names are the author's own, so the map
    // is walked by value rather than by any known key.
    const motions = root[key("Motions", "motions")];
    if (isRecord(motions)) {
        for (const group of Object.values(motions)) {
            if (!Array.isArray(group)) {
                continue;
            }
            for (const motion of group) {
                if (isRecord(motion)) {
                    collector.one(motion[key("File", "file")], "motion");
                    collector.one(motion[key("Sound", "sound")], "sound");
                }
            }
        }
    }

    return collector.result();
}

// ==================== Spine ====================

/** Spine's binary skeleton. Unambiguous by extension, unlike its JSON twin. */
export function isSpineSkeletonBinaryName(fileName: string): boolean {
    return fileName.toLowerCase().endsWith(".skel");
}

/** `.atlas`, and the `.atlas.txt` some exporters and asset pipelines produce. */
export function isSpineAtlasName(fileName: string): boolean {
    const lower = fileName.toLowerCase();
    return lower.endsWith(".atlas") || lower.endsWith(".atlas.txt");
}

/**
 * Whether a `.json` file is a Spine skeleton.
 *
 * Needed because "a JSON file next to an atlas" is not a good enough test - a Live2D folder can
 * contain an atlas, and a Spine folder can contain unrelated JSON. The marks looked for are the
 * ones Spine's own loaders key on: a `skeleton` header carrying the exporter version, or the
 * `bones`/`slots` pair that every skeleton has and nothing else does.
 *
 * Takes the parsed value rather than text so the caller reads and parses once.
 */
export function looksLikeSpineSkeletonJson(parsed: unknown): boolean {
    if (!isRecord(parsed)) {
        return false;
    }
    const header = parsed.skeleton;
    if (isRecord(header) && (typeof header.spine === "string" || typeof header.hash === "string")) {
        return true;
    }
    return Array.isArray(parsed.bones) && Array.isArray(parsed.slots);
}

/**
 * The page images an atlas declares, in file order.
 *
 * The rule is the one every Spine runtime's atlas reader uses, and it is structural rather than
 * lexical: a page begins at the first non-blank line of the file or at the first non-blank line
 * after a blank one, and everything until the next blank line belongs to it. So a page name is a
 * line that follows a blank line (or starts the file); the `key: value` lines under it are its
 * properties, and the region entries after those are neither.
 *
 * Written to be total - an atlas that is empty, truncated, or not an atlas at all yields no pages
 * and is reported by the caller as "this atlas names no images", which is exactly what it is.
 */
export function parseSpineAtlasPages(text: string): string[] {
    const pages: string[] = [];
    // A page header runs from its name line until the first line that is not `key: value`; the
    // region entries that follow are skipped until the next blank line resets us to "expect a page".
    let expectPage = true;
    let inPageHeader = false;

    for (const rawLine of text.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (line.length === 0) {
            expectPage = true;
            inPageHeader = false;
            continue;
        }
        if (expectPage) {
            pages.push(line);
            expectPage = false;
            inPageHeader = true;
            continue;
        }
        if (inPageHeader && !line.includes(":")) {
            // First region name. Everything from here to the next blank line is regions.
            inPageHeader = false;
        }
    }

    return pages;
}

/** The page images of an atlas, resolved against the atlas's own directory. */
export function collectSpineAtlasPages(atlasText: string, atlasDir: string): ModelReferenceCollection {
    const collector = createCollector(atlasDir);
    for (const page of parseSpineAtlasPages(atlasText)) {
        collector.one(page, "page");
    }
    return collector.result();
}

// ==================== path helpers ====================

/** The directory part of a `/`-separated relative path. `""` for a file at the root. */
export function dirNameOf(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? "" : path.slice(0, index);
}

/** The file-name part of a `/`-separated relative path. */
export function fileNameOf(path: string): string {
    const index = path.lastIndexOf("/");
    return index === -1 ? path : path.slice(index + 1);
}

/**
 * The stem a Spine skeleton and its atlas share: everything before the first dot.
 *
 * First dot rather than last, so `Raptor.atlas.txt` and `Raptor.skel` agree, and so a Live2D-style
 * `Hiyori.model3.json` reduces to `Hiyori` the same way `detectModelBundleEntry` reduces it.
 */
export function stemOf(fileName: string): string {
    const index = fileName.indexOf(".");
    return index === -1 ? fileName : fileName.slice(0, index);
}

/** Whether `ancestor` is a strict ancestor directory of `descendant`. Both scan-relative. */
export function isAncestorDirectory(ancestor: string, descendant: string): boolean {
    if (ancestor === descendant) {
        return false;
    }
    return ancestor === "" || descendant.startsWith(`${ancestor}/`);
}

/**
 * Resolve a manifest's reference against the directory the manifest sits in.
 *
 * Returns null for anything that is not a usable relative path inside the scanned folder: an
 * absolute path, a URL, a Windows drive letter, or a `..` chain that climbs out. Those are the
 * cases `normalizeBundlePath` exists to refuse, and refusing them here means the wizard can name
 * them instead of quietly resolving them to something inside the folder that happens to exist.
 */
export function resolveModelReference(baseDir: string, raw: string): string | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) {
        return null;
    }
    // A reference that is already rooted, or points at another machine, is not a sibling file.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed) || trimmed.startsWith("/") || trimmed.startsWith("\\")) {
        return null;
    }

    const unified = trimmed.replace(/\\/g, "/");
    const segments = baseDir === "" ? [] : baseDir.split("/");
    for (const segment of unified.split("/")) {
        if (segment === "" || segment === ".") {
            continue;
        }
        if (segment === "..") {
            if (segments.length === 0) {
                return null;
            }
            segments.pop();
            continue;
        }
        segments.push(segment);
    }

    return segments.length > 0 ? normalizeBundlePath(segments.join("/")) : null;
}

// ==================== internals ====================

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Accumulates references while de-duplicating by (path, role).
 *
 * The duplication is real and heavy: a Cubism 4 manifest names the same texture once per model
 * and the same sound across several motions, and a listing that repeated them would make the
 * missing-file report read as though there were more broken files than there are.
 */
function createCollector(baseDir: string) {
    const references: ModelFileReference[] = [];
    const unusable: { raw: string; role: ModelReferenceRole }[] = [];
    const seen = new Set<string>();
    const seenUnusable = new Set<string>();

    const one = (value: unknown, role: ModelReferenceRole): void => {
        if (typeof value !== "string" || value.trim().length === 0) {
            return;
        }
        const resolved = resolveModelReference(baseDir, value);
        if (resolved === null) {
            const key = `${role}\u0000${value}`;
            if (!seenUnusable.has(key)) {
                seenUnusable.add(key);
                unusable.push({ raw: value, role });
            }
            return;
        }
        const key = `${role}\u0000${resolved}`;
        if (!seen.has(key)) {
            seen.add(key);
            references.push({ path: resolved, role, raw: value });
        }
    };

    return {
        one,
        each(value: unknown, role: ModelReferenceRole): void {
            if (!Array.isArray(value)) {
                return;
            }
            for (const item of value) {
                one(item, role);
            }
        },
        result(): ModelReferenceCollection {
            return { references, unusable };
        },
    };
}
