import {
  UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
  type UIGraphDocument
} from "@shared/types/ui-editor/graph";
import { defineDocumentSpec } from "../registry";
import {
  isJsonObject,
  rejectNewerSchema,
  requireDocumentObject,
  requireOptionalMap
} from "./parseHelpers";
import { countGraphNodes, diffUIGraphs } from "./uiGraphsDiff";

/**
 * `editor/ui/uigraphs.json` - every blueprint in the project: the logic behind the interface, the
 * widgets and the story's own actions. The second-largest document a project holds, and the one
 * whose contents are least legible as JSON.
 *
 * Two records live here and both are diffed. `blueprintDocument` is the canonical one - blueprints
 * keyed by id, each holding event and function graphs of nodes and edges. `graphs` at the root is
 * the older behaviour-graph IR, which nothing writes any more and some projects still carry; it is
 * read on the same terms rather than ignored, because a document nobody can compare is a document
 * whose changes are invisible.
 *
 * **Read-side only, like the interface document beside it.** `parse` is a shape gate:
 * `migrateBlueprintDocument` needs a service to seed the variable registry as it runs, so shared
 * code cannot complete the migration, and an unmigrated document written back under the current
 * schema version would be the migration silently not having run. `UIGraphService` keeps owning
 * writing and `serialize` refuses.
 */
export const UI_GRAPHS_DOCUMENT_PATH = "editor/ui/uigraphs.json";

export const uiGraphsSpec = defineDocumentSpec<UIGraphDocument>({
  kind: "ui-graphs",
  version: UI_GRAPH_DOCUMENT_SCHEMA_VERSION,
  paths: [UI_GRAPHS_DOCUMENT_PATH],
  parse: (raw, context) => {
    const record = requireDocumentObject(raw, context, "a blueprint document");
    rejectNewerSchema(record, context, UI_GRAPH_DOCUMENT_SCHEMA_VERSION);
    requireOptionalMap(record, "graphs", context);
    if (record.blueprintDocument !== undefined && !isJsonObject(record.blueprintDocument)) {
      return context.corrupt(
        `"blueprintDocument" must be an object, got ${describe(record.blueprintDocument)}`
      );
    }
    // The blueprint record carries its own schema version, and it is the one that actually
    // moves - the wrapper has sat at 2 while blueprints reached 10. A document from a newer
    // Studio is refused on that number too, or the comparison would read fields it does not
    // have the meaning of.
    if (isJsonObject(record.blueprintDocument)) {
      requireOptionalMap(record.blueprintDocument, "blueprints", context);
      requireOptionalMap(record.blueprintDocument, "ownerRecords", context);
    }

    // Returned as read. See the note on this module: no migration runs here.
    return record as unknown as UIGraphDocument;
  },
  /** Refused for the reason the story and interface specs refuse; see the note above. */
  serialize: () => {
    throw new Error(
      "The ui-graphs spec is read-only in this build: `parse` does not run the blueprint " +
        "migration (it seeds the variable registry as it goes, which needs a service), so " +
        "serializing would write back a document that was never migrated. Use UIGraphService."
    );
  },
  summarize: (document) => {
    const blueprints = document?.blueprintDocument?.blueprints;
    return {
      // No authored name: there is one of these per project and the history UI labels it by
      // kind. A blueprint's own name belongs on the row about that blueprint.
      title: "",
      counts: [
        {
          key: "uiBlueprints",
          value: isJsonObject(blueprints) ? Object.keys(blueprints).length : 0
        },
        { key: "uiGraphNodes", value: countGraphNodes(document) }
      ]
    };
  },
  diff: diffUIGraphs
  // No `merge3`; the reason is at the foot of `uiGraphsDiff.ts`.
});

function describe(value: unknown): string {
  if (value === null) {
    return "null";
  }
  return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}
