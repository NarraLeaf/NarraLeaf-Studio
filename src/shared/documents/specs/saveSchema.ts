import {migrateSaveSchemaToLatest} from "../../saves/saveSchemaModel";
import {SAVE_SCHEMA_VERSION, SaveSchema} from "../../types/saveSchema";
import {defineDocumentSpec} from "../registry";
import {rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `editor/save-schema.json` - what one save slot carries besides the engine's own record: the
 * fields an author declares once and then wires by name on `Save Game` and `Get Save Metadata`.
 *
 * Owned by `SaveSchemaService`. The path is `ProjectNameConvention.EditorSaveSchema` spelled as a
 * pattern; the two are kept in step by the renderer's `services/core/documentSpecs.test.ts`, which
 * is the only place that can see both (this module is shared, the convention is not).
 */
export const SAVE_SCHEMA_DOCUMENT_PATH = "editor/save-schema.json";

export const saveSchemaSpec = defineDocumentSpec<SaveSchema>({
    kind: "save-schema",
    version: SAVE_SCHEMA_VERSION,
    paths: [SAVE_SCHEMA_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a save schema");
        rejectNewerSchema(record, context, SAVE_SCHEMA_VERSION);
        requireOptionalMap(record, "fields", context);
        return migrateSaveSchemaToLatest(record);
    },
    // No authored name: one per project, and the history UI labels it by kind.
    summarize: schema => ({
        title: "",
        counts: [{key: "saveFields", value: Object.keys(schema.fields).length}],
    }),
});
