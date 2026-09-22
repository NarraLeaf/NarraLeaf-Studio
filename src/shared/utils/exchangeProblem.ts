/**
 * What is wrong with a file a translator or a recording booth sent back, as data rather than prose.
 *
 * The translation exchange formats (CSV, XLIFF, PO, JSON) and the voice recording script are read
 * by parsers that know exactly what went wrong and nothing about the language the author reads
 * Studio in. So they answer with a code, and where it helps the author find the spot, the position
 * the file itself uses - a spreadsheet row, a JSON array entry, a line of a PO file. The interface
 * turns each one into a sentence (`describeExchangeProblem`).
 *
 * A problem never carries a unit id: ids are what a translator must not touch and what the
 * interface never shows, and the position is enough to find the entry.
 */

/** Where in the file a problem sits, in the file's own terms. */
export type ExchangeProblemPosition =
    /** A spreadsheet row, counting the header as row 1 - the number Excel shows beside it. */
    | { row: number }
    /** An entry of a JSON array, from 1. */
    | { entry: number }
    /** A line of a line-based file (PO), from 1. */
    | { line: number };

export type ExchangeProblem =
    /** Nothing in the file at all. */
    | { code: "empty" }
    /** A CSV without the one column every row is matched by. */
    | { code: "noIdColumn" }
    /** Not the format it was read as: not XML, XML that is not XLIFF, text that is not JSON. */
    | { code: "notFormat"; format: "xliff" | "json" }
    /** A well-formed file with nothing to import in it. */
    | { code: "noRows" }
    /** An entry with no unit id, skipped. */
    | { code: "missingId"; at?: ExchangeProblemPosition }
    /** An entry that is neither a string nor a translation unit, skipped. */
    | { code: "notEntry"; at?: ExchangeProblemPosition }
    /** A line of a PO file that is none of the things a PO line can be, skipped. */
    | { code: "unreadableLine"; at: { line: number } };

export type ExchangeProblemCode = ExchangeProblem["code"];
