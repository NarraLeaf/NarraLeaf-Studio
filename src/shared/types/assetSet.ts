/**
 * Asset sets - one asset library entry that stands for a family of files, indexed by axes.
 *
 * An author who has `alice-happy-en.png`, `alice-happy-ja.png`, `alice-sad-en.png` and so on does
 * not want to name each of them at every reference site. An asset set is the entry they name
 * instead: it declares the axes those files vary along, and a reference carries only the set's id.
 *
 * # Resolution is a pure evaluation, and that is the line against layered sprites
 *
 * Resolving a set is a function of the set, a coordinate, and the library - the same inputs always
 * answer the same file. It holds nothing between resolutions.
 *
 * That is what separates a set from a character's layered sprite, which looks similar and is not.
 * A sprite's `/face` writes only the axes the line touched and leaves the rest as they were, so
 * "what is this character wearing" is a question about how far the script has played. Putting that
 * behaviour inside an asset entity would make "which file is this" depend on playback position.
 * The two resolvers stay apart; a set never carries over a value from a previous resolution.
 *
 * # Membership is the tag, which is what promotes a tag to an identity
 *
 * A member is not listed by id. A set declares the tags its members carry - the fixed ones every
 * member has ({@link AssetSet.filter}) and the varying ones its axes range over - and a coordinate
 * resolves to the asset carrying that exact combination. `MagicTagManager` already derives
 * `category:value` tags from file names, and this is where those tags stop being search metadata
 * and start deciding which file a reference means.
 *
 * A consequence worth stating, because it is the whole reason {@link AssetSetAxis.values} is
 * declared rather than derived: if an axis ranged over "whatever values the library happens to
 * carry", then no combination could ever be missing, and a set could not tell an author that the
 * Japanese version of one expression was never imported. The declared values are the promise; the
 * library is what is measured against it.
 *
 * # Residency: which axes survive the build
 *
 * Every axis declares whether it collapses at build time or is resolved by the shipped game.
 *
 *  - **`build`** - the build picks one value and **the other variants' bytes are not in the
 *    package**. This is a safety property, not a size optimisation: an all-ages edition that still
 *    carried the adult variants would be one unpacking away from shipping them.
 *  - **`runtime`** - every value is in the package and the game picks between them while running.
 *    A locale axis is the example.
 *
 * # Why a build axis may not sit inside a runtime axis
 *
 * Axes are ordered, outermost first, and the order is a nesting: the first axis chooses between
 * sub-families, and the axes after it index within whichever was chosen.
 *
 * "Runtime" is not a statement about one level. It says every value under this axis is in the
 * package, and that claim propagates down the whole subtree - the game may ask for any of them, so
 * all of them must be there. "Build" says the opposite about its own subtree: one value is in the
 * package and the rest must not be.
 *
 * A build axis nested inside a runtime axis is therefore a subtree required to be wholly present by
 * the axis above it and required to be partly absent by itself, and some variant has to be both in
 * the package and not in it. There is no build that satisfies both, so the editor refuses to
 * arrange the axes that way rather than letting the contradiction reach a build.
 *
 * The reverse nesting has no such problem: a build axis outside drops entire runtime subtrees, and
 * what remains is fully present, which is exactly what the runtime axis asks for.
 *
 * # What is not decided here
 *
 * This module is the model and the evaluation. Collapsing a build axis into a package, and
 * deriving a storage key for a surviving runtime axis, belong to the build and the runtime and are
 * not implemented yet.
 */

/** Persisted document version for `editor/asset-sets.json`. Independent of every other document. */
export const ASSET_SET_SCHEMA_VERSION = 1;

/**
 * Whether an axis is resolved when the game is built or while it runs.
 *
 * Ordered deliberately: {@link ASSET_AXIS_RESIDENCY_ORDER} reads this as "build may enclose
 * runtime", which is the one arrangement rule the model has.
 */
export type AssetAxisResidency = "build" | "runtime";

/**
 * How deeply an axis of each residency may sit, smaller being further out.
 *
 * A number rather than a pair of comparisons so the rule reads the same for a two-axis set and a
 * five-axis one: an axis may not be outside an axis with a smaller number.
 */
export const ASSET_AXIS_RESIDENCY_ORDER: Readonly<Record<AssetAxisResidency, number>> = Object.freeze({
    build: 0,
    runtime: 1,
});

export const ASSET_AXIS_RESIDENCIES: readonly AssetAxisResidency[] = Object.freeze(["build", "runtime"]);

export function isAssetAxisResidency(value: unknown): value is AssetAxisResidency {
    return value === "build" || value === "runtime";
}

/** One axis a set's members vary along. */
export interface AssetSetAxis {
    /**
     * The tag category this axis reads, without the value - `locale`, not `locale:ja`.
     *
     * The axis is identified by the category rather than by an id of its own: the category is
     * already the name the tags on disk are written under, and a second identifier would be a
     * second thing to keep in step with them.
     */
    key: string;
    residency: AssetAxisResidency;
    /**
     * The values this axis promises to cover, in author order.
     *
     * Declared, not derived from the library - see the module note. An axis with no values covers
     * nothing and is reported rather than silently treated as "any".
     */
    values: string[];
}

/**
 * One entry in the asset library that stands for a family of files.
 *
 * Carries no member ids. Everything about which files belong to it is said in {@link filter} and
 * {@link axes}, and answered by reading the library's tags.
 */
export interface AssetSet {
    id: string;
    name: string;
    /**
     * The `AssetType` value its members are, as a string.
     *
     * Structural for the reason `documents/specs/assetsMetadata.ts` gives: the enum lives under the
     * renderer and cannot be imported here. Stored rather than derived from the members because an
     * empty set has no members to derive it from, and the sidebar still has to file it under a
     * heading and a selector still has to decide whether to offer it.
     */
    type: string;
    /**
     * Tags every member carries, verbatim `category:value`.
     *
     * What keeps a set from meaning "every file in the library that happens to be tagged
     * `mood:happy`". Empty is legal and means the axes alone say who belongs.
     */
    filter: string[];
    /** Outermost first. The order is the nesting; see the module note on residency. */
    axes: AssetSetAxis[];
}

export interface ProjectAssetSetDocument {
    version: number;
    sets: AssetSet[];
}

export function createEmptyAssetSetDocument(): ProjectAssetSetDocument {
    return { version: ASSET_SET_SCHEMA_VERSION, sets: [] };
}

/* -------------------------------------------------------------------------- */
/* Tags                                                                        */
/* -------------------------------------------------------------------------- */

/** A tag read as a coordinate: the category it indexes and the value on that axis. */
export interface AssetTagPair {
    category: string;
    value: string;
}

/**
 * Read a library tag as a `category:value` pair, or null when it is a plain label.
 *
 * Split at the **first** colon, so a value may contain one (`source:https://…`) while a category
 * may not. A tag with nothing on either side is a label, not a coordinate: `:ja` names no category
 * and `locale:` names no value, and treating either as a coordinate would make an axis match on
 * emptiness.
 */
export function parseAssetTag(tag: string): AssetTagPair | null {
    const separator = tag.indexOf(":");
    if (separator <= 0) {
        return null;
    }
    const category = tag.slice(0, separator).trim();
    const value = tag.slice(separator + 1).trim();
    if (!category || !value) {
        return null;
    }
    return { category, value };
}

export function formatAssetTag(category: string, value: string): string {
    return `${category.trim()}:${value.trim()}`;
}

/**
 * Every `category:value` tag in a library, grouped by category, values in first-seen order.
 *
 * The vocabulary the axis editor offers, and the reason it exists as a function rather than as
 * stored state: the tags are on the asset records, so this is a reading of the library and never a
 * second copy of it that could fall behind.
 */
export function collectAssetTagVocabulary(
    candidates: readonly AssetSetCandidate[],
): Map<string, string[]> {
    const vocabulary = new Map<string, string[]>();
    for (const candidate of candidates) {
        for (const tag of candidate.tags) {
            const pair = parseAssetTag(tag);
            if (!pair) {
                continue;
            }
            const values = vocabulary.get(pair.category);
            if (!values) {
                vocabulary.set(pair.category, [pair.value]);
            } else if (!values.includes(pair.value)) {
                values.push(pair.value);
            }
        }
    }
    return vocabulary;
}

/* -------------------------------------------------------------------------- */
/* Coordinates                                                                 */
/* -------------------------------------------------------------------------- */

/** One point in a set's axis space: a value for every axis, keyed by axis key. */
export type AssetSetCoordinate = Readonly<Record<string, string>>;

/**
 * Every coordinate a set promises, with the outermost axis varying slowest.
 *
 * That order is what the matrix in the inspector draws and what a report lists, so it is produced
 * here rather than at each reader - two readers deriving it separately would eventually disagree
 * about which axis is the row and which is the column.
 *
 * An axis with no values makes the product empty, which is correct: the set promises nothing until
 * that axis says what it ranges over. `validateAssetSet` is what tells the author so.
 */
export function assetSetCoordinates(set: AssetSet): AssetSetCoordinate[] {
    let coordinates: AssetSetCoordinate[] = [{}];
    for (const axis of set.axes) {
        const next: AssetSetCoordinate[] = [];
        for (const prefix of coordinates) {
            for (const value of axis.values) {
                next.push({ ...prefix, [axis.key]: value });
            }
        }
        coordinates = next;
    }
    return coordinates;
}

/**
 * A coordinate written as one string, axes in declaration order.
 *
 * For display and for keying a map. Reads like the tags it is made of (`char:alice · locale:ja`),
 * because the author's way of fixing a hole is to go and write those tags on a file.
 */
export function assetSetCoordinateLabel(set: AssetSet, coordinate: AssetSetCoordinate): string {
    return set.axes
        .map(axis => formatAssetTag(axis.key, coordinate[axis.key] ?? ""))
        .join(" · ");
}

/* -------------------------------------------------------------------------- */
/* Resolution                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * What resolution needs to know about a library row.
 *
 * Deliberately two fields. Resolution is a pure function of the tags, so handing it the asset
 * record would let a later change make it depend on something else.
 */
export interface AssetSetCandidate {
    id: string;
    type: string;
    tags: readonly string[];
}

function hasAllTags(candidate: AssetSetCandidate, required: readonly string[]): boolean {
    if (required.length === 0) {
        return true;
    }
    // Compared as parsed pairs rather than as raw strings so that `locale: ja` on a record and
    // `locale:ja` in a declaration are the same coordinate. They are typed by different people -
    // one by the magic tag pass, one into the axis editor - and a space is not a distinction the
    // author would ever mean.
    const carried = new Set<string>();
    for (const tag of candidate.tags) {
        const pair = parseAssetTag(tag);
        carried.add(pair ? formatAssetTag(pair.category, pair.value) : tag.trim());
    }
    return required.every(tag => {
        const pair = parseAssetTag(tag);
        return carried.has(pair ? formatAssetTag(pair.category, pair.value) : tag.trim());
    });
}

/** The tags a member at this coordinate must carry: the set's fixed ones plus one per axis. */
export function assetSetCoordinateTags(set: AssetSet, coordinate: AssetSetCoordinate): string[] {
    const tags = [...set.filter];
    for (const axis of set.axes) {
        const value = coordinate[axis.key];
        if (value !== undefined) {
            tags.push(formatAssetTag(axis.key, value));
        }
    }
    return tags;
}

/**
 * Every library row that carries a coordinate's tags.
 *
 * Answers a list, not a row, because "no file" and "two files" are both real states of a library
 * and both are things an author has to be told about. {@link resolveAssetSetMember} is the caller
 * that wants the single answer.
 */
export function matchAssetSetCoordinate(
    set: AssetSet,
    coordinate: AssetSetCoordinate,
    candidates: readonly AssetSetCandidate[],
): string[] {
    const required = assetSetCoordinateTags(set, coordinate);
    return candidates
        .filter(candidate => candidate.type === set.type && hasAllTags(candidate, required))
        .map(candidate => candidate.id);
}

/**
 * The one asset a coordinate means, or null when the library does not say unambiguously.
 *
 * The stateless evaluation the rest of the model is described in terms of. Two matches answer null
 * rather than the first one: picking would make the answer depend on library order, and a set whose
 * meaning changes when a file is renamed is not a reference an author can rely on.
 */
export function resolveAssetSetMember(
    set: AssetSet,
    coordinate: AssetSetCoordinate,
    candidates: readonly AssetSetCandidate[],
): string | null {
    const matches = matchAssetSetCoordinate(set, coordinate, candidates);
    return matches.length === 1 ? matches[0] : null;
}

/** One coordinate of a set, and what the library currently has for it. */
export interface AssetSetCell {
    coordinate: AssetSetCoordinate;
    label: string;
    /** Every match. One is resolved; none is a hole; more than one is ambiguous. */
    assetIds: string[];
}

export interface AssetSetContents {
    cells: AssetSetCell[];
    /** Coordinates the library has no file for. */
    missing: AssetSetCell[];
    /** Coordinates more than one file answers to. */
    ambiguous: AssetSetCell[];
}

/**
 * A set measured against a library: every coordinate, and the holes.
 *
 * One pass producing all three lists because every reader wants more than one of them - the panel
 * tints a row when either list is non-empty, the inspector draws the whole matrix, and the check
 * reports the two failures separately.
 */
export function resolveAssetSetContents(
    set: AssetSet,
    candidates: readonly AssetSetCandidate[],
): AssetSetContents {
    const cells: AssetSetCell[] = assetSetCoordinates(set).map(coordinate => ({
        coordinate,
        label: assetSetCoordinateLabel(set, coordinate),
        assetIds: matchAssetSetCoordinate(set, coordinate, candidates),
    }));
    return {
        cells,
        missing: cells.filter(cell => cell.assetIds.length === 0),
        ambiguous: cells.filter(cell => cell.assetIds.length > 1),
    };
}

/** Whether a set resolves everything it promises. What the panel tints a row on. */
export function isAssetSetComplete(set: AssetSet, candidates: readonly AssetSetCandidate[]): boolean {
    const contents = resolveAssetSetContents(set, candidates);
    return contents.missing.length === 0 && contents.ambiguous.length === 0;
}

/**
 * The set a group of files already describes, read off their tags.
 *
 * This is the whole of what makes a set "smart", and it is a reading rather than a guess: a tag
 * category every selected file agrees on is a **fixed** part of what they are, and one they disagree
 * on is an **axis** they vary along. `MagicTagManager` derives those tags from file names, so an
 * author who has named their files consistently has already declared the axes and only has to say
 * which of them survive the build.
 *
 * Axes come out in the order their categories were first seen, which for magic tags is the order of
 * the segments in the file name - the order the author wrote. Every axis starts as `build`: that is
 * the residency which keeps bytes out of a package, so a set nobody has finished declaring errs
 * towards shipping too little rather than too much.
 *
 * Values are the ones present, which is right at this moment and only at this moment: the declared
 * values are a promise, and the promise a set starts with is the files it was made from. Extending
 * an axis to a locale nobody has imported yet is an edit in the inspector, and the hole it opens is
 * the point of making the edit.
 */
export function deriveAssetSetDraft(
    candidates: readonly AssetSetCandidate[],
): { filter: string[]; axes: AssetSetAxis[] } {
    const vocabulary = collectAssetTagVocabulary(candidates);
    const filter: string[] = [];
    const axes: AssetSetAxis[] = [];
    for (const [category, values] of vocabulary) {
        // A category not every file carries is neither: it does not hold for the whole family, and
        // as an axis it would promise combinations the untagged files can never answer.
        const carriedByAll = candidates.every(candidate =>
            candidate.tags.some(tag => parseAssetTag(tag)?.category === category));
        if (!carriedByAll) {
            continue;
        }
        if (values.length === 1) {
            filter.push(formatAssetTag(category, values[0]));
        } else {
            axes.push({ key: category, residency: "build", values: [...values] });
        }
    }
    return { filter, axes };
}

/* -------------------------------------------------------------------------- */
/* Validation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A fault in a set's own declaration, independent of any library.
 *
 * Separate from {@link resolveAssetSetContents} because these are two different kinds of news: a
 * hole means a file has not been imported or tagged yet, which is ordinary work in progress, while
 * these mean the set does not describe anything coherent and no import can fix it.
 */
export type AssetSetProblem =
    | { kind: "noAxes" }
    | { kind: "duplicateAxis"; axisKey: string }
    | { kind: "emptyAxisKey"; index: number }
    | { kind: "emptyAxisValues"; axisKey: string }
    | { kind: "duplicateAxisValue"; axisKey: string; value: string }
    /** A build axis sits inside a runtime one. See the module note. */
    | { kind: "residencyInversion"; axisKey: string; outerAxisKey: string };

export function validateAssetSet(set: AssetSet): AssetSetProblem[] {
    const problems: AssetSetProblem[] = [];
    if (set.axes.length === 0) {
        problems.push({ kind: "noAxes" });
    }

    const seenKeys = new Set<string>();
    for (const [index, axis] of set.axes.entries()) {
        const key = axis.key.trim();
        if (!key) {
            problems.push({ kind: "emptyAxisKey", index });
        } else if (seenKeys.has(key)) {
            problems.push({ kind: "duplicateAxis", axisKey: key });
        } else {
            seenKeys.add(key);
        }

        if (axis.values.length === 0) {
            problems.push({ kind: "emptyAxisValues", axisKey: key });
        }
        const seenValues = new Set<string>();
        for (const value of axis.values) {
            const trimmed = value.trim();
            if (seenValues.has(trimmed)) {
                problems.push({ kind: "duplicateAxisValue", axisKey: key, value: trimmed });
            }
            seenValues.add(trimmed);
        }
    }

    problems.push(...residencyInversions(set.axes));
    return problems;
}

/**
 * Every axis that sits further in than an axis it may not sit inside.
 *
 * Reported against the **outermost** offending axis rather than the nearest one, so an author who
 * moved one runtime axis to the top is told about that axis once instead of about every build axis
 * below it separately.
 */
function residencyInversions(axes: readonly AssetSetAxis[]): AssetSetProblem[] {
    const problems: AssetSetProblem[] = [];
    let outermostRuntime: AssetSetAxis | null = null;
    for (const axis of axes) {
        if (outermostRuntime
            && ASSET_AXIS_RESIDENCY_ORDER[axis.residency] < ASSET_AXIS_RESIDENCY_ORDER[outermostRuntime.residency]) {
            problems.push({
                kind: "residencyInversion",
                axisKey: axis.key,
                outerAxisKey: outermostRuntime.key,
            });
            continue;
        }
        if (axis.residency === "runtime" && !outermostRuntime) {
            outermostRuntime = axis;
        }
    }
    return problems;
}

/**
 * Whether an axis list would be a legal nesting - what the editor asks before it accepts a move or
 * a residency change, so the contradiction never reaches the document.
 */
export function isLegalAxisOrder(axes: readonly AssetSetAxis[]): boolean {
    return residencyInversions(axes).length === 0;
}

/* -------------------------------------------------------------------------- */
/* Normalisation                                                               */
/* -------------------------------------------------------------------------- */

function normalizeStringList(raw: unknown): string[] {
    if (!Array.isArray(raw)) {
        return [];
    }
    const seen = new Set<string>();
    const out: string[] = [];
    for (const entry of raw) {
        if (typeof entry !== "string") {
            continue;
        }
        const trimmed = entry.trim();
        if (!trimmed || seen.has(trimmed)) {
            continue;
        }
        seen.add(trimmed);
        out.push(trimmed);
    }
    return out;
}

function normalizeAxis(raw: unknown): AssetSetAxis | null {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const key = typeof record.key === "string" ? record.key.trim() : "";
    if (!key) {
        return null;
    }
    return {
        key,
        // An unreadable residency reads as `build`, the conservative answer: a variant wrongly kept
        // out of a package is a missing file, and a variant wrongly shipped is the failure this
        // model exists to prevent.
        residency: isAssetAxisResidency(record.residency) ? record.residency : "build",
        values: normalizeStringList(record.values),
    };
}

export function normalizeAssetSet(raw: unknown): AssetSet | null {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return null;
    }
    const record = raw as Record<string, unknown>;
    const id = typeof record.id === "string" ? record.id.trim() : "";
    const type = typeof record.type === "string" ? record.type.trim() : "";
    if (!id || !type) {
        return null;
    }
    const axes: AssetSetAxis[] = [];
    const seenKeys = new Set<string>();
    if (Array.isArray(record.axes)) {
        for (const entry of record.axes) {
            const axis = normalizeAxis(entry);
            // A repeated key is dropped rather than kept as a second axis: two axes over one tag
            // category index the same tag twice, and every coordinate where they disagree matches
            // nothing at all. Keeping the first is the reading that preserves the outer nesting.
            if (axis && !seenKeys.has(axis.key)) {
                seenKeys.add(axis.key);
                axes.push(axis);
            }
        }
    }
    return {
        id,
        name: typeof record.name === "string" ? record.name.trim() : "",
        type,
        filter: normalizeStringList(record.filter),
        axes,
    };
}

/**
 * Read a whole document defensively.
 *
 * Order is preserved and nothing is reordered to satisfy the nesting rule. A document that violates
 * it is reported by the checks and shown as a fault in the inspector, because silently moving an
 * author's axes would change which variants a build carries without anyone deciding to.
 */
export function normalizeProjectAssetSets(raw: unknown): ProjectAssetSetDocument {
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
        return createEmptyAssetSetDocument();
    }
    const record = raw as Record<string, unknown>;
    const sets: AssetSet[] = [];
    const seenIds = new Set<string>();
    if (Array.isArray(record.sets)) {
        for (const entry of record.sets) {
            const set = normalizeAssetSet(entry);
            if (set && !seenIds.has(set.id)) {
                seenIds.add(set.id);
                sets.push(set);
            }
        }
    }
    return { version: ASSET_SET_SCHEMA_VERSION, sets };
}

export function migrateProjectAssetSetDocument(raw: unknown): ProjectAssetSetDocument {
    return normalizeProjectAssetSets(raw);
}

/**
 * A name no other set in the project has, numbering rather than refusing.
 *
 * The same bargain `uniqueAppTagName` makes: a rejected edit leaves the author looking at a name
 * the project does not have, while a numbered one is visible and editable.
 */
export function uniqueAssetSetName(desired: string, taken: readonly string[]): string {
    const base = desired.trim() || "Set";
    const used = new Set(taken.map(name => name.trim().toLowerCase()));
    if (!used.has(base.toLowerCase())) {
        return base;
    }
    for (let suffix = 2; ; suffix++) {
        const candidate = `${base} ${suffix}`;
        if (!used.has(candidate.toLowerCase())) {
            return candidate;
        }
    }
}
