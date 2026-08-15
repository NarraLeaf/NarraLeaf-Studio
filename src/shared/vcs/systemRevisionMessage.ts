import type { TranslationKey } from "@shared/i18n";
import type { VcsCheckpointReason } from "@shared/types/vcs";

/**
 * The messages Studio writes onto a revision when nobody typed one, and how a surface says them
 * back in the reader's language.
 *
 * **The bytes stay English.** A commit message is permanent repository content: it travels to
 * collaborators, it is read by the author's own `lore` CLI, and it outlives the interface language
 * it happened to be written under. A history where the same automatic checkpoint reads differently
 * depending on who was looking when it happened is worse than one that reads in English throughout.
 * That decision is unchanged and this module is where it is now spelled out once, so the main
 * process and the rail cannot drift apart about which sentences are Studio's own.
 *
 * **What changes is the reading.** A Chinese or Japanese author was seeing half their history in
 * English - the panel's headline said `Checkpoint before closing the project` under a column titled
 * 「版本」- because the only thing between the stored bytes and the screen was `.trim()`. So the
 * strings below are also a closed vocabulary that {@link recogniseSystemRevisionMessage} matches,
 * and a surface that gets a match draws the translation instead.
 *
 * Recognition is by CONTENT rather than by a metadata key, deliberately: metadata could only ever
 * describe revisions recorded after it shipped, and the histories that need this most are the ones
 * that already exist. The cost is that rewording any constant here silently drops its translation,
 * which is what `systemRevisionMessage.test.ts` walks the whole table to prevent.
 */

/**
 * What `initRepository` records on the revision that starts a repository.
 *
 * The wording is the rail's offer, because that is where it is pressed: an existing project the
 * author decides to start versioning.
 */
export const VCS_INITIAL_MESSAGE = "Enable version control";

/**
 * The same first revision, when the project wizard made it.
 *
 * A separate sentence because it describes a different act - nobody "enabled version control" on a
 * project that has existed for four seconds - and it is passed explicitly by
 * `project-wizard/services/projectService.ts`, which is the only other caller that names one.
 *
 * It lives here rather than there for the reason the whole module exists: it was a literal in the
 * wizard, so it was the one Studio-written message the rail did not recognise, and every project
 * created through the wizard had an English line at the bottom of its history in every language.
 * Found by looking at a real project, not by a test - which is why the test now walks
 * {@link VCS_SYSTEM_MESSAGES} rather than a list written out by hand.
 */
export const VCS_PROJECT_CREATED_MESSAGE = "Create project";

/** What an author's own submission records when they left the message box empty. */
export const VCS_DEFAULT_COMMIT_MESSAGE = "Commit";

/** What a merge the author did not name records. */
export const VCS_DEFAULT_MERGE_MESSAGE = "Merge";

/**
 * What a checkpoint's message says, by why it was taken.
 *
 * Keyed by {@link VcsCheckpointReason} so a new reason is a type error here rather than a checkpoint
 * that records an empty message.
 */
export const VCS_CHECKPOINT_MESSAGES: Readonly<Record<VcsCheckpointReason, string>> = {
    interval: "Checkpoint",
    "project-close": "Checkpoint before closing the project",
    build: "Checkpoint before build",
    restore: "Checkpoint before restore",
};

/** The fixed half of what a restore records. The version it went back to follows it. */
const RESTORE_MESSAGE_PREFIX = "Restore version ";

/**
 * What a restore records.
 *
 * The label is a revision number (`#12`) or a hash, and neither is language - which is why this is
 * the one system message that carries a parameter rather than being a constant.
 */
export function composeRestoreMessage(label: string): string {
    return `${RESTORE_MESSAGE_PREFIX}${label}`;
}

export interface SystemRevisionMessage {
    key: TranslationKey;
    params?: Readonly<Record<string, string>>;
}

/**
 * Every message with no parameters in it, and the key that reads it back.
 *
 * **This table is the contract, and a test walks it.** A sentence Studio writes that is not in here
 * renders in English inside a Chinese list, which nothing else in the app would notice - that is
 * exactly how `Create project` survived the first pass. So new machine-written messages are added
 * here, and the constant is imported by whoever writes it rather than typed out there.
 */
export const VCS_SYSTEM_MESSAGES: ReadonlyArray<readonly [string, TranslationKey]> = [
    [VCS_INITIAL_MESSAGE, "workspace.shell.versionControl.systemMessage.enabled"],
    [VCS_PROJECT_CREATED_MESSAGE, "workspace.shell.versionControl.systemMessage.created"],
    [VCS_DEFAULT_COMMIT_MESSAGE, "workspace.shell.versionControl.systemMessage.unnamed"],
    [VCS_DEFAULT_MERGE_MESSAGE, "workspace.shell.versionControl.systemMessage.merge"],
    [VCS_CHECKPOINT_MESSAGES.interval, "workspace.shell.versionControl.systemMessage.checkpoint"],
    [VCS_CHECKPOINT_MESSAGES["project-close"], "workspace.shell.versionControl.systemMessage.checkpointClose"],
    [VCS_CHECKPOINT_MESSAGES.build, "workspace.shell.versionControl.systemMessage.checkpointBuild"],
    [VCS_CHECKPOINT_MESSAGES.restore, "workspace.shell.versionControl.systemMessage.checkpointRestore"],
];

/** The same table as a lookup. A `Map` so a sentence cannot collide with `Object.prototype`. */
const FIXED_MESSAGES: ReadonlyMap<string, TranslationKey> = new Map(VCS_SYSTEM_MESSAGES);

/**
 * The translation for a message Studio wrote itself, or null for one the author wrote.
 *
 * Null is the ordinary answer and the safe one: anything this does not recognise - the author's own
 * sentence, a message from another Lore client, a future Studio's wording - is drawn verbatim, which
 * is what the whole surface did before this existed.
 *
 * Matched on the trimmed message because that is what the surfaces render; matched exactly rather
 * than by prefix, so an author who names their version `Checkpoint before the demo` keeps their own
 * words.
 */
export function recogniseSystemRevisionMessage(message: string): SystemRevisionMessage | null {
    const trimmed = message.trim();
    const fixed = FIXED_MESSAGES.get(trimmed);
    if (fixed) {
        return { key: fixed };
    }
    if (trimmed.startsWith(RESTORE_MESSAGE_PREFIX)) {
        const version = trimmed.slice(RESTORE_MESSAGE_PREFIX.length).trim();
        // A bare `Restore version ` with nothing after it is not one of ours: the composer is never
        // called without a label, and translating it would leave a sentence with a hole in it.
        if (version) {
            return { key: "workspace.shell.versionControl.systemMessage.restored", params: { version } };
        }
    }
    return null;
}
