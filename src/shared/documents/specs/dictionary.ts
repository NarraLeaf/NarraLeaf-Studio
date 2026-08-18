import {
  migrateProjectDictionaryDocument,
  PROJECT_DICTIONARY_SCHEMA_VERSION,
  type ProjectDictionaryDocument
} from "../../types/dictionary";
import { defineDocumentSpec } from "../registry";
import { rejectNewerSchema, requireDocumentObject } from "./parseHelpers";

/**
 * `editor/dictionary.json` - the words this project spells on purpose.
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
    // A present-but-wrong `words` is corrupt rather than "no words": the normalizer answers an
    // empty list for anything it cannot read, and the first added word would write that back
    // over every term the project had.
    if (record.words !== undefined && !Array.isArray(record.words)) {
      context.corrupt(`"words" must be an array, got ${typeof record.words}`);
    }
    return migrateProjectDictionaryDocument(record);
  },
  // No authored name: there is one of these per project and the history UI labels it by kind.
  summarize: (document) => ({
    title: "",
    counts: [{ key: "dictionaryWords", value: document.words.length }]
  })
});
