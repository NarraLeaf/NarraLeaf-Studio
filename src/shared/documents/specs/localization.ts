import {
    LOCALIZATION_DOCUMENT_SCHEMA_VERSION,
    LocalizationDocument,
    normalizeLocalizationDocument,
} from "../../types/localization";
import {compileDocumentPathPattern} from "../documentPath";
import {defineDocumentSpec} from "../registry";
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
});
