import {DocumentPathPattern, documentPathParameterNames, matchDocumentPath} from "../documentPath";
import {DocumentParseContext} from "../types";

/**
 * The three checks every spec's `parse` runs before it hands the bytes to the format's own
 * normalizer.
 *
 * They exist because the normalizers were all written for a reader that could afford to be
 * forgiving: `normalizeVoiceDocument` and friends return an *empty document* for anything they do
 * not recognise, and never throw. That was survivable while the only consequence was an empty
 * panel. It is not survivable now that the same document is written back - an unrecognised file
 * would load as empty, the first edit would schedule an autosave, and the autosave would replace
 * the author's translations with `{}`. So the shapes that make a normalizer bail out silently are
 * turned into `corrupt` here, which quarantines a copy and leaves the file exactly as it was.
 */

/** A JSON object, as opposed to an array, a scalar or null. */
export function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The document root as an object, or `corrupt` if it is anything else. */
export function requireDocumentObject(
    raw: unknown,
    context: DocumentParseContext,
    what: string,
): Record<string, unknown> {
    if (!isJsonObject(raw)) {
        return context.corrupt(`expected ${what} object at the document root, got ${describe(raw)}`);
    }
    return raw;
}

/**
 * Check that `key` holds a keyed map, if it is present at all.
 *
 * Absent is fine and means "no entries yet" - a document written before the field existed reads
 * that way. Present-but-not-a-map is not: an array or a `null` here is exactly what makes a
 * normalizer return an empty document, and an empty document is what would be written back.
 */
export function requireOptionalMap(
    record: Record<string, unknown>,
    key: string,
    context: DocumentParseContext,
): void {
    const value = record[key];
    if (value !== undefined && !isJsonObject(value)) {
        context.corrupt(`"${key}" must be an object keyed by id, got ${describe(value)}`);
    }
}

/**
 * Refuse a document a newer Studio wrote.
 *
 * A schema ahead of this build cannot be migrated *down*. The normalizer would happily drop every
 * field it has not heard of, and the next autosave would write that back - so opening a project
 * once in an older Studio would silently strip the newer one's work. Refusing costs the author one
 * error message; accepting costs them the fields.
 *
 * Only a number strictly greater than `version` is refused. A missing or non-numeric
 * `schemaVersion` is what several of these formats have always tolerated, and inventing a
 * requirement for it here would quarantine files that read back perfectly well.
 */
export function rejectNewerSchema(
    record: Record<string, unknown>,
    context: DocumentParseContext,
    version: number,
): void {
    const schemaVersion = record.schemaVersion;
    if (typeof schemaVersion === "number" && schemaVersion > version) {
        context.corrupt(
            `written by a newer version of Studio (schema v${schemaVersion}; this build reads v${version})`,
        );
    }
}

/**
 * A value captured from the document's own path, e.g. the locale of
 * `editor/localization/zh-CN.json`.
 *
 * The path is the authority for these ids, not the field of the same name inside the file: the
 * file is found by path, and a document that disagreed with its own location would otherwise be
 * saved back to the location its contents claim - i.e. to a different file.
 */
export function parameterFromPath(
    pattern: DocumentPathPattern,
    name: string,
    context: DocumentParseContext,
): string {
    const parameters = matchDocumentPath(pattern, context.path);
    const value = parameters?.[name];
    if (value === undefined) {
        return context.corrupt(
            `is at "${context.path}", which is not a "${pattern.source}" and so carries no <${name}>`
            + ` (this spec captures ${documentPathParameterNames(pattern).join(", ") || "nothing"})`,
        );
    }
    return value;
}

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    if (Array.isArray(value)) {
        return "an array";
    }
    return `a ${typeof value}`;
}
