import {
    migrateProjectTransformPresetDocument,
    transformPresetSignature,
    TRANSFORM_PRESET_SCHEMA_VERSION,
    type ProjectTransformPresetDocument,
} from "../../types/transformPreset";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {defineDocumentSpec} from "../registry";
import {authoredName, byId, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/transform-presets.json` - the transforms this project saved to reuse.
 *
 * Owned by `TransformPresetService`. A first-class document for the reason the palette is one: it is
 * a small project-level list several rows are written from, and it has to travel with the repository
 * - a preset kept in this machine's settings would be invisible to everyone else working on the
 * project, including the same author on another computer.
 *
 * The path is `ProjectNameConvention.EditorTransformPresets` spelled as a pattern; the two are kept
 * in step by the renderer's `services/core/documentSpecs.test.ts`, which is the only place that can
 * see both (this module is shared, the convention is not).
 */
export const TRANSFORM_PRESETS_DOCUMENT_PATH = "editor/transform-presets.json";

export const transformPresetsSpec = defineDocumentSpec<ProjectTransformPresetDocument>({
    kind: "transform-presets",
    version: TRANSFORM_PRESET_SCHEMA_VERSION,
    paths: [TRANSFORM_PRESETS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a transform preset list");
        rejectNewerSchema(record, context, TRANSFORM_PRESET_SCHEMA_VERSION);
        // A present-but-wrong list is corrupt rather than "no presets": the normalizer answers an
        // empty list for anything it cannot read, and the next preset saved would write that back
        // over every preset the project had.
        if (record.presets !== undefined && !Array.isArray(record.presets)) {
            context.corrupt(`"presets" must be an array, got ${typeof record.presets}`);
        }
        return migrateProjectTransformPresetDocument(record);
    },
    // No authored name: there is one of these per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        counts: [{key: "transformPresets", value: document.presets.length}],
    }),
    diff: diffTransformPresets,
});

const LABEL = {
    added: "documentDiff.transformPresets.added",
    removed: "documentDiff.transformPresets.removed",
    renamed: "documentDiff.transformPresets.renamed",
    transform: "documentDiff.transformPresets.transform",
} as const;

/**
 * One row per preset: it arrived, it went, it was renamed, or what it does changed.
 *
 * The transform itself carries no value pair. A bag of channels is a record, not a value - the
 * surface draws one against the other on a single line, and `{"to":{"position":{"xalign":0.25}}}`
 * quoted there is not something anyone reads. That the preset now seeds something else is the whole
 * of what this document can honestly say about it.
 */
export function diffTransformPresets(
    base: ProjectTransformPresetDocument,
    head: ProjectTransformPresetDocument,
    options: {limit: number},
): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(byId(base.presets), byId(head.presets))) {
        const path = ["presets", entry.key];
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
        // Compared by signature rather than by JSON: the two sides are normalized the same way, so
        // a bag whose keys were written in another order is not reported as a change nobody made.
        if (transformPresetSignature(entry.base.transform) !== transformPresetSignature(entry.head.transform)) {
            rows.push(change([...path, "transform"], "changed", LABEL.transform, {subject}));
        }
    }

    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}
