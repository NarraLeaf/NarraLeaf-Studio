import {migrateVariableRegistryToLatest} from "../../variables/variableRegistryModel";
import {VARIABLE_REGISTRY_SCHEMA_VERSION, VariableRegistry} from "../../types/variables/registry";
import {defineDocumentSpec} from "../registry";
import {rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";

/**
 * `editor/variables.json` - the project-level persistent variable registry (M-VAR).
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
});
