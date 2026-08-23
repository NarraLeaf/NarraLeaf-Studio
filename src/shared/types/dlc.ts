import { APP_TAG_ID_RELEASE, migrateAppTagId } from "./appTag";

/**
 * DLC - the pieces of content a project ships separately from the game itself.
 *
 * A DLC is one *addition* to a build: an extra route, a side story, a voice pack. It is not another
 * edition of the project - that is a build variant (`ProjectAppTag`), and the two answer
 * different questions. A variant asks *which* build a player has, and exactly one answer is true. A
 * DLC asks *what else* is installed beside it, and any number of answers are true at once.
 *
 * That difference is why a DLC id is deliberately **not** an app tag id and never resolves through
 * one. `AppTag` is a single value the story compiler folds into a literal; a set of installed DLC
 * cannot be, and a project that tried would have to give up folding for every variant to gain it
 * here. So the two never meet: a build decides at compile time *whether the content is in the
 * package*, and the running game decides *whether its entrance is shown*.
 *
 * # What a DLC is made of
 *
 * An id, a name, and the variant it attaches to. Nothing else - a DLC carries no overrides and no
 * configuration, because it does not change what the game is; it adds to what the game has.
 *
 * The id is **machine-readable and author-chosen**, unlike every other id in the project. It names
 * the file the author ships (`dlcArtifactFileName`), so it has to survive a zip, a storefront
 * upload and a player's filesystem, and it has to be something an author can recognise in a folder
 * beside their game. A generated id would be none of those.
 *
 * # Where a DLC lives
 *
 * A project document (`editor/dlc.json`), the same layer as the app tags and the variable registry,
 * for the reasons set out on `ProjectAppTagDocument`: a registry answers "which DLC does this
 * project have" synchronously from anywhere, while a file per DLC makes it a disk read, and the
 * `.nlproj` would hide the list from version control behind one blob.
 *
 * # Attaching to a variant
 *
 * A DLC file is sealed under the identity of the build it is meant for, so one built for the release
 * edition cannot be opened by a differently-identified build at all. But two variants that override
 * no identity share one, and then nothing would stop a demo from loading the full game's extra
 * chapter. {@link ProjectDlc.attachTo} is what the file states about itself so the running build can
 * refuse it, and it is why the field is stored rather than inferred.
 */

/**
 * Persisted document version for `editor/dlc.json`. Independent of every other document.
 */
export const DLC_SCHEMA_VERSION = 1 as const;

export type DlcSchemaVersion = typeof DLC_SCHEMA_VERSION;

/**
 * How long an id may be.
 *
 * Bounded because it becomes a filename, and a name long enough to trip a path limit would do it on
 * the player's machine rather than the author's. Generous enough that no real title runs into it.
 */
export const DLC_ID_MAX_LENGTH = 48;

/**
 * What an id may contain: lowercase ASCII, digits, `_` and `-`, starting with a letter.
 *
 * Narrow on purpose. The id is a filename that travels between a Windows authoring machine and a
 * case-sensitive player filesystem, through a storefront's upload tooling, and back out of a zip.
 * Every character class this excludes has broken one of those for somebody.
 */
const DLC_ID_PATTERN = /^[a-z][a-z0-9_-]*$/;

export interface ProjectDlc {
    /**
     * Stable, machine-readable, and the name of the file this DLC ships as. What every stored
     * reference holds, so renaming a DLC never invalidates one.
     */
    id: string;
    /** Author-facing. Shown wherever a DLC is named, and carried into the file for the game's log. */
    name: string;
    /**
     * The build variant this DLC loads into, as an app tag id.
     *
     * A build refuses a DLC that names a different one. Defaults to the release variant, which is
     * what an author who has never made a second variant means.
     */
    attachTo: string;
}

/** The persisted document. An array because author ordering is meaningful and a map loses it. */
export type ProjectDlcDocument = {
    schemaVersion: DlcSchemaVersion;
    dlcs: ProjectDlc[];
    meta?: {
        createdAt?: string;
        updatedAt?: string;
    };
};

/**
 * The field names a stored reference to a DLC uses.
 *
 * Declared here so every holder agrees on one spelling, and so the "how many things belong to this
 * DLC" count has a single place to learn about a new one. Single-valued strings only - a field that
 * held a list would be counted as zero references and no test would notice, which is the trap
 * `APP_TAG_REFERENCE_FIELDS` already documents.
 */
export const DLC_REFERENCE_FIELDS = ["dlcId"] as const;

/** Whether this is a well-formed DLC id. Blank is not: a DLC with no id has no file to ship as. */
export function isValidDlcId(raw: unknown): raw is string {
    return typeof raw === "string"
        && raw.length > 0
        && raw.length <= DLC_ID_MAX_LENGTH
        && DLC_ID_PATTERN.test(raw);
}

/**
 * The closest legal id to what was typed, or `""` when nothing legal is left.
 *
 * Applied on the way in rather than checked on the way out, the way a variant name is: an author who
 * types `Summer Route!` gets `summer_route` they can see and edit, not a rejected edit and a field
 * that snaps back.
 */
export function normalizeDlcId(raw: unknown): string {
    if (typeof raw !== "string") {
        return "";
    }
    const folded = raw
        .trim()
        .toLowerCase()
        // Anything that is not already legal becomes the separator rather than being dropped, so
        // that two words do not run together into one that reads as a different name.
        .replace(/[^a-z0-9_-]+/g, "_")
        // Leading separators would leave an id that cannot start with a letter; trailing ones are
        // invisible in a filename and would make two ids that look identical.
        .replace(/^[_-]+/, "")
        .replace(/[_-]+$/, "")
        .slice(0, DLC_ID_MAX_LENGTH);
    // The slice can strip back to a trailing separator, and a purely numeric name has no letter to
    // start with. Both leave a string this function must not claim is an id.
    const trimmed = folded.replace(/[_-]+$/, "");
    return isValidDlcId(trimmed) ? trimmed : "";
}

/**
 * `desired` as an id, or `desired` with a number after it, whichever is free.
 *
 * Ids are unique because the id is the filename: two DLC that produced the same file would overwrite
 * each other in the author's output folder and then in the player's.
 */
export function uniqueDlcId(taken: readonly string[], desired: string): string {
    const base = normalizeDlcId(desired) || "dlc";
    const used = new Set(taken);
    if (!used.has(base)) {
        return base;
    }
    for (let suffix = 2; suffix < used.size + 3; suffix += 1) {
        // Truncate the base rather than the suffix: an id cut short still names the right DLC, while
        // a cut-off number names a different one.
        const candidate = `${base.slice(0, DLC_ID_MAX_LENGTH - 1 - String(suffix).length)}_${suffix}`;
        if (!used.has(candidate)) {
            return candidate;
        }
    }
    // Unreachable: the loop tries more spellings than there are taken ids.
    return base;
}

/**
 * `desired`, or `desired` with a number after it, whichever is free.
 *
 * Case-insensitive for the reason `uniqueAppTagName` is: the names are what an author reads in
 * a list, and two that differ only in case are two rows nobody can tell apart.
 */
export function uniqueDlcName(taken: readonly string[], desired: string): string {
    const base = desired.trim() || "DLC";
    const used = new Set(taken.map(name => name.trim().toLowerCase()));
    if (!used.has(base.toLowerCase())) {
        return base;
    }
    for (let suffix = 2; suffix < used.size + 3; suffix += 1) {
        const candidate = `${base} ${suffix}`;
        if (!used.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
    return base;
}

/**
 * One stored DLC, or null when the record cannot be read as one.
 *
 * A record with no usable id is dropped rather than repaired: the id is the file it ships as, and
 * inventing one would produce a DLC the author never named and a file they cannot recognise.
 */
export function normalizeProjectDlc(raw: unknown): ProjectDlc | null {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const id = normalizeDlcId(record.id);
    if (!id) {
        return null;
    }
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const attachTo = typeof record.attachTo === "string" ? record.attachTo.trim() : "";
    return {
        id,
        // The id is a legal name and the only thing left to call it, so a blank one is shown rather
        // than leaving a row in the list with nothing in it.
        name: name || id,
        attachTo: attachTo ? migrateAppTagId(attachTo) : APP_TAG_ID_RELEASE,
    };
}

/**
 * Every readable DLC, first of each id winning.
 *
 * First wins for the reason `normalizeProjectAppTags` says: a duplicated id is one row on the
 * surface either way, and taking the later one would discard whichever of the two the author had
 * been editing first.
 */
export function normalizeProjectDlcs(raw: unknown): ProjectDlc[] {
    const source = Array.isArray(raw) ? raw : [];
    const byId = new Map<string, ProjectDlc>();
    for (const entry of source) {
        const dlc = normalizeProjectDlc(entry);
        if (dlc && !byId.has(dlc.id)) {
            byId.set(dlc.id, dlc);
        }
    }
    return [...byId.values()];
}

/** An absent or unreadable document is a project that ships no DLC. */
export function createEmptyDlcDocument(now?: string): ProjectDlcDocument {
    return {
        schemaVersion: DLC_SCHEMA_VERSION,
        dlcs: [],
        ...(now ? { meta: { createdAt: now, updatedAt: now } } : {}),
    };
}

export function migrateProjectDlcDocument(raw: unknown): ProjectDlcDocument {
    const record = raw && typeof raw === "object" && !Array.isArray(raw)
        ? raw as Record<string, unknown>
        : {};
    const meta = record.meta && typeof record.meta === "object" && !Array.isArray(record.meta)
        ? record.meta as ProjectDlcDocument["meta"]
        : undefined;
    return {
        schemaVersion: DLC_SCHEMA_VERSION,
        dlcs: normalizeProjectDlcs(record.dlcs),
        ...(meta ? { meta } : {}),
    };
}

/** The DLC under this id, or null. Unlike a variant there is no fallback: absent means absent. */
export function findDlc(stored: readonly ProjectDlc[], id: string | null | undefined): ProjectDlc | null {
    const trimmed = typeof id === "string" ? id.trim() : "";
    if (!trimmed) {
        return null;
    }
    return stored.find(dlc => dlc.id === trimmed) ?? null;
}

/** Whether the project has a DLC under this id. */
export function hasDlc(stored: readonly ProjectDlc[], id: string | null | undefined): boolean {
    return findDlc(stored, id) !== null;
}

/** The DLC that attach to one variant, in author order. */
export function dlcForAppTag(stored: readonly ProjectDlc[], appTagId: string | null | undefined): ProjectDlc[] {
    const tag = typeof appTagId === "string" && appTagId.trim()
        ? migrateAppTagId(appTagId.trim())
        : APP_TAG_ID_RELEASE;
    return stored.filter(dlc => dlc.attachTo === tag);
}

/**
 * Whether a DLC that names `attachTo` belongs in a build compiled as `buildAppTagId`.
 *
 * Both sides default to the release variant, and they must default the same way: a DLC written
 * before an author made a second variant states nothing, and a pack produced before builds recorded
 * their variant states nothing, and neither absence means "belongs to nothing".
 *
 * One function rather than a comparison at each end, because the two ends are in different processes
 * - the export seals the claim, the running game checks it - and a disagreement between them would
 * show up as a DLC that installs and is silently ignored.
 */
export function dlcAttachesToBuild(
    attachTo: string | null | undefined,
    buildAppTagId: string | null | undefined,
): boolean {
    const resolve = (id: string | null | undefined): string => {
        const trimmed = typeof id === "string" ? id.trim() : "";
        return trimmed ? migrateAppTagId(trimmed) : APP_TAG_ID_RELEASE;
    };
    return resolve(attachTo) === resolve(buildAppTagId);
}
