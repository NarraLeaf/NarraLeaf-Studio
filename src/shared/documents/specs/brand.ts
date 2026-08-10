import {
    BRAND_SCHEMA_VERSION,
    migrateProjectBrandDocument,
    type ProjectBrandDocument,
} from "../../types/brand";
import {defineDocumentSpec} from "../registry";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/brand.json` - the project's own palette.
 *
 * Owned by `BrandService`. A first-class document rather than a corner of `.nlproj` for the reason
 * the audio tracks are one, only more so: `.nlproj` is msgpack, and a colour is something an author
 * changes constantly and needs to see in a diff - "who moved the primary colour" is a question a
 * whole-binary-file change cannot answer. Being a document also buys the three-way merge, the
 * debounced autosave and the unreadable latch for free.
 *
 * The path is `ProjectNameConvention.EditorBrand` spelled as a pattern; the two are kept in step by
 * the renderer's `services/core/documentSpecs.test.ts`, which is the only place that can see both
 * (this module is shared, the convention is not).
 */
export const BRAND_DOCUMENT_PATH = "editor/brand.json";

export const brandSpec = defineDocumentSpec<ProjectBrandDocument>({
    kind: "brand",
    version: BRAND_SCHEMA_VERSION,
    paths: [BRAND_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a brand palette");
        rejectNewerSchema(record, context, BRAND_SCHEMA_VERSION);
        // A present-but-wrong `colors` is corrupt rather than "no colours": the normalizer seeds the
        // whole built-in palette for anything it cannot read, and the first edit would write that
        // seed back over whatever the author actually had.
        if (record.colors !== undefined && !Array.isArray(record.colors)) {
            context.corrupt(`"colors" must be an array, got ${typeof record.colors}`);
        }
        return migrateProjectBrandDocument(record);
    },
    // No authored name: there is one of these per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        // The author's own colours, not the total. The seeds are always present and always the same
        // number, so counting them reports a change of 17 -> 17 for every edit that is not an add or
        // a delete - a row in the history that carries no information at all.
        counts: [{key: "brandColors", value: document.colors.filter(color => !color.builtin).length}],
    }),
});
