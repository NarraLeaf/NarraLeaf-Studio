import {
    APP_TAG_SCHEMA_VERSION,
    migrateProjectAppTagDocument,
    type ProjectAppTagDocument,
} from "../../types/appTag";
import {defineDocumentSpec} from "../registry";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/app-tags.json` - the build variants the project can be shipped as.
 *
 * Owned by `AppTagService`. A first-class document rather than a corner of `.nlproj` because the
 * `.nlproj` holds the values a tag overrides: version control has to be able to show "the demo's
 * name changed" as its own change, and a diff of the whole project file cannot.
 *
 * Holds author-created tags only. The release tag is synthesized on read, so this document is
 * absent, not empty-with-one-entry, in a project that has never had another variant.
 *
 * The path is `ProjectNameConvention.EditorAppTags` spelled as a pattern; the two are kept in step
 * by the renderer's `services/core/documentSpecs.test.ts`, which is the only place that can see both
 * (this module is shared, the convention is not).
 */
export const APP_TAGS_DOCUMENT_PATH = "editor/app-tags.json";

export const appTagsSpec = defineDocumentSpec<ProjectAppTagDocument>({
    kind: "app-tags",
    version: APP_TAG_SCHEMA_VERSION,
    paths: [APP_TAGS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "an app tag list");
        rejectNewerSchema(record, context, APP_TAG_SCHEMA_VERSION);
        // A present-but-wrong `tags` is corrupt rather than "no tags": the normalizer answers an
        // empty list for anything it cannot read, and the first edit would write that back over
        // whatever the author actually had.
        if (record.tags !== undefined && !Array.isArray(record.tags)) {
            context.corrupt(`"tags" must be an array, got ${typeof record.tags}`);
        }
        return migrateProjectAppTagDocument(record);
    },
    // No authored name: there is one of these per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        counts: [{key: "appTags", value: document.tags.length}],
    }),
});
