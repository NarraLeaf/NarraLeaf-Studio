import {
    LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
    LocalizationDocument,
    normalizeLocalizationDocument,
} from "../../types/localization";
import {DocumentMerge3, DocumentMergeDecision} from "../diff";
import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
import {countConflicts, decision, mergeKeyed} from "./mergeHelpers";
import {parameterFromPath, rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `editor/localization/<locale>.json` - one translation library per language.
 *
 * Owned by `LocalizationService`. `editor/localization/keys.json` sits inside this pattern's space
 * and is a different format; it is a separate kind (see `localizationKeys.ts`) and the registry
 * resolves the overlap by taking the more specific pattern. That split is forced rather than
 * stylistic: `pathFor` refuses two paths of one spec that take the same parameters, and it would
 * have no way to tell `pathFor({locale: "keys"})` from the keys document.
 */
export const LOCALIZATION_DOCUMENT_PATH = "editor/localization/<locale>.json";

const LOCALIZATION_DOCUMENT_PATTERN = compileDocumentPathPattern(LOCALIZATION_DOCUMENT_PATH);

export const localizationDocumentSpec = defineDocumentSpec<LocalizationDocument>({
    kind: "localization",
    version: LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
    paths: [LOCALIZATION_DOCUMENT_PATH],
    parse: (raw, context) => {
        const locale = parameterFromPath(LOCALIZATION_DOCUMENT_PATTERN, "locale", context);
        const record = requireDocumentObject(raw, context, "a translation library");
        rejectNewerSchema(record, context, LOCALIZATION_DOCUMENT_SCHEMA_VERSION);
        requireOptionalMap(record, "units", context);
        return normalizeLocalizationDocument(record, locale);
    },
    summarize: document => ({
        title: document.locale,
        counts: [{key: "translationUnits", value: Object.keys(document.units).length}],
    }),
    merge3: merge3Localization,
});

/**
 * Three-way merge of one translation library - the format per-change resolution pays for itself on.
 *
 * A translation library is the one document where two people working at once is the normal case
 * rather than the awkward one: translators do not partition a file, they take the keys they can
 * do. Almost every unit is touched by exactly one side and merges with nothing to decide, and the
 * handful that both sides translated is precisely what the author has to see. Resolving the whole
 * file from one side - the only thing the first tier can do - throws away a day of somebody's
 * work to settle three strings.
 *
 * **A conflict carries both translations, verbatim.** {@link DocumentMergeSide.value} holds each
 * side's whole unit, so the surface can put the two `target` strings side by side; that is the
 * entire question the author is being asked, and a preview or a hash would not be answerable.
 *
 * The document's own two fields are taken from mine without a row. `locale` comes from the file
 * name, so all three sides have the same one by construction, and `schemaVersion` is a constant
 * `parse` already refuses to read a newer value of - neither can differ between two sides of one
 * merge, and a decision row for something that cannot differ is noise the author has to read.
 */
export function merge3Localization(
    base: LocalizationDocument | undefined,
    mine: LocalizationDocument,
    theirs: LocalizationDocument,
): DocumentMerge3<LocalizationDocument> {
    const units = mergeKeyed(base?.units, mine.units, theirs.units);
    const decisions: DocumentMergeDecision[] = units.rows.map(row =>
        // No label: there is no `documentDiff.localization.*` vocabulary, because this format has
        // no semantic diff yet. Emitting a key that is in neither catalogue would draw the dotted
        // path itself at the author - see `documentDiffKeys.test.ts`, which is what caught that
        // happening at scale once already. The unit id is not a subject either: it is a story
        // text id or a `key:`/`char:` handle, none of which the author typed.
        decision(["units", row.key], row));

    return {
        document: {
            schemaVersion: mine.schemaVersion,
            locale: mine.locale,
            units: units.merged,
        },
        decisions,
        conflicts: countConflicts(decisions),
    };
}
