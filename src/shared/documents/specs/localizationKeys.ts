import {
    LOCALIZATION_KEYS_SCHEMA_VERSION,
    LocalizationKeysDocument,
    normalizeLocalizationKeysDocument,
} from "../../types/localization";
import {defineDocumentSpec} from "../registry";
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
});
