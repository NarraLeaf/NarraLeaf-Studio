/**
 * Asset sets - one asset library entry that stands for a family of files varying one way.
 *
 * An author who has `alice-happy-en.png`, `alice-happy-ja.png`, `alice-sad-en.png` and so on does
 * not want to name each of them at every reference site. An asset set is the entry they name
 * instead: it declares the one axis those files vary along, and a reference carries only the set's
 * id.
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
 * # One axis per set, and sub-sets for the rest
 *
 * A set has exactly one axis. Two kinds of variation - an edition and a language, say - are two
 * sets, one hanging under a value of the other, and the author says so by making the second set.
 * Nothing here combines two axes into a grid on its own.
 *
 * That is a decision about what a set *is*, not a limitation. A set the author reads as "Alice"
 * answers one question about Alice; a grid answers several at once and belongs to nobody, so the
 * holes in it are combinations no one ever meant to have. It also matches the two ways a set is
 * used: a folder in the library, and one name at the reference site.
 *
 * # Sub-sets are read from the tags, like everything else
 *
 * A set hangs under a value of another when it declares that value's tag on top of everything the
 * parent declares, and exactly one tag more. `{char:alice}` varying by `mood` is the parent of
 * `{char:alice, mood:sad}` varying by `locale`. Making a sub-set is therefore making an ordinary
 * set out of the files under one value - there is no parent field to keep in step, and moving a
 * file between them is retagging it, which is the same thing membership already is.
 *
 * # Why a build axis may not sit inside a runtime axis
 *
 * "Runtime" is not a statement about one level. It says every value under this axis is in the
 * package, and that claim propagates down the whole subtree - the game may ask for any of them, so
 * all of them must be there. "Build" says the opposite about its own subtree: one value is in the
 * package and the rest must not be.
 *
 * A build axis under a runtime axis is therefore a subtree required to be wholly present by the set
 * above it and required to be partly absent by itself, and some variant has to be both in the
 * package and not in it. There is no build that satisfies both, so it is reported rather than left
 * to fail at build time.
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
 * A number rather than a pair of comparisons so the rule reads the same however deep the sets are
 * nested: a set's axis may not sit under a set whose axis has a larger number.
 */
export const ASSET_AXIS_RESIDENCY_ORDER: Readonly<Record<AssetAxisResidency, number>> = Object.freeze({
    build: 0,
    runtime: 1,
});

export const ASSET_AXIS_RESIDENCIES: readonly AssetAxisResidency[] = Object.freeze(["build", "runtime"]);

export function isAssetAxisResidency(value: unknown): value is AssetAxisResidency {
    return value === "build" || value === "runtime";
}

/**
 * What a set varies by, chosen from what the project already declares.
 *
 * Two kinds, and no others until Studio adds one. An axis used to be any tag category the author
 * typed, which made a set able to index by anything and made every set's values a second list to
 * keep in step with the first. Both of these are lists the project already has - its languages, and
 * its editions - so the values are read rather than declared, and a set cannot promise a variant
 * that does not correspond to anything the project ships.
 *
 *  - `locale` - one file per language, resolved by the running game.
 *  - `release` - one file per edition, resolved when the edition is built.
 *
 * The tag category each kind reads is fixed ({@link assetSetAxisKey}), so the tags on the files stay
 * what membership is made of and nothing about resolution changes.
 */
export type AssetSetAxisKind = "locale" | "release";

export const ASSET_SET_AXIS_KINDS: readonly AssetSetAxisKind[] = Object.freeze(["locale", "release"]);

export function isAssetSetAxisKind(value: unknown): value is AssetSetAxisKind {
    return value === "locale" || value === "release";
}

/** The tag category a kind reads. Fixed, so a file's tags say the same thing in every project. */
export function assetSetAxisKey(kind: AssetSetAxisKind): string {
    return kind;
}

/**
 * When a kind resolves.
 *
 * Not stored and not editable: a language axis has to be resolved by the running game, because a
 * player can change languages without rebuilding, and an edition axis has to be resolved when the
 * edition is built, because that is what keeps another edition's bytes out of the package. Neither
 * is a choice, and offering it as one was offering the author a way to be wrong.
 */
export function assetSetAxisResidency(kind: AssetSetAxisKind): AssetAxisResidency {
    return kind === "locale" ? "runtime" : "build";
}

/** One axis a set's members vary along. */
export interface AssetSetAxis {
    /** Which of the two things this set varies by. */
    kind: AssetSetAxisKind;
    /**
     * The tag category this axis reads, without the value - `locale`, not `locale:ja`.
     *
     * The axis is identified by the category rather than by an id of its own: the category is
     * already the name the tags on disk are written under, and a second identifier would be a
     * second thing to keep in step with them.
     */
    /** The tag category, always {@link assetSetAxisKey} of the kind. Stored so readers need no map. */
    key: string;
    residency: AssetAxisResidency;
    /**
     * The values this axis promises to cover, in project order.
     *
     * Languages, or edition ids. Still stored rather than read live, for the reason the module note
     * gives: the promise is what makes a missing variant reportable. What changed is where the
     * author gets them from - a list in the project, not a line they type.
     */
    values: string[];
    /**
     * The value every other one falls back to, and the only thing a set requires.
     *
     * A set says "this is the picture; these are the exceptions". Without it every value needed a
     * file of its own, which for a set that varies in one language out of six is five files the
     * author has to produce to say nothing changed. With it, a value with no file of its own
     * resolves to this one's, and only the exceptions are worth tagging.
     *
     * A value, not an asset id: the set still holds no member ids, so a file joins or leaves it by
     * being tagged, and renaming or deleting a file cannot leave a stale pointer here.
     */
    fallback: string;
}

/**
 * The axis a kind describes, over the values the project currently declares.
 *
 * The fallback defaults to the first value, which is the project's own first language or its
 * release edition - the answer an author would give for "which one is the normal one".
 */
export function makeAssetSetAxis(
    kind: AssetSetAxisKind,
    values: readonly string[],
    fallback?: string,
): AssetSetAxis {
    const list = [...values];
    return {
        kind,
        key: assetSetAxisKey(kind),
        residency: assetSetAxisResidency(kind),
        values: list,
        fallback: fallback && list.includes(fallback) ? fallback : list[0] ?? "",
    };
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
     * `mood:happy`". Empty is legal and means the axis alone says who belongs.
     *
     * Also what says where a set hangs: a set carrying everything another set's members carry, plus
     * one of that set's axis values, is a sub-set of it. See {@link childAssetSets}.
     */
    filter: string[];
    /** The one thing this set's members vary by. See the module note. */
    axis: AssetSetAxis;
    /**
     * The folder it is filed in, or absent for one at the top of its section.
     *
     * A set is a folder to whoever is browsing, so it is filed where it was made rather than at the
     * top of the section: a project with twenty of them would otherwise open on twenty rows before
     * the first folder. It is only where the row is drawn - a set holds no files, and its members
     * stay in whatever folder they were imported into.
     */
    groupId?: string;
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
 * Every coordinate a set promises, in author order.
 *
 * One per axis value, because a set has one axis. An axis with no values promises nothing, which is
 * correct and is what `validateAssetSet` tells the author about.
 */
export function assetSetCoordinates(set: AssetSet): AssetSetCoordinate[] {
    return set.axis.values.map(value => ({ [set.axis.key]: value }));
}

/**
 * A coordinate written as one string, axes in declaration order.
 *
 * For display and for keying a map. Reads like the tags it is made of (`char:alice · locale:ja`),
 * because the author's way of fixing a hole is to go and write those tags on a file.
 */
export function assetSetCoordinateLabel(set: AssetSet, coordinate: AssetSetCoordinate): string {
    return formatAssetTag(set.axis.key, coordinate[set.axis.key] ?? "");
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

/** The tags a member at this coordinate must carry: the set's fixed ones plus its axis value. */
export function assetSetCoordinateTags(set: AssetSet, coordinate: AssetSetCoordinate): string[] {
    const value = coordinate[set.axis.key];
    return value === undefined ? [...set.filter] : [...set.filter, formatAssetTag(set.axis.key, value)];
}

/* -------------------------------------------------------------------------- */
/* Nesting                                                                     */
/* -------------------------------------------------------------------------- */

/** The `category:value` tags a set declares, normalised, for comparing one set's filter to another's. */
function filterTags(set: AssetSet): Set<string> {
    const tags = new Set<string>();
    for (const tag of set.filter) {
        const pair = parseAssetTag(tag);
        tags.add(pair ? formatAssetTag(pair.category, pair.value) : tag.trim());
    }
    return tags;
}

/**
 * The sets hanging under one value of this one.
 *
 * A sub-set declares everything its parent declares plus that one value, and **exactly one tag
 * more**. The count is what makes "under" mean the level immediately below: a set declaring both
 * `mood:sad` and `locale:ja` describes something inside the `locale` set, and listing it under
 * `mood:sad` as well would draw the same family twice at two depths.
 */
export function childAssetSets(
    parent: AssetSet,
    value: string,
    sets: readonly AssetSet[],
): AssetSet[] {
    const required = filterTags(parent);
    required.add(formatAssetTag(parent.axis.key, value));
    return sets.filter(candidate => {
        if (candidate.id === parent.id || candidate.type !== parent.type) {
            return false;
        }
        const own = filterTags(candidate);
        if (own.size !== required.size) {
            return false;
        }
        for (const tag of required) {
            if (!own.has(tag)) {
                return false;
            }
        }
        return true;
    });
}

/** The set this one hangs under, and the value it hangs at, or null when it stands on its own. */
export function assetSetParent(
    set: AssetSet,
    sets: readonly AssetSet[],
): { set: AssetSet; value: string } | null {
    for (const candidate of sets) {
        if (candidate.id === set.id) {
            continue;
        }
        for (const value of candidate.axis.values) {
            if (childAssetSets(candidate, value, [set]).length > 0) {
                return { set: candidate, value };
            }
        }
    }
    return null;
}

/** The sets a library lists at its top level: the ones that hang under nothing. */
export function topLevelAssetSets(sets: readonly AssetSet[]): AssetSet[] {
    return sets.filter(set => assetSetParent(set, sets) === null);
}

/**
 * A set and everything drawn inside it, outermost first.
 *
 * What a command aimed at one row has to act on, because a sub-set is drawn inside its parent and
 * nowhere else: moving the parent to another folder and leaving the children behind would file them
 * somewhere the author cannot see until the parent stops holding them.
 *
 * Read from the tags like every other reading of nesting, so a set that stops being a sub-set by
 * being retagged leaves this subtree without anything having to be kept in step.
 */
export function assetSetSubtree(root: AssetSet, sets: readonly AssetSet[]): AssetSet[] {
    const collected: AssetSet[] = [root];
    const seen = new Set<string>([root.id]);
    for (let index = 0; index < collected.length; index++) {
        const current = collected[index];
        for (const value of current.axis.values) {
            for (const child of childAssetSets(current, value, sets)) {
                if (!seen.has(child.id)) {
                    seen.add(child.id);
                    collected.push(child);
                }
            }
        }
    }
    return collected;
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
    /** The axis value this cell stands for. */
    value: string;
    /** Every file carrying this coordinate's tags. None is not a hole - see {@link assetId}. */
    assetIds: string[];
    /**
     * The file this value actually resolves to, fallback included, or null when nothing does.
     *
     * What every reader outside the editor wants: the build, the running game and the reference
     * index all ask "which file is this value" and none of them cares whether the answer came from
     * a tag of its own or from the fallback.
     */
    assetId: string | null;
    /** True when {@link assetId} is the fallback's file rather than one tagged for this value. */
    inherited: boolean;
    /**
     * Sets hanging under this value, if any.
     *
     * A value answered by a sub-set is not a hole: what it resolves to is decided one level down.
     * More than one is a fault, in the same way two files are.
     */
    childSetIds: string[];
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
    sets: readonly AssetSet[] = [],
): AssetSetContents {
    const fallbackAssetId = resolveAssetSetFallbackAsset(set, candidates);
    const cells: AssetSetCell[] = assetSetCoordinates(set).map(coordinate => {
        const value = coordinate[set.axis.key] ?? "";
        const assetIds = matchAssetSetCoordinate(set, coordinate, candidates);
        const childSetIds = childAssetSets(set, value, sets).map(child => child.id);
        // Ambiguity does not fall back. Two files claiming one value is a fault the author has to
        // resolve, and quietly using the fallback instead would hide it behind a picture that works.
        const own = assetIds.length === 1 ? assetIds[0] : null;
        const inherited = own === null && assetIds.length === 0 && childSetIds.length === 0;
        return {
            coordinate,
            label: assetSetCoordinateLabel(set, coordinate),
            value,
            assetIds,
            assetId: own ?? (inherited ? fallbackAssetId : null),
            inherited: inherited && fallbackAssetId !== null,
            childSetIds,
        };
    });
    return {
        cells,
        // A value with no file of its own is not a hole while the fallback answers it; what is left
        // here is the set whose fallback itself resolves to nothing, and then every value is a hole
        // because there is nothing for any of them to fall back to.
        // A sub-set answers its value, and answers it alone. The files it holds carry this set's
        // coordinate too - that is what makes them its members - so counting them here as well would
        // report every nested set as ambiguous with its own contents.
        missing: cells.filter(cell => cell.childSetIds.length === 0
            && cell.assetIds.length === 0
            && cell.assetId === null),
        ambiguous: cells.filter(cell => (cell.childSetIds.length === 0 && cell.assetIds.length > 1)
            || cell.childSetIds.length > 1),
    };
}

/**
 * The file the fallback value resolves to, or null when the library does not say unambiguously.
 *
 * Read on its own rather than off the cells, because every other cell's answer depends on it: a set
 * whose fallback has no file promises variants nothing can answer, however many of the others are
 * tagged.
 */
export function resolveAssetSetFallbackAsset(
    set: AssetSet,
    candidates: readonly AssetSetCandidate[],
): string | null {
    const fallback = set.axis.fallback?.trim();
    if (!fallback || !set.axis.values.includes(fallback)) {
        return null;
    }
    return resolveAssetSetMember(set, { [set.axis.key]: fallback }, candidates);
}

/**
 * The one file a value means, the fallback included.
 *
 * The single entry point for "what does this set resolve to here", so the build, the preview and
 * the reference index cannot disagree about whether a value falls back.
 */
export function resolveAssetSetValue(
    set: AssetSet,
    value: string,
    candidates: readonly AssetSetCandidate[],
): string | null {
    const matches = matchAssetSetCoordinate(set, { [set.axis.key]: value }, candidates);
    if (matches.length === 1) {
        return matches[0];
    }
    if (matches.length > 1) {
        return null;
    }
    return resolveAssetSetFallbackAsset(set, candidates);
}

/** Whether a set resolves everything it promises. What the panel tints a row on. */
export function isAssetSetComplete(
    set: AssetSet,
    candidates: readonly AssetSetCandidate[],
    sets: readonly AssetSet[] = [],
): boolean {
    const contents = resolveAssetSetContents(set, candidates, sets);
    return contents.missing.length === 0 && contents.ambiguous.length === 0;
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
    /** The set names no tag category to vary by, so it describes one file at most. */
    | { kind: "noAxes" }
    | { kind: "emptyAxisValues"; axisKey: string }
    | { kind: "duplicateAxisValue"; axisKey: string; value: string }
    /** No value is named as the one the others fall back to, or the named one is not on the axis. */
    | { kind: "noFallback"; axisKey: string }
    /** A set resolved when built hangs under one resolved while running. See the module note. */
    | { kind: "residencyInversion"; axisKey: string; outerAxisKey: string };

export function validateAssetSet(set: AssetSet, sets: readonly AssetSet[] = []): AssetSetProblem[] {
    const problems: AssetSetProblem[] = [];
    const key = set.axis.key.trim();
    if (!key) {
        problems.push({ kind: "noAxes" });
    }
    if (set.axis.values.length === 0) {
        problems.push({ kind: "emptyAxisValues", axisKey: key });
    }
    const seenValues = new Set<string>();
    for (const value of set.axis.values) {
        const trimmed = value.trim();
        if (seenValues.has(trimmed)) {
            problems.push({ kind: "duplicateAxisValue", axisKey: key, value: trimmed });
        }
        seenValues.add(trimmed);
    }
    // Only reported for an axis that has values at all: a set with none is already incoherent for a
    // reason the author can act on, and "and it has no fallback" is the same news twice.
    if (set.axis.values.length > 0 && !set.axis.values.includes(set.axis.fallback?.trim() ?? "")) {
        problems.push({ kind: "noFallback", axisKey: key });
    }

    // Reported on the inner set, which is the one whose position can be changed: the outer set is
    // often shared by several sub-sets and moving it would answer for all of them.
    const parent = assetSetParent(set, sets);
    if (parent && !isLegalNesting(parent.set.axis, set.axis)) {
        problems.push({ kind: "residencyInversion", axisKey: key, outerAxisKey: parent.set.axis.key });
    }
    return problems;
}

/**
 * Whether one set may hang under another - what the editor asks before it accepts a residency
 * change, so the contradiction is reported rather than left to fail at build time.
 */
export function isLegalNesting(outer: AssetSetAxis, inner: AssetSetAxis): boolean {
    return ASSET_AXIS_RESIDENCY_ORDER[inner.residency] >= ASSET_AXIS_RESIDENCY_ORDER[outer.residency];
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
    // A record written before the kinds existed says only a tag category, and only two categories
    // still mean anything. A set indexed by `mood` is not read as an edition axis under another
    // name: its members carry `mood:` tags, so it would resolve to nothing while looking declared.
    // Refusing it drops the declaration and leaves the files alone, which the author can see.
    const kind = isAssetSetAxisKind(record.kind)
        ? record.kind
        : isAssetSetAxisKind(key) ? key : null;
    if (!kind) {
        return null;
    }
    // Key and residency are derived from the kind rather than read, so a hand-edited file cannot
    // produce a set that indexes one tag and claims another, or one that ships when it should not.
    //
    // A record written before the fallback existed names none, and `makeAssetSetAxis` takes the
    // first value - the project's own first language, or its release edition. That is what those
    // sets already meant to an author who filled every variant, and it is the only reading that does
    // not turn every set in an existing project into one the panel reports as unfinished.
    const fallback = typeof record.fallback === "string" ? record.fallback.trim() : undefined;
    return { ...makeAssetSetAxis(kind, normalizeStringList(record.values), fallback) };
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
    // `axes` is the shape sets were stored in while a set could hold several. It is read here so a
    // project written by that build still opens; `splitLegacyAxes` is what turns the rest of the
    // list into the sub-sets they are now.
    const legacy = Array.isArray(record.axes) ? record.axes : [];
    // No axis it can still express means no set: the record described something the model has no
    // way to resolve, and keeping it would put a row in the library that answers nothing.
    const axis = normalizeAxis(record.axis) ?? normalizeAxis(legacy[0]);
    if (!axis) {
        return null;
    }
    const groupId = typeof record.groupId === "string" ? record.groupId.trim() : "";
    return {
        id,
        name: typeof record.name === "string" ? record.name.trim() : "",
        type,
        filter: normalizeStringList(record.filter),
        axis,
        // Omitted rather than stored empty, so "at the top of the section" is one state and not two.
        ...(groupId ? { groupId } : {}),
    };
}

/**
 * The sub-sets an old multi-axis record stands for, one per value of every axis but the first.
 *
 * A record saying "alice, by mood, then by locale" meant a grid. The same families written the way
 * this model states them are one set per branch, and the tags they declare are exactly the ones the
 * grid's coordinates were made of - so nothing about which file answers what changes.
 *
 * Ids are derived from the parent's rather than minted, because normalisation runs on every open
 * and a fresh id each time would be a different set every time the project was opened.
 */
function splitLegacyAxes(raw: unknown, set: AssetSet): AssetSet[] {
    if (typeof raw !== "object" || raw === null) {
        return [];
    }
    const record = raw as Record<string, unknown>;
    if (!Array.isArray(record.axes) || record.axes.length < 2) {
        return [];
    }
    const axes = record.axes.map(normalizeAxis).filter((axis): axis is AssetSetAxis => axis !== null);
    const out: AssetSet[] = [];
    const walk = (parent: AssetSet, depth: number) => {
        const inner = axes[depth];
        if (!inner) {
            return;
        }
        for (const value of parent.axis.values) {
            const child: AssetSet = {
                id: `${parent.id}:${value}`,
                name: `${parent.name} ${value}`.trim(),
                type: parent.type,
                ...(parent.groupId ? { groupId: parent.groupId } : {}),
                filter: [...parent.filter, formatAssetTag(parent.axis.key, value)],
                axis: { ...inner, values: [...inner.values] },
            };
            out.push(child);
            walk(child, depth + 1);
        }
    };
    walk(set, 1);
    return out;
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
            if (!set || seenIds.has(set.id)) {
                continue;
            }
            seenIds.add(set.id);
            sets.push(set);
            for (const child of splitLegacyAxes(entry, set)) {
                if (!seenIds.has(child.id)) {
                    seenIds.add(child.id);
                    sets.push(child);
                }
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

/* -------------------------------------------------------------------------- */
/* Materialised answers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * A materialised asset set reference: set id, then axis value, then the asset that value resolves
 * to.
 *
 * **Never authored and never on disk under `editor/`.** A build writes one of these beside every
 * record that names a set with a runtime axis, and only there - see `@shared/build/*AssetSets` for
 * why the answer rides with the reference instead of going into one table the pack would carry.
 *
 * Declared here rather than beside the first content type that carried one, because it is now
 * written onto four unrelated shapes - a story row, a scene, a character's pose, a widget - and a
 * story type is the wrong home for the one a widget uses. `StoryAssetVariants` remains its name in
 * the story documents that had it first.
 */
export type AssetVariantMap = Record<string, Record<string, string>>;

/** Anything a build can write an answer onto: a row, a scene, a pose, an element, a surface. */
export type AssetVariantCarrier = { assetVariants?: AssetVariantMap };

/**
 * The asset a record's set reference resolves to for `locale`, or null when the record names no set
 * at all.
 *
 * The one function every consumer goes through: the story compiler on its way to a URL, the shipped
 * content check on its way to the bytes, and a widget on its way to a picture. Falling back to the
 * source locale is defence rather than policy - materialization already filled every locale, so
 * reaching that line means the pack and the project it was built from disagree, and one language's
 * picture is a better answer than none.
 */
export function resolveAssetVariantMember(
    variants: AssetVariantMap | undefined,
    assetId: string,
    locale: string | undefined,
    sourceLocale?: string,
): string | null {
    const map = variants?.[assetId];
    if (!map) {
        return null;
    }
    const direct = locale ? map[locale] : undefined;
    if (direct) {
        return direct;
    }
    const source = sourceLocale ? map[sourceLocale] : undefined;
    return source ?? null;
}
