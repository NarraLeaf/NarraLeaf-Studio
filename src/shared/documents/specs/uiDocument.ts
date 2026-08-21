import {UI_DOCUMENT_SCHEMA_VERSION, type UIDocument} from "@shared/types/ui-editor/document";
import {defineDocumentSpec} from "../registry";
import {isJsonObject, rejectNewerSchema, requireDocumentObject, requireOptionalMap} from "./parseHelpers";
import {diffUIDocument} from "./uiDocumentDiff";

/**
 * `editor/ui/uidoc.json` - every Surface in the project, the component library, and the one flat map
 * of elements they are all built out of. The largest document a project holds.
 *
 * **Read-side only, for the reason the story spec USED to be.** `parse` here is a shape gate, not a
 * migration: eleven schema versions' worth of `migrateFromV*Document` live on the renderer's
 * `UIDocumentService`, shared code cannot import them, and an unmigrated document written back would
 * turn "read as v7" into "saved as v11 with the migration never having run". So `serialize` refuses,
 * and `UIDocumentService` keeps owning writing.
 *
 * `story.ts` is the worked example of lifting exactly this refusal: move both halves of the
 * migration into shared code, run them in `parse`, and hold the resulting round trip - a value at
 * the current version that is a fixed point of `parse` - as the invariant `serialize` rests on. The
 * `read-only` blocker in `mergeDocument.ts` is a probe rather than a list of spec names, so this
 * file becomes resolvable change by change on the day that lands, with nothing else to update.
 *
 * The reason it is a document at all is the diff. Without a spec this file falls to the structural
 * tier, which walks JSON positionally over a document that is nothing but generated ids, absolute
 * coordinates and one 269-entry element map - so inserting a single button reads as several hundred
 * changed paths, and the one row that mattered is somewhere in them. See `uiDocumentDiff.ts` for the
 * addressing that replaces it.
 */
export const UI_DOCUMENT_PATH = "editor/ui/uidoc.json";

export const uiDocumentSpec = defineDocumentSpec<UIDocument>({
    kind: "ui-document",
    version: UI_DOCUMENT_SCHEMA_VERSION,
    paths: [UI_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "an interface document");
        rejectNewerSchema(record, context, UI_DOCUMENT_SCHEMA_VERSION);
        // `surfaces` and `elements` are the two halves nothing downstream can do without: a
        // Surface names its root element and the elements hold the tree. Present-but-wrong is
        // refused rather than read as empty, which is the rule `parseHelpers` exists for.
        if (record.surfaces !== undefined && !Array.isArray(record.surfaces)) {
            return context.corrupt(`"surfaces" must be an array, got ${describe(record.surfaces)}`);
        }
        if (record.components !== undefined && !Array.isArray(record.components)) {
            return context.corrupt(`"components" must be an array, got ${describe(record.components)}`);
        }
        requireOptionalMap(record, "elements", context);

        // Returned as read. See the note on this module: no migration runs here, and `serialize`
        // refuses for that exact reason.
        return record as unknown as UIDocument;
    },
    /** Refused; see the note at the top of this module for what has to land before it can write. */
    serialize: () => {
        throw new Error(
            "The ui-document spec is read-only in this build: `parse` does not run the interface "
            + "migration (it lives in the renderer's UIDocumentService), so serializing would write back "
            + "a document that was never migrated. Use UIDocumentService to save the interface.",
        );
    },
    summarize: document => ({
        title: typeof document.name === "string" ? document.name : "",
        counts: [
            {key: "uiSurfaces", value: Array.isArray(document.surfaces) ? document.surfaces.length : 0},
            {key: "uiComponents", value: Array.isArray(document.components) ? document.components.length : 0},
            {key: "uiElements", value: countElements(document)},
        ],
    }),
    diff: diffUIDocument,
    // No `merge3`. See the note at the foot of `uiDocumentDiff.ts` for why refusing is the answer
    // rather than a gap: two authors who both rearranged one Surface's tree cannot be merged into a
    // layout either of them wrote, and the first tier - take one side's whole file - is honest.
});

/** Surface elements plus every component definition's own, which is what the panel counts. */
function countElements(document: UIDocument): number {
    let total = isJsonObject(document.elements) ? Object.keys(document.elements).length : 0;
    for (const component of Array.isArray(document.components) ? document.components : []) {
        const elements = (component as {elements?: unknown} | null)?.elements;
        if (isJsonObject(elements)) {
            total += Object.keys(elements).length;
        }
    }
    return total;
}

function describe(value: unknown): string {
    if (value === null) {
        return "null";
    }
    return Array.isArray(value) ? "an array" : `a ${typeof value}`;
}
