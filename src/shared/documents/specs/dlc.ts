import {
    DLC_SCHEMA_VERSION,
    migrateProjectDlcDocument,
    type ProjectDlcDocument,
} from "../../types/dlc";
import {defineDocumentSpec} from "../registry";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/dlc.json` - the DLC the project ships beside its builds.
 *
 * Owned by `DlcService`. A first-class document rather than a corner of `.nlproj` for the reason
 * `editor/app-tags.json` is one: version control has to be able to show "a DLC was added" as its own
 * change, and a diff of the whole project file cannot.
 *
 * Absent, not empty, in a project that ships none - which is most of them.
 *
 * The path is `ProjectNameConvention.EditorDlc` spelled as a pattern; the two are kept in step by
 * the renderer's `services/core/documentSpecs.test.ts`, which is the only place that can see both.
 */
export const DLC_DOCUMENT_PATH = "editor/dlc.json";

export const dlcSpec = defineDocumentSpec<ProjectDlcDocument>({
    kind: "dlc",
    version: DLC_SCHEMA_VERSION,
    paths: [DLC_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a DLC list");
        rejectNewerSchema(record, context, DLC_SCHEMA_VERSION);
        // A present-but-wrong `dlcs` is corrupt rather than "no DLC": the normalizer answers an
        // empty list for anything it cannot read, and the first edit would write that back over
        // whatever the author actually had - taking with it the ids their shipped files are named
        // after.
        if (record.dlcs !== undefined && !Array.isArray(record.dlcs)) {
            context.corrupt(`"dlcs" must be an array, got ${typeof record.dlcs}`);
        }
        return migrateProjectDlcDocument(record);
    },
    // No authored name: there is one of these per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        counts: [{key: "dlc", value: document.dlcs.length}],
    }),
});
