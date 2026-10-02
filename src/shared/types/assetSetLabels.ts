/**
 * Reading a set's coordinate back in the words the project already uses.
 *
 * A coordinate is stored as the tag it is made of, and `assetSetCoordinateLabel` writes it that way
 * (`locale:zh-CN`). That spelling is for the files and the build. It is the wrong spelling anywhere an
 * author reads it: `zh-CN` is a code the project already knows as a language with a name, and an
 * edition's value is its id - a uuid for every edition an author made.
 *
 * Both axis kinds name something the project declares - a language, or an edition - so this is a
 * lookup rather than a guess. A language the project no longer declares prints as its code, which
 * happens while a language is being removed and a set still promises it. An edition that is no
 * longer there has no name left to print, and its id is never shown in its place.
 */

import { APP_TAG_ID_RELEASE, migrateAppTagId, RELEASE_APP_TAG } from "./appTag";
import {
    isAssetSetAxisKind,
    parseAssetTag,
    type AssetSet,
    type AssetSetAxis,
    type AssetSetAxisKind,
    type AssetSetCoordinate,
} from "./assetSet";
import { ASSET_SET_TAG_CATEGORY } from "./assetSetPlan";

/** What a project knows that lets a coordinate be read in words rather than in tags. */
export interface AssetSetAxisNaming {
    /** Declared languages, by code. */
    locales: ReadonlyMap<string, string>;
    /** Editions, by id. */
    editions: ReadonlyMap<string, string>;
    /** The word for each kind, and what an edition the project no longer has is called. Translated by the caller. */
    words: { language: string; edition: string; deletedEdition: string };
}

/** One axis of a coordinate, as a row prints it. */
export interface AssetSetAxisReading {
    axis: string;
    value: string;
}

/**
 * An edition's name, or the word for one that is gone.
 *
 * The release edition is synthesized rather than stored, so it is named here even when the caller's
 * list has not been read yet: it is `main` in every project and every language. Any other id the list
 * does not hold belongs to an edition that was deleted, and the id is a uuid nobody should read.
 */
function readEditionName(id: string, naming: AssetSetAxisNaming): string {
    const current = migrateAppTagId(id);
    const named = naming.editions.get(id) ?? naming.editions.get(current);
    if (named) {
        return named;
    }
    return current === APP_TAG_ID_RELEASE ? RELEASE_APP_TAG.name : naming.words.deletedEdition;
}

/** One value of one axis kind, in the project's words. */
export function readAssetSetAxisValue(
    kind: AssetSetAxisKind,
    value: string,
    naming: AssetSetAxisNaming,
): AssetSetAxisReading {
    const trimmed = value.trim();
    return kind === "locale"
        ? { axis: naming.words.language, value: naming.locales.get(trimmed) ?? trimmed }
        : { axis: naming.words.edition, value: readEditionName(trimmed, naming) };
}

export function readAssetSetAxis(
    axis: AssetSetAxis,
    value: string,
    naming: AssetSetAxisNaming,
): AssetSetAxisReading {
    return readAssetSetAxisValue(axis.kind, value, naming);
}

/** The set's axis as a row prints it, or nothing when the coordinate says nothing about it. */
export function readAssetSetCoordinate(
    set: AssetSet,
    coordinate: AssetSetCoordinate,
    naming: AssetSetAxisNaming,
): AssetSetAxisReading[] {
    const value = coordinate[set.axis.key];
    return value === undefined ? [] : [readAssetSetAxis(set.axis, value, naming)];
}

/** One coordinate on one line, for a row that has a line and not a column per axis. */
export function formatAssetSetCoordinateReading(readings: readonly AssetSetAxisReading[]): string {
    return readings.map(reading => `${reading.axis}: ${reading.value}`).join(" · ");
}

/**
 * A file's tag as a tag list prints it, or null for a tag no list prints.
 *
 * Three kinds of tag share a file's list, and only one of them was ever typed by the author:
 *
 *  - `set:<id>` says which set a file belongs to. It is bookkeeping - a set is drawn as a folder,
 *    and its members inside it - and its value is the set's id. Not printed.
 *  - `locale:<code>` and `release:<id>` say which value of its set a file answers. They are printed
 *    the way the set's own rows print a value (`Language: 日本語`, `Variant: DLC`), because removing
 *    one is how a file stops answering it and the author has to be able to tell which one it is.
 *  - Anything else is the author's own label, and prints as it was written.
 *
 * The tag itself is never rewritten: what is stored is what the build and the sets resolve against.
 */
export function readAssetTag(tag: string, naming: AssetSetAxisNaming): string | null {
    const pair = parseAssetTag(tag);
    if (!pair) {
        return tag;
    }
    if (pair.category === ASSET_SET_TAG_CATEGORY) {
        return null;
    }
    if (isAssetSetAxisKind(pair.category)) {
        return formatAssetSetCoordinateReading([readAssetSetAxisValue(pair.category, pair.value, naming)]);
    }
    return tag;
}

/** The tags a list prints, in their stored order, each with the stored tag it stands for. */
export function readAssetTags(
    tags: readonly string[],
    naming: AssetSetAxisNaming,
): Array<{ tag: string; label: string }> {
    const out: Array<{ tag: string; label: string }> = [];
    for (const tag of tags) {
        const label = readAssetTag(tag, naming);
        if (label !== null) {
            out.push({ tag, label });
        }
    }
    return out;
}
