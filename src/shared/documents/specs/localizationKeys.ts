import {
    LOCALIZATION_KEYS_SCHEMA_VERSION,
    LocalizationKeysDocument,
    normalizeLocalizationKeysDocument,
} from "../../types/localization";
import {DocumentMerge3, DocumentMergeDecision} from "../diff";
import {defineDocumentSpec} from "../registry";
import {countConflicts, decision, keyedRowLabel, mergeKeyed} from "./mergeHelpers";
import {rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `editor/localization/keys.json` - the developer-authored named-string registry.
 *
 * A kind of its own rather than a second path on the localization spec: both paths would capture
 * nothing and everything respectively, and `pathFor` cannot choose between two paths of one spec
 * that take the same parameters. Also owned by `LocalizationService`, but a different format - it
 * holds source texts, not translations.
 */
export const LOCALIZATION_KEYS_DOCUMENT_PATH = "editor/localization/keys.json";

export const localizationKeysSpec = defineDocumentSpec<LocalizationKeysDocument>({
    kind: "localization-keys",
    version: LOCALIZATION_KEYS_SCHEMA_VERSION,
    paths: [LOCALIZATION_KEYS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a localization key registry");
        rejectNewerSchema(record, context, LOCALIZATION_KEYS_SCHEMA_VERSION);
        requireOptionalMap(record, "keys", context);
        return normalizeLocalizationKeysDocument(record);
    },
    summarize: document => ({
        title: "",
        counts: [{key: "localizationKeys", value: Object.keys(document.keys).length}],
    }),
    merge3: merge3LocalizationKeys,
});

const LABEL = {
    added: "documentDiff.localizationKeys.added",
    removed: "documentDiff.localizationKeys.removed",
    changed: "documentDiff.localizationKeys.changed",
} as const;

/**
 * Three-way merge of the named-string registry - keyed by the name the developer typed.
 *
 * The one map in the project whose keys are authored rather than generated, which is what makes
 * both halves of this work: two people adding `menu.start` and `menu.load` merge with nothing to
 * decide, and the one row they both touched is named by something they will recognise on sight.
 *
 * **A whole definition per decision.** An entry is a source text and a note about it, and a note
 * kept from one side over the other side's rewritten source is a translator's instruction about a
 * line that no longer says that.
 *
 * ⚠ **A key that both sides added with different source texts is a conflict, not a duplicate.**
 * The name IS the identity here - it is what every `t()` call and every translation unit points at
 * - so two definitions of one name cannot both survive under different keys the way two assets
 * with the same file name can.
 */
export function merge3LocalizationKeys(
    base: LocalizationKeysDocument | undefined,
    mine: LocalizationKeysDocument,
    theirs: LocalizationKeysDocument,
): DocumentMerge3<LocalizationKeysDocument> {
    const keys = mergeKeyed(base?.keys, mine.keys, theirs.keys);
    const decisions: DocumentMergeDecision[] = keys.rows.map(row =>
        decision(["keys", row.key], row, {
            label: keyedRowLabel(row, LABEL),
            // The key itself, which is the rare case where the map's key IS the author's word for
            // the row: `menu.start` was typed by whoever declared it.
            subject: row.key,
        }));

    return {
        document: {schemaVersion: mine.schemaVersion, keys: keys.merged},
        decisions,
        conflicts: countConflicts(decisions),
    };
}
