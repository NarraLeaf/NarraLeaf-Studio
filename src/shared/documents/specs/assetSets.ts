import {
    ASSET_SET_SCHEMA_VERSION,
    migrateProjectAssetSetDocument,
    type ProjectAssetSetDocument,
} from "../../types/assetSet";
import {defineDocumentSpec} from "../registry";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/asset-sets.json` - the asset sets the project declares.
 *
 * Owned by `AssetSetService`. A registered document rather than a corner of the assets metadata for
 * the reason `app-tags.json` is not a corner of the `.nlproj`: the metadata shards hold the records
 * a set is *measured against*, and putting the declaration inside them would make "this file's tags
 * changed" and "the set that reads those tags changed" the same change to version control.
 *
 * It is also the wrong shard by construction. The metadata is sharded per asset type, and a set is
 * one record about a family of them - there is no shard it belongs in, and a registry answers "which
 * sets does this project have" without a directory listing, which `DocumentStorage` does not offer.
 *
 * Absent, not empty, in a project that has never declared one: the file appears with the first set.
 *
 * The path is `ProjectNameConvention.EditorAssetSets` spelled as a pattern; the two are kept in step
 * by the renderer's `services/core/documentSpecs.test.ts`, which is the only place that can see both
 * (this module is shared, the convention is not).
 */
export const ASSET_SETS_DOCUMENT_PATH = "editor/asset-sets.json";

export const assetSetsSpec = defineDocumentSpec<ProjectAssetSetDocument>({
    kind: "asset-sets",
    version: ASSET_SET_SCHEMA_VERSION,
    paths: [ASSET_SETS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "an asset set list");
        rejectNewerSchema(record, context, ASSET_SET_SCHEMA_VERSION);
        // A present-but-wrong `sets` is corrupt rather than "no sets", the same hazard `app-tags`
        // guards: the normalizer answers an empty list for anything it cannot read, and the first
        // edit would write that back over every set the author declared.
        if (record.sets !== undefined && !Array.isArray(record.sets)) {
            context.corrupt(`"sets" must be an array, got ${typeof record.sets}`);
        }
        return migrateProjectAssetSetDocument(record);
    },
    // No authored name: there is one of these per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        counts: [{key: "assetSets", value: document.sets.length}],
    }),
});
