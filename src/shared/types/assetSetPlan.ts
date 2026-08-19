/**
 * Planning an asset set from the names of the files it is made of.
 *
 * `assetSet.ts` is the model: a set names its members by tag, and an author who has already tagged
 * their files can be handed a set derived from those tags. This module is the step before that -
 * turning `alice-happy-en.png` into the tags in the first place, so that declaring a set is one
 * action rather than three.
 *
 * # Why the plan is computed, not applied, first
 *
 * Everything here answers what a set *would* be, given a way of reading the file names. The wizard
 * draws that answer - which coordinates resolve, which have no file, which have two - before
 * anything is written. The alternative, writing the tags and then showing the result, makes the
 * author undo a tagging pass to change their mind about a category name.
 *
 * The preview and the write therefore have to come from the same function, which is the reason this
 * is a module of pure functions rather than logic inside the dialog: a preview computed one way and
 * a write performed another is a dialog that shows a set the project does not get.
 *
 * # The plan is derived, never a second derivation rule
 *
 * {@link planAssetSet} produces the tags each file will carry and then hands them to
 * `deriveAssetSetDraft` - the same reading of a library the panel already used. So a set made
 * through the wizard is exactly the set the model would derive from those files afterwards, and
 * there is no second definition of "what these files have in common" to keep in step.
 *
 * # Order is not cosmetic
 *
 * Axis order is the nesting, and a build axis may not sit inside a runtime one (see `assetSet.ts`).
 * A wizard that emitted axes in the order the author happened to name them could therefore produce a
 * set that is invalid the moment it exists, which the author would then have to repair in the
 * inspector without having done anything wrong. {@link planAssetSet} sorts by residency for that
 * reason, and keeps the author's order within each residency.
 */

import {
    deriveAssetSetDraft,
    formatAssetTag,
    parseAssetTag,
    ASSET_AXIS_RESIDENCY_ORDER,
    type AssetAxisResidency,
    type AssetSetAxis,
} from "./assetSet";

/** One file a set is being planned from. */
export interface AssetSetPlanFile {
    id: string;
    /** The file's name, split at the delimiter the author chose. Extension already removed. */
    segments: readonly string[];
    /** Tags the row carries today. Kept unless a named position overwrites that category. */
    tags: readonly string[];
}

/**
 * What one position in the file names is read as.
 *
 * An empty category means the position says nothing and is left out of the plan entirely - not
 * every segment of a file name is about what the file is (`v2`, `final`, an artist's initials), and
 * a position nobody named should not become a tag nobody meant.
 */
export interface AssetSetSegmentRole {
    category: string;
    residency: AssetAxisResidency;
}

export interface AssetSetPlan {
    /** What each file will be tagged with, by file id. Only files whose tags actually change. */
    tagsByFile: Map<string, string[]>;
    filter: string[];
    axes: AssetSetAxis[];
}

/**
 * Split a file name into the positions an author names.
 *
 * Splits on every chosen delimiter at once, because a name like `alice-happy_en` mixes them and an
 * author reading it sees three parts rather than a choice between two readings. Empty parts are
 * dropped: `alice--happy` is two positions, not three, and a blank position could never be a tag.
 */
export function splitAssetName(name: string, delimiters: readonly string[]): string[] {
    const trimmed = name.trim();
    if (!trimmed) {
        return [];
    }
    const active = delimiters.filter(delimiter => delimiter.length > 0);
    if (active.length === 0) {
        return [trimmed];
    }
    let parts = [trimmed];
    for (const delimiter of active) {
        parts = parts.flatMap(part => part.split(delimiter));
    }
    return parts.map(part => part.trim()).filter(Boolean);
}

/** The distinct values a position takes across the files, in the order they are first seen. */
export function segmentValues(files: readonly AssetSetPlanFile[], index: number): string[] {
    const values: string[] = [];
    for (const file of files) {
        const value = file.segments[index]?.trim();
        if (value && !values.includes(value)) {
            values.push(value);
        }
    }
    return values;
}

/** How many positions the names have, counted on the longest of them. */
export function segmentCount(files: readonly AssetSetPlanFile[]): number {
    return files.reduce((count, file) => Math.max(count, file.segments.length), 0);
}

/**
 * The tags one file will carry under a plan.
 *
 * A named category replaces whatever the file already had under it rather than joining it: two
 * values of one category on one file make that file answer to two coordinates at once, which the
 * set then reports as ambiguous everywhere. Every other tag is left alone - a file may well be in
 * more than one set, and carry labels that are nobody's axis.
 */
export function planFileTags(file: AssetSetPlanFile, roles: readonly AssetSetSegmentRole[]): string[] {
    const written = new Map<string, string>();
    roles.forEach((role, index) => {
        const category = role.category.trim();
        const value = file.segments[index]?.trim();
        if (category && value) {
            written.set(category, value);
        }
    });
    if (written.size === 0) {
        return [...file.tags];
    }

    const kept = file.tags.filter(tag => {
        const pair = parseAssetTag(tag);
        return !pair || !written.has(pair.category);
    });
    return [...kept, ...[...written].map(([category, value]) => formatAssetTag(category, value))];
}

/**
 * The set these files describe once the plan is written to them.
 *
 * Residency comes from the roles because it is the one thing the file names cannot say: whether a
 * variant survives the build is a decision about the edition being shipped, not a fact about the
 * artwork. Categories the author did not name keep whatever `deriveAssetSetDraft` gives them, which
 * is `build` - the residency that keeps bytes out of a package.
 */
export function planAssetSet(
    files: readonly AssetSetPlanFile[],
    roles: readonly AssetSetSegmentRole[],
    type: string,
): AssetSetPlan {
    const tagsByFile = new Map<string, string[]>();
    const candidates = files.map(file => {
        const tags = planFileTags(file, roles);
        tagsByFile.set(file.id, tags);
        return { id: file.id, type, tags };
    });

    const draft = deriveAssetSetDraft(candidates);
    const residencyOf = new Map<string, AssetAxisResidency>();
    const namedOrder: string[] = [];
    for (const role of roles) {
        const category = role.category.trim();
        if (category && !residencyOf.has(category)) {
            residencyOf.set(category, role.residency);
            namedOrder.push(category);
        }
    }

    const axes = draft.axes.map(axis => ({
        ...axis,
        residency: residencyOf.get(axis.key) ?? axis.residency,
    }));

    // The author's naming order first, anything derived from tags they did not touch after it, and
    // the whole thing then arranged by residency because that arrangement is the one the model
    // refuses to be without.
    const rank = (axis: AssetSetAxis) => {
        const named = namedOrder.indexOf(axis.key);
        return named >= 0 ? named : namedOrder.length + draft.axes.findIndex(other => other.key === axis.key);
    };
    axes.sort((left, right) => {
        const residency = ASSET_AXIS_RESIDENCY_ORDER[left.residency] - ASSET_AXIS_RESIDENCY_ORDER[right.residency];
        return residency !== 0 ? residency : rank(left) - rank(right);
    });

    return { tagsByFile, filter: draft.filter, axes };
}

/**
 * A first reading of the file names, for the wizard to open with.
 *
 * Two things are suggested, and only where there is evidence for them:
 *
 *  - **A category**, when every file already carries one whose value is that file's segment. That is
 *    the case an author reaches after running the magic tag pass, and re-typing the same category
 *    names would be asking them to declare what the project already knows.
 *  - **`runtime` residency**, when the position's values are all languages this project declares.
 *    A locale axis has to be resolved by the running game - every language's file ships - and the
 *    model's own default is the opposite, so an author who did not know to change it would ship a
 *    game with one language's artwork. The evidence is the project's declared locale list, not the
 *    shape of the strings: `en` is a language here because this project says it has one.
 */
export function suggestSegmentRoles(
    files: readonly AssetSetPlanFile[],
    localeCodes: readonly string[],
): AssetSetSegmentRole[] {
    const locales = new Set(localeCodes.map(code => code.trim()).filter(Boolean));
    const roles: AssetSetSegmentRole[] = [];
    for (let index = 0; index < segmentCount(files); index++) {
        const values = segmentValues(files, index);
        roles.push({
            category: suggestCategory(files, index),
            residency: values.length > 1 && values.every(value => locales.has(value)) ? "runtime" : "build",
        });
    }
    return roles;
}

/** The category every file already reads this position as, or empty when they do not agree on one. */
function suggestCategory(files: readonly AssetSetPlanFile[], index: number): string {
    const first = files[0];
    if (!first) {
        return "";
    }
    const value = first.segments[index]?.trim();
    if (!value) {
        return "";
    }
    for (const tag of first.tags) {
        const pair = parseAssetTag(tag);
        if (!pair || pair.value !== value) {
            continue;
        }
        const agreed = files.every(file => {
            const own = file.segments[index]?.trim();
            return own ? file.tags.some(other => {
                const otherPair = parseAssetTag(other);
                return otherPair?.category === pair.category && otherPair.value === own;
            }) : false;
        });
        if (agreed) {
            return pair.category;
        }
    }
    return "";
}
