import {migrateVariableRegistryToLatest} from "../../variables/variableRegistryModel";
import {
    VARIABLE_REGISTRY_SCHEMA_VERSION,
    VariableRegistry,
    VariableRegistryEntry,
} from "../../types/variables/registry";
import {
    buildDocumentDiff,
    DocumentChange,
    DocumentDiff,
    DocumentMerge3,
    DocumentMergeDecision,
} from "../diff";
import {defineDocumentSpec} from "../registry";
import {authoredName, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {countConflicts, decision, keyedRowLabel, mergeKeyed} from "./mergeHelpers";
import {rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `editor/variables.json` - the project-level variable registry (M-VAR): the `saved` and
 * `persistent` scopes. Scene variables are not here; they live in their scene's story document.
 *
 * Owned by `VariableRegistryService`. The path is `ProjectNameConvention.EditorVariableRegistry`
 * spelled as a pattern; the two are kept in step by the renderer's
 * `services/core/documentSpecs.test.ts`, which is the only place that can see both (this module is
 * shared, the convention is not).
 */
export const VARIABLE_REGISTRY_DOCUMENT_PATH = "editor/variables.json";

export const variableRegistrySpec = defineDocumentSpec<VariableRegistry>({
    kind: "variables",
    version: VARIABLE_REGISTRY_SCHEMA_VERSION,
    paths: [VARIABLE_REGISTRY_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a variable registry");
        rejectNewerSchema(record, context, VARIABLE_REGISTRY_SCHEMA_VERSION);
        requireOptionalMap(record, "entries", context);
        return migrateVariableRegistryToLatest(record);
    },
    // No authored name: the registry is one per project and the history UI labels it by kind.
    summarize: registry => ({
        title: "",
        counts: [{key: "variables", value: Object.keys(registry.entries).length}],
    }),
    diff: diffVariableRegistry,
    merge3: merge3VariableRegistry,
});

const LABEL = {
    added: "documentDiff.variables.added",
    removed: "documentDiff.variables.removed",
    changed: "documentDiff.variables.changed",
    renamed: "documentDiff.variables.renamed",
    defaultValue: "documentDiff.variables.defaultValue",
    valueType: "documentDiff.variables.valueType",
    scopeSaved: "documentDiff.variables.scopeSaved",
    scopeGlobal: "documentDiff.variables.scopeGlobal",
    storageKey: "documentDiff.variables.storageKey",
    description: "documentDiff.variables.description",
} as const;

/**
 * Three-way merge of the variable registry - one decision per variable, not per field.
 *
 * The registry is a flat map keyed by a stable id, so two authors who each declared a variable of
 * their own merge with nothing to decide. That is the case this exists for: a variable is declared
 * once and read from a hundred places, so the file is touched by whoever happens to need a new one
 * and two people needing one in the same week used to cost one of them the whole file.
 *
 * **A whole entry per decision, and the fields are not merged across sides.** They are not
 * independent: `storageKey` is where every save already written keeps this variable's value, and
 * `valueType` says what may be in it. An entry built from one side's `storageKey` and the other's
 * `valueType` describes a variable whose stored values are of the wrong shape, and it would look
 * perfectly well-formed doing it.
 *
 * `meta` is taken from mine with no row, the way the comparison ignores it: it holds two timestamps
 * and nothing an author decided, and a decision about when a file was written is a line to read
 * and dismiss. `schemaVersion` is a constant `parse` already refuses a newer value of.
 */
export function merge3VariableRegistry(
    base: VariableRegistry | undefined,
    mine: VariableRegistry,
    theirs: VariableRegistry,
): DocumentMerge3<VariableRegistry> {
    const entries = mergeKeyed(base?.entries, mine.entries, theirs.entries);
    const decisions: DocumentMergeDecision[] = entries.rows.map(row => {
        const present = (row.mine.value ?? row.theirs.value ?? row.base.value) as
            VariableRegistryEntry | undefined;
        return decision(["entries", row.key], row, {
            label: keyedRowLabel(row, LABEL),
            // The author's own label for it. The id is a generated handle nobody typed, and the
            // panel never shows it, so a row identified by one identifies nothing.
            subject: authoredName(present?.name),
        });
    });

    return {
        document: {
            schemaVersion: mine.schemaVersion,
            entries: entries.merged,
            ...(mine.meta === undefined ? {} : {meta: mine.meta}),
        },
        decisions,
        conflicts: countConflicts(decisions),
    };
}

/**
 * One row per variable, and the starting value is the row this is for.
 *
 * A default is what every playthrough begins with and what a save written before the variable
 * existed reads as, so changing one changes the shipped game as surely as editing a line of script
 * does - and it moves no count, which is the whole of what the summary tier could see.
 *
 * Every field of an entry is compared by name rather than through a catch-all "some field changed"
 * row, so nothing an entry carries can change and produce no row at all. A field added to the model
 * later has to be added here, which is the intended cost.
 */
export function diffVariableRegistry(base: VariableRegistry, head: VariableRegistry, options: {limit: number}): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(base.entries, head.entries)) {
        const path = ["entries", entry.key];
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
        if (!sameJsonValue(entry.base.defaultValue, entry.head.defaultValue)) {
            rows.push(change([...path, "defaultValue"], "changed", LABEL.defaultValue, {
                params: fromToParams(entry.base.defaultValue, entry.head.defaultValue),
                subject,
            }));
        }
        if (!sameJsonValue(entry.base.valueType, entry.head.valueType)) {
            rows.push(change([...path, "valueType"], "changed", LABEL.valueType, {
                params: fromToParams(entry.base.valueType, entry.head.valueType),
                subject,
            }));
        }
        // Which scope it now belongs to, as a state rather than as a pair: the two stored words are
        // the model's, and one of them ("persistent") is not even what the panel calls that scope.
        if (!sameJsonValue(entry.base.scope, entry.head.scope)) {
            rows.push(change([...path, "scope"], "changed", entry.head.scope === "saved" ? LABEL.scopeSaved : LABEL.scopeGlobal, {
                subject,
            }));
        }
        // The key the value is stored under, which a rename deliberately never touches. If it moved
        // anyway, every value already written is still on disk and nothing looks for it there.
        if (!sameJsonValue(entry.base.storageKey, entry.head.storageKey)) {
            rows.push(change([...path, "storageKey"], "changed", LABEL.storageKey, {subject}));
        }
        if (!sameJsonValue(entry.base.description, entry.head.description)) {
            rows.push(change([...path, "description"], "changed", LABEL.description, {
                params: fromToParams(entry.base.description, entry.head.description),
                subject,
            }));
        }
    }

    // `meta` holds the two timestamps and nothing else, so it is not compared.
    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}
