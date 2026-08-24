import {migrateSaveSchemaToLatest} from "../../saves/saveSchemaModel";
import {SAVE_SCHEMA_VERSION, SaveSchema} from "../../types/saveSchema";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {defineDocumentSpec} from "../registry";
import {authoredName, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
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
    diff: diffSaveSchema,
});

const LABEL = {
    added: "documentDiff.saveSchema.added",
    removed: "documentDiff.saveSchema.removed",
    renamed: "documentDiff.saveSchema.renamed",
    valueType: "documentDiff.saveSchema.valueType",
    defaultValue: "documentDiff.saveSchema.defaultValue",
    storageKey: "documentDiff.saveSchema.storageKey",
    description: "documentDiff.saveSchema.description",
    reordered: "documentDiff.saveSchema.reordered",
} as const;

/**
 * One row per save field, and a removal is not the same size of event as the rest.
 *
 * The two save nodes are a contract across time: a slot is written today and read back weeks later,
 * on a player's machine, out of a file this project shipped. Adding a field is safe by construction
 * - a slot with no value for it reads the default - but taking one away removes the pins that read
 * it, and every save already on a disk keeps the value with nothing left that can ask for it. That
 * is what the removal row says out loud, because it is the one change here an author can make
 * without noticing what it costs.
 *
 * Every field is compared by name rather than through a catch-all row, so nothing an entry carries
 * can change and produce no row at all.
 */
export function diffSaveSchema(base: SaveSchema, head: SaveSchema, options: {limit: number}): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(base.fields, head.fields)) {
        const path = ["fields", entry.key];
        const subject = authoredName(entry.head?.name) ?? authoredName(entry.base?.name);
        if (!entry.base || !entry.head) {
            rows.push(change(path, entry.kind, entry.head ? LABEL.added : LABEL.removed, {subject}));
            continue;
        }
        if (!sameJsonValue(entry.base.name, entry.head.name)) {
            rows.push(change([...path, "name"], "changed", LABEL.renamed, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject,
            }));
        }
        if (!sameJsonValue(entry.base.valueType, entry.head.valueType)) {
            rows.push(change([...path, "valueType"], "changed", LABEL.valueType, {
                params: fromToParams(entry.base.valueType, entry.head.valueType),
                subject,
            }));
        }
        if (!sameJsonValue(entry.base.defaultValue, entry.head.defaultValue)) {
            rows.push(change([...path, "defaultValue"], "changed", LABEL.defaultValue, {
                params: fromToParams(entry.base.defaultValue, entry.head.defaultValue),
                subject,
            }));
        }
        // The key inside the save, fixed when the field was created precisely so a rename cannot
        // orphan what is already written. If it moved anyway, it orphaned it.
        if (!sameJsonValue(entry.base.storageKey, entry.head.storageKey)) {
            rows.push(change([...path, "storageKey"], "changed", LABEL.storageKey, {subject}));
        }
        if (!sameJsonValue(entry.base.description, entry.head.description)) {
            rows.push(change([...path, "description"], "changed", LABEL.description, {
                params: fromToParams(entry.base.description, entry.head.description),
                subject,
            }));
        }
        // Where the field sits among the pins on the two save nodes. Nothing about the game changes,
        // which is why it is its own row with its own marker rather than a line beside the rest.
        if (!sameJsonValue(entry.base.order, entry.head.order)) {
            rows.push(change([...path, "order"], "moved", LABEL.reordered, {subject}));
        }
    }

    // `meta` holds the two timestamps and nothing else, so it is not compared.
    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}
