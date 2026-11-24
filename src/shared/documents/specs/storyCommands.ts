import { normalizeStoryCustomCommandDocument, STORY_CUSTOM_COMMANDS_DOCUMENT_PATH } from "../../story/customCommands";
import { STORY_CUSTOM_COMMAND_SCHEMA_VERSION, type StoryCustomCommandDocument } from "../../types/story/customCommands";
import {buildDocumentDiff, DocumentChange, DocumentDiff} from "../diff";
import {defineDocumentSpec} from "../registry";
import {authoredName, byId, change, diffKeyed, fromToParams, sameJsonValue} from "./diffHelpers";
import {rejectNewerSchema, requireDocumentObject} from "./parseHelpers";

/**
 * `editor/story/commands.json` - the project's own story commands (`@shared/story/customCommands`).
 *
 * Owned by `StoryCustomCommandService`. A first-class document because it is part of what the story
 * means: a row calling `/左右摇晃` plays whatever this file says the command is, so it has to travel
 * with the repository and show up in a diff like the story itself.
 */
export {STORY_CUSTOM_COMMANDS_DOCUMENT_PATH};

export const storyCommandsSpec = defineDocumentSpec<StoryCustomCommandDocument>({
    kind: "story-commands",
    version: STORY_CUSTOM_COMMAND_SCHEMA_VERSION,
    paths: [STORY_CUSTOM_COMMANDS_DOCUMENT_PATH],
    parse: (raw, context) => {
        const record = requireDocumentObject(raw, context, "a story command list");
        rejectNewerSchema(record, context, STORY_CUSTOM_COMMAND_SCHEMA_VERSION);
        // A present-but-wrong list is corrupt rather than "no commands": the normalizer answers an
        // empty list for anything it cannot read, and the next save would write that over the file.
        if (record.commands !== undefined && !Array.isArray(record.commands)) {
            context.corrupt(`"commands" must be an array, got ${typeof record.commands}`);
        }
        return normalizeStoryCustomCommandDocument(record);
    },
    summarize: document => ({
        title: "",
        counts: [{key: "storyCommands", value: document.commands.length}],
    }),
    diff: diffStoryCommands,
});

const LABEL = {
    added: "documentDiff.storyCommands.added",
    removed: "documentDiff.storyCommands.removed",
    renamed: "documentDiff.storyCommands.renamed",
    changed: "documentDiff.storyCommands.changed",
} as const;

/** One row per command: it arrived, it went, it was renamed, or what it plays changed. */
export function diffStoryCommands(
    base: StoryCustomCommandDocument,
    head: StoryCustomCommandDocument,
    options: {limit: number},
): DocumentDiff {
    const rows: DocumentChange[] = [];
    for (const entry of diffKeyed(byId(base.commands), byId(head.commands))) {
        const path = ["commands", entry.key];
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
        if (!sameJsonValue(entry.base.rows, entry.head.rows) || !sameJsonValue(entry.base.params, entry.head.params)) {
            rows.push(change([...path, "rows"], "changed", LABEL.changed, {subject}));
        }
    }
    return buildDocumentDiff(rows, {tier: "semantic", limit: options.limit});
}
