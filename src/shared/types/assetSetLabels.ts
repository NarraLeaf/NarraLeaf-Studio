/**
 * Reading a set's coordinate back in the words the project already uses.
 *
 * A coordinate is stored as the tag it is made of, and `assetSetCoordinateLabel` writes it that way
 * (`locale:zh-CN`). That spelling is right where the author's next action is about those tags. It is
 * the wrong spelling in the library, where the question is which file a player gets: `zh-CN` is a
 * code, and the project already knows it as a language with a name.
 *
 * Both axis kinds name something the project declares - a language, or an edition - so this is a
 * lookup rather than a guess. A value with nothing to look up prints as it is stored, which happens
 * while a language or an edition is being removed and a set still promises it.
 */

import type { AssetSet, AssetSetAxis, AssetSetCoordinate } from "./assetSet";

/** What a project knows that lets a coordinate be read in words rather than in tags. */
export interface AssetSetAxisNaming {
    /** Declared languages, by code. */
    locales: ReadonlyMap<string, string>;
    /** Editions, by id. */
    editions: ReadonlyMap<string, string>;
    /** The word for each kind. Translated by the caller. */
    words: { language: string; edition: string };
}

/** One axis of a coordinate, as a row prints it. */
export interface AssetSetAxisReading {
    axis: string;
    value: string;
}

export function readAssetSetAxis(
    axis: AssetSetAxis,
    value: string,
    naming: AssetSetAxisNaming,
): AssetSetAxisReading {
    const trimmed = value.trim();
    return axis.kind === "locale"
        ? { axis: naming.words.language, value: naming.locales.get(trimmed) ?? trimmed }
        : { axis: naming.words.edition, value: naming.editions.get(trimmed) ?? trimmed };
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
