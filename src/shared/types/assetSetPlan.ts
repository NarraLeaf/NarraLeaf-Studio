/**
 * Planning an asset set from the files an author selected.
 *
 * `assetSet.ts` is the model: a set names its members by tag, and the tags are what the build and
 * the running game resolve against. This module is the step before that - deciding which file is
 * which variant, and what tags that means writing.
 *
 * # The author picks from lists the project already has
 *
 * A set varies by one of two things, and both are lists the project declares elsewhere: its
 * languages, or its editions. So the wizard asks two questions - which of the two, and which file is
 * which - and never asks for a tag category, a value, or a residency. Everything a set used to make
 * the author type was a second copy of something the project already knew.
 *
 * # The set's own tag is what keeps it a set
 *
 * Members carry `set:<id>` for the set they belong to, plus one tag per level of nesting. Without it
 * a set of `locale` files would mean "every file in the project with a language", which is not a set
 * an author ever means. The id rather than the name, because a name is a thing an author changes.
 *
 * # The preview and the write come from here, both
 *
 * The wizard draws what the project will hold before anything is written, and a preview computed
 * separately from the write is a dialog that can show a set the project does not get.
 */

import {
    formatAssetTag,
    makeAssetSetAxis,
    parseAssetTag,
    type AssetSet,
    type AssetSetAxis,
    type AssetSetAxisKind,
} from "./assetSet";

/** The tag category a set's own identity is written under. */
export const ASSET_SET_TAG_CATEGORY = "set";

/** The tag every member of a set carries. */
export function assetSetIdentityTag(setId: string): string {
    return formatAssetTag(ASSET_SET_TAG_CATEGORY, setId);
}

/** One file a set is being planned from. */
export interface AssetSetPlanFile {
    id: string;
    /** The file's name as the library shows it, without its extension. */
    name: string;
    /** Tags the row carries today. Kept unless this plan claims that category. */
    tags: readonly string[];
}

/** One value of the axis, and what the project calls it. */
export interface AssetSetPlanValue {
    /** What goes in the tag: a language code, or an edition id. */
    value: string;
    /** What the author reads: a language's name, or an edition's name. */
    label: string;
}

export interface AssetSetPlan {
    /** The axis the set will declare. */
    axis: AssetSetAxis;
    /** Value to the file answering it, in the order the values were given. Absent values are holes. */
    members: Map<string, string>;
    /** What each file will be tagged with, by file id. */
    tagsByFile: Map<string, string[]>;
    /** The tags every member carries: the set's own, plus the coordinate it hangs at. */
    filter: string[];
}

/**
 * Which file answers which value, guessed from the file names.
 *
 * A file whose name contains a value's own word - `title_zh-CN`, `alice_demo` - is that value's
 * file. Matched on the longest value first, so `zh-CN` wins over a hypothetical `zh`, and each file
 * is used once: two files claiming one value would otherwise both be dropped into it and the second
 * would silently replace the first.
 *
 * A guess, and shown as one: the wizard draws it into controls the author can change before
 * anything is written.
 */
export function suggestAssetSetMembers(
    files: readonly AssetSetPlanFile[],
    values: readonly AssetSetPlanValue[],
): Map<string, string> {
    const members = new Map<string, string>();
    const taken = new Set<string>();
    const ordered = [...values].sort((left, right) => right.value.length - left.value.length);
    for (const entry of ordered) {
        const needle = entry.value.toLowerCase();
        const match = files.find(file => !taken.has(file.id) && file.name.toLowerCase().includes(needle));
        if (match) {
            members.set(entry.value, match.id);
            taken.add(match.id);
        }
    }
    return members;
}

/**
 * What the project will hold once the author confirms.
 *
 * `parent` is the set this one hangs under, when the author is making a sub-set: its members carry
 * everything the parent's members carry plus the value it hangs at, which is what the model reads
 * nesting from.
 */
export function planAssetSet(input: {
    setId: string;
    kind: AssetSetAxisKind;
    values: readonly AssetSetPlanValue[];
    files: readonly AssetSetPlanFile[];
    members: ReadonlyMap<string, string>;
    parent?: { set: AssetSet; value: string };
}): AssetSetPlan {
    const filter = input.parent
        ? [...input.parent.set.filter, formatAssetTag(input.parent.set.axis.key, input.parent.value)]
        : [assetSetIdentityTag(input.setId)];
    const axis = makeAssetSetAxis(input.kind, input.values.map(entry => entry.value));

    const tagsByFile = new Map<string, string[]>();
    const members = new Map<string, string>();
    for (const entry of input.values) {
        const fileId = input.members.get(entry.value);
        const file = fileId ? input.files.find(candidate => candidate.id === fileId) : undefined;
        if (!file) {
            continue;
        }
        members.set(entry.value, file.id);
        tagsByFile.set(file.id, writeTags(file, [...filter, formatAssetTag(axis.key, entry.value)]));
    }
    return { axis, members, tagsByFile, filter };
}

/**
 * A file's tags once this set claims it.
 *
 * A claimed category replaces whatever the file carried under it: two values of one category make
 * one file answer to two variants at once, which every set it belongs to then reports as ambiguous.
 * Everything else is left alone - a file carries the author's own labels, and may be a member of a
 * set that varies by something else.
 */
function writeTags(file: AssetSetPlanFile, written: readonly string[]): string[] {
    const claimed = new Set<string>();
    for (const tag of written) {
        const pair = parseAssetTag(tag);
        if (pair) {
            claimed.add(pair.category);
        }
    }
    const kept = file.tags.filter(tag => {
        const pair = parseAssetTag(tag);
        return !pair || !claimed.has(pair.category);
    });
    return [...kept, ...written];
}
