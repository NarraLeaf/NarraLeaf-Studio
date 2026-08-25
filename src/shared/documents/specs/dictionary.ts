import {
    migrateProjectDictionaryDocument,
    PROJECT_DICTIONARY_SCHEMA_VERSION,
    type ProjectDictionaryDocument,
    type ProjectDictionaryEntry,
} from "../../types/dictionary";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {defineDocumentSpec} from "../registry";
import {authoredName, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/dictionary.json` - the terms this project writes on purpose, and how it writes them.
 *
 * Owned by `DictionaryService`. A first-class document rather than a corner of `.nlproj`, and for a
 * sharper reason than its neighbours have: Chromium's own custom dictionary is a file in the
 * Electron profile, so a list kept there would be one machine's opinion of one author's project.
 * Being a document is what makes the cast's names travel with the repository, and it buys the
 * three-way merge, the debounced autosave and the unreadable latch on the way.
 *
 * The path is `ProjectNameConvention.EditorDictionary` spelled as a pattern; the two are kept in
 * step by the renderer's `services/core/documentSpecs.test.ts`, which is the only place that can see
 * both (this module is shared, the convention is not).
 */
export const DICTIONARY_DOCUMENT_PATH = "editor/dictionary.json";

export const dictionarySpec = defineDocumentSpec<ProjectDictionaryDocument>({
    kind: "dictionary",
    version: PROJECT_DICTIONARY_SCHEMA_VERSION,
    paths: [DICTIONARY_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a project dictionary");
        rejectNewerSchema(record, context, PROJECT_DICTIONARY_SCHEMA_VERSION);
        // A present-but-wrong list is corrupt rather than "no terms": the normalizer answers an
        // empty list for anything it cannot read, and the first added term would write that back
        // over every term the project had. Both field names are checked because a v1 file names the
        // list `words` and this build names it `entries`.
        if (record.entries !== undefined && !Array.isArray(record.entries)) {
            context.corrupt(`"entries" must be an array, got ${typeof record.entries}`);
        }
        if (record.words !== undefined && !Array.isArray(record.words)) {
            context.corrupt(`"words" must be an array, got ${typeof record.words}`);
        }
        return migrateProjectDictionaryDocument(record);
    },
    // No authored name: there is one of these per project and the history UI labels it by kind.
    summarize: document => ({
        title: "",
        counts: [{key: "dictionaryTerms", value: document.entries.length}],
    }),
    diff: diffDictionary,
});

const LABEL = {
    added: "documentDiff.dictionary.added",
    removed: "documentDiff.dictionary.removed",
    reading: "documentDiff.dictionary.reading",
    variants: "documentDiff.dictionary.variants",
    note: "documentDiff.dictionary.note",
    readingsOn: "documentDiff.dictionary.readingsOn",
    readingsOff: "documentDiff.dictionary.readingsOff",
    variantsOn: "documentDiff.dictionary.variantsOn",
    variantsOff: "documentDiff.dictionary.variantsOff",
} as const;

/**
 * One row per term, plus the two things the dictionary is asked to do.
 *
 * **The one place in this family with no rename row, and it cannot have one.** Every other document
 * here keys its entries by a generated id and carries the author's word beside it, so a renamed
 * thing is the same thing with a different name. A dictionary entry has no id: the spelling IS the
 * identity, every other field describes it, and there is nothing on either side that says the term
 * on the left and the term on the right are the same entry. So changing a spelling is reported as
 * one term gone and another arrived, which is what the file records and all it records - inventing
 * a rename would mean guessing which removal pairs with which addition.
 */
export function diffDictionary(base: ProjectDictionaryDocument, head: ProjectDictionaryDocument, options: {limit: number}): DocumentDiff {
    const rows: DocumentChange[] = [];

    for (const entry of diffKeyed(byTerm(base.entries), byTerm(head.entries))) {
        const path = ["entries", entry.key];
        // The term itself, which is a word the author typed - unlike every other subject here, it
        // is the key as well.
        const subject = authoredName(entry.key);
        if (!entry.base || !entry.head) {
            rows.push(change(path, entry.kind, entry.head ? LABEL.added : LABEL.removed, {subject}));
            continue;
        }
        if (!sameJsonValue(entry.base.reading, entry.head.reading)) {
            rows.push(change([...path, "reading"], presence(entry.base.reading, entry.head.reading), LABEL.reading, {
                params: fromToParams(entry.base.reading, entry.head.reading),
                subject,
            }));
        }
        // A list, so no value pair: the surface draws one value against another, and two lists of
        // spellings quoted into one line would be unreadable at any width.
        if (!sameJsonValue(entry.base.variants, entry.head.variants)) {
            rows.push(change([...path, "variants"], presence(entry.base.variants, entry.head.variants), LABEL.variants, {
                subject,
            }));
        }
        if (!sameJsonValue(entry.base.note, entry.head.note)) {
            rows.push(change([...path, "note"], presence(entry.base.note, entry.head.note), LABEL.note, {
                params: fromToParams(entry.base.note, entry.head.note),
                subject,
            }));
        }
    }

    // The two options, stated as what the dictionary now does rather than as a pair of switch
    // positions: they change what the story editor marks in every script in the project.
    if (base.options.suggestReadings !== head.options.suggestReadings) {
        rows.push(change(["options", "suggestReadings"], "changed", head.options.suggestReadings ? LABEL.readingsOn : LABEL.readingsOff));
    }
    if (base.options.checkVariants !== head.options.checkVariants) {
        rows.push(change(["options", "checkVariants"], "changed", head.options.checkVariants ? LABEL.variantsOn : LABEL.variantsOff));
    }

    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}

/**
 * The entries keyed by their spelling.
 *
 * Not {@link byId}: an entry has no id. A duplicate spelling cannot come out of the normalizer -
 * two records of one term are merged on parse - so the first-wins rule here only ever applies to
 * something no Studio wrote.
 */
function byTerm(entries: readonly ProjectDictionaryEntry[]): Record<string, ProjectDictionaryEntry> {
    const record: Record<string, ProjectDictionaryEntry> = {};
    for (const entry of entries) {
        if (typeof entry?.term === "string" && entry.term.length > 0 && !Object.prototype.hasOwnProperty.call(record, entry.term)) {
            record[entry.term] = entry;
        }
    }
    return record;
}

function presence(base: unknown, head: unknown): "added" | "removed" | "changed" {
    if (base === undefined) {
        return "added";
    }
    return head === undefined ? "removed" : "changed";
}
