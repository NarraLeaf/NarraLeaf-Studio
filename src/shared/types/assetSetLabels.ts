/**
 * Reading a set's coordinate back in the words the project already uses.
 *
 * A coordinate is stored as the tags it is made of, and `assetSetCoordinateLabel` writes it that way
 * (`locale:zh-CN`). That spelling is right where the author's next action is to go and write those
 * tags on a file. It is the wrong spelling in the library, where the question is which file a player
 * gets: `zh-CN` is a code, and the project already knows it as a language with a name.
 *
 * Two axes have a name of their own in a project, and only because something else declares them:
 *
 *  - An axis whose values are all declared languages is the language axis. The value is that
 *    language's display name.
 *  - An axis whose value one edition declares for itself (`ProjectAppTag.assetAxes`) is read as that
 *    edition. The value is the edition's name.
 *
 * Everything else is printed as it is stored. Naming an axis this project has said nothing about
 * would mean inventing a vocabulary, and the tag category is the author's own word for it already.
 *
 * An axis value that two editions both declare is not read as either of them. "Demo" would be one
 * of two right answers, and a row naming one edition while another gets the same file is worse than
 * a row that prints the tag.
 */

import type { AssetSet, AssetSetAxis, AssetSetCoordinate } from "./assetSet";

/** What a project knows that lets a coordinate be read in words rather than in tags. */
export interface AssetSetAxisNaming {
    /** Declared languages, by code. */
    locales: ReadonlyMap<string, string>;
    /** Axis key, then value, to the editions declaring that value for themselves. */
    editionsByAxis: ReadonlyMap<string, ReadonlyMap<string, readonly string[]>>;
    /** The word for each of the two axes a project can name. Translated by the caller. */
    words: { language: string; edition: string };
}

/** One axis of a coordinate, as a row prints it. */
export interface AssetSetAxisReading {
    /** The axis, named if the project names it, else the tag category. */
    axis: string;
    /** The value, named if the project names it, else the tag value. */
    value: string;
}

export function isLanguageAxis(axis: AssetSetAxis, locales: ReadonlyMap<string, string>): boolean {
    return axis.values.length > 0 && axis.values.every(value => locales.has(value.trim()));
}

export function readAssetSetAxis(
    axis: AssetSetAxis,
    value: string,
    naming: AssetSetAxisNaming,
): AssetSetAxisReading {
    const trimmed = value.trim();
    if (isLanguageAxis(axis, naming.locales)) {
        return { axis: naming.words.language, value: naming.locales.get(trimmed) ?? trimmed };
    }
    const editions = naming.editionsByAxis.get(axis.key.trim())?.get(trimmed) ?? [];
    if (editions.length === 1) {
        return { axis: naming.words.edition, value: editions[0] };
    }
    return { axis: axis.key.trim(), value: trimmed };
}

/** Every axis of one coordinate, outermost first, as the rows print them. */
export function readAssetSetCoordinate(
    set: AssetSet,
    coordinate: AssetSetCoordinate,
    naming: AssetSetAxisNaming,
): AssetSetAxisReading[] {
    return set.axes
        .filter(axis => coordinate[axis.key] !== undefined)
        .map(axis => readAssetSetAxis(axis, coordinate[axis.key] as string, naming));
}

/** One coordinate on one line, for a row that has a line and not a column per axis. */
export function formatAssetSetCoordinateReading(readings: readonly AssetSetAxisReading[]): string {
    return readings.map(reading => `${reading.axis}: ${reading.value}`).join(" · ");
}
