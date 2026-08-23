import {
    BRAND_SCHEMA_VERSION,
    migrateProjectBrandDocument,
    type ProjectBrandDocument,
} from "../../types/brand";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {defineDocumentSpec} from "../registry";
import {authoredName, byId, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/brand.json` - the project's own palette, and its default font stack.
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
        // Same reading as `colors`, and for the same reason: the normalizer answers "an empty stack"
        // for anything it cannot read, and an empty stack is a legitimate state - so a present-but-
        // wrong `fonts` would be saved back as "this project has no default font" the next time the
        // author touched a colour, with nothing on screen having said the field was lost.
        if (record.fonts !== undefined && !Array.isArray(record.fonts)) {
            context.corrupt(`"fonts" must be an array, got ${typeof record.fonts}`);
        }
        return migrateProjectBrandDocument(record);
    },
    // No authored name: there is one of these per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        // The author's own colours, not the total. The seeds are always present and always the same
        // number, so counting them reports a change of 17 -> 17 for every edit that is not an add or
        // a delete - a row in the history that carries no information at all.
        counts: [
            {key: "brandColors", value: document.colors.filter(color => !color.builtin).length},
            // Counted whole, unlike the colours: every rung of the stack is one the author put
            // there, so there is no seeded floor to subtract and 0 -> 1 is the row that matters.
            {key: "brandFonts", value: document.fonts.length},
        ],
    }),
    diff: diffBrand,
});

const LABEL = {
    added: "documentDiff.brand.added",
    removed: "documentDiff.brand.removed",
    renamed: "documentDiff.brand.renamed",
    value: "documentDiff.brand.value",
    fonts: "documentDiff.brand.fonts",
} as const;

/**
 * One row per colour, with the two colours themselves as the value pair.
 *
 * A palette is the document where the summary tier was least use: the seeded entries are always
 * present and always the same number, so every edit that is not an add or a delete moved no count
 * at all and the whole change read as "changed, in a way the summary does not show". The rows are
 * flat rather than a group per colour because a colour has two authored parts - what it is called
 * and what it is - and either one alone is the whole change most of the time.
 *
 * **A seeded colour carries no `subject`, and that is deliberate.** Its name is a translated string
 * the panel supplies and its id is Studio's spelling, so there is nothing here the author typed;
 * `BrandChangeDetail` draws the whole palette underneath, which is where the slot a change belongs
 * to is named. Inventing a subject would put Studio's word in front of the author as theirs.
 */
export function diffBrand(base: ProjectBrandDocument, head: ProjectBrandDocument, options: {limit: number}): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(byId(base.colors), byId(head.colors))) {
        const path = ["colors", entry.key];
        const subject = authoredName(entry.head?.name) ?? authoredName(entry.base?.name);
        if (!entry.base || !entry.head) {
            rows.push(change(path, entry.kind, entry.head ? LABEL.added : LABEL.removed, {
                params: fromToParams(entry.base?.value, entry.head?.value),
                subject,
            }));
            continue;
        }
        if (!sameJsonValue(entry.base.name, entry.head.name)) {
            rows.push(change([...path, "name"], "changed", LABEL.renamed, {
                params: fromToParams(entry.base.name, entry.head.name),
                subject,
            }));
        }
        // The row this spec exists for. The value is a CSS literal or a link to another entry, and
        // both are drawn as a pair of swatches rather than read.
        if (!sameJsonValue(entry.base.value, entry.head.value)) {
            rows.push(change([...path, "value"], "changed", LABEL.value, {
                params: fromToParams(entry.base.value, entry.head.value),
                subject,
            }));
        }
    }

    // One row for the whole stack, and no value pair: a rung is stored as an asset id, which is
    // Studio's handle for a file rather than the name the author gave the font.
    if (!sameJsonValue(base.fonts, head.fonts)) {
        rows.push(change(["fonts"], "changed", LABEL.fonts));
    }

    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}
