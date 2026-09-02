import {BLUEPRINT_DOCUMENT_SCHEMA_VERSION} from "@shared/types/blueprint/schema";
import {UI_GRAPH_DOCUMENT_SCHEMA_VERSION, type UIGraphDocument} from "@shared/types/ui-editor/graph";
import {defineDocumentSpec} from "../registry";
import {isJsonObject, rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";
import {countGraphNodes, diffUIGraphs} from "./uiGraphsDiff";

/**
 * `editor/ui/uigraphs.json` - every blueprint in the project: the logic behind the interface, the
 * widgets and the story's own actions. The second-largest document a project holds, and the one
 * whose contents are least legible as JSON.
 *
 * One record lives here: `blueprintDocument`, blueprints keyed by id, each holding event and
 * function graphs of nodes and edges. There used to be a second - a root-level `graphs` map holding
 * the behaviour-graph IR that predates blueprints - and it is gone: nothing wrote it, nothing
 * executed it, and every project in this repository carried it empty.
 *
 * **Read-side only, like the interface document beside it.** `parse` is a shape gate, and
 * `UIGraphService` keeps owning writing: `serialize` refuses.
 */
export const UI_GRAPHS_DOCUMENT_PATH = "editor/ui/uigraphs.json";

export const uiGraphsSpec = defineDocumentSpec<UIGraphDocument>({
    kind: "ui-graphs",
    version: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
    paths: [UI_GRAPHS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a blueprint document");
        rejectNewerSchema(record, context, UI_GRAPH_DOCUMENT_SCHEMA_VERSION);
        if (record.blueprintDocument !== undefined && !isJsonObject(record.blueprintDocument)) {
            return context.corrupt(`"blueprintDocument" must be an object, got ${describe(record.blueprintDocument)}`);
        }
        // The blueprint record carries its own schema version, and it is the one that actually
        // moves - the wrapper has sat at 2 while blueprints reached 10. A document from a newer
        // Studio is refused on that number too, or the comparison would read fields it does not
        // have the meaning of.
        if (isJsonObject(record.blueprintDocument)) {
            rejectNewerSchema(record.blueprintDocument, context, BLUEPRINT_DOCUMENT_SCHEMA_VERSION);
            requireOptionalMap(record.blueprintDocument, "blueprints", context);
            requireOptionalMap(record.blueprintDocument, "ownerRecords", context);
        }

        // Returned as read. See the note on this module: no migration runs here.
        return record as unknown as UIGraphDocument;
    },
    /** Refused; see the note above for what has to land before it can write. */
    serialize: () => {
        throw new Error(
            "The ui-graphs spec is read-only in this build: `parse` does not run the blueprint "
            + "migration (it seeds the variable registry as it goes, which needs a service), so "
            + "serializing would write back a document that was never migrated. Use UIGraphService.",
        );
    },
    summarize: document => {
        const blueprints = document?.blueprintDocument?.blueprints;
        return {
            // No authored name: there is one of these per project and the history UI labels it by
            // kind. A blueprint's own name belongs on the row about that blueprint.
            title: "",
            counts: [
                {key: "uiBlueprints", value: isJsonObject(blueprints) ? Object.keys(blueprints).length : 0},
                {key: "uiGraphNodes", value: countGraphNodes(document)},
            ],
        };
    },
    diff: diffUIGraphs,
    // No `merge3`; the reason is at the foot of `uiGraphsDiff.ts`.
});

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}
