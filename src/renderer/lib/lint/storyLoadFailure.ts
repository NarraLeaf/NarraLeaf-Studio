/**
 * What lint says about a story that would not open.
 *
 * Assembling the context is the only place this can be noticed - a document the ladder refuses is
 * never handed to a rule - so it belongs to no rule, and it is reported under `story/unreadable`,
 * an id with no registry entry, no settings row and a severity fixed at `error`. See
 * {@link import("./types").LINT_RULELESS_IDS}.
 *
 * It lives here rather than inside the workspace service because two readers assemble a lint
 * context over the same library: the service, and the headless project context the `story` command
 * line builds. An unreadable story reported by one and swallowed by the other would mean the tool
 * printing "clean" for a project Studio refuses to open.
 */

import { findStoryDocumentTooNewError, findStoryDocumentTooOldError } from "@shared/story/migrateStoryDocument";
import type { LintReportEntry } from "./types";

/**
 * One story that failed to load, as a finding.
 *
 * Always an error: silently linting the remaining eight of nine stories and reporting "no problems"
 * is the worst answer available, and how much that matters is not a preference a project gets to
 * express.
 */
export function storyUnreadableFinding(story: { id: string; name: string }, error: unknown): LintReportEntry {
    return {
        ruleId: "story/unreadable",
        ...describeStoryLoadFailure(story.name, error),
        location: { kind: "story", storyId: story.id, storyName: story.name },
        severity: "error",
    };
}

/**
 * Three answers, and the two schema ones are the reason this is a function rather than a ternary.
 *
 * A document outside the schema ladder is the one failure here that is not about the script at all,
 * and it is the one an author is most likely to misread: nothing in their project changed, Studio
 * did, and "could not be opened" beside their own story's name reads as something they broke. So
 * both ends of the ladder say which version the file is at and which version answers it - the
 * numbers the ladder throws for exactly this purpose, and which every wrapper between here and it
 * would otherwise flatten back into a sentence.
 *
 * The generic line stays for everything else - a truncated write, a document whose id does not match
 * its folder - where the file itself is what went wrong and there is no version to name.
 */
export function describeStoryLoadFailure(
    storyName: string,
    error: unknown,
): Pick<LintReportEntry, "messageKey" | "messageParams"> {
    const tooOld = findStoryDocumentTooOldError(error);
    if (tooOld) {
        return {
            messageKey: "lint.message.storyTooOld",
            messageParams: { story: storyName, version: tooOld.version, minimum: tooOld.minimumVersion },
        };
    }
    const tooNew = findStoryDocumentTooNewError(error);
    if (tooNew) {
        return {
            messageKey: "lint.message.storyTooNew",
            messageParams: { story: storyName, version: tooNew.version, supported: tooNew.supportedVersion },
        };
    }
    return { messageKey: "lint.message.storyLoadFailed", messageParams: { story: storyName } };
}
