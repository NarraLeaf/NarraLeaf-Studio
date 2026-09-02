import type { LocaleCode } from "@shared/i18n";
import { findProjectDocumentTooNewError } from "@shared/documents/newerSchema";
import { describeProjectDocumentTooNew } from "@shared/documents/tooNewMessage";
import { findStoryDocumentTooNewError } from "@shared/story/migrateStoryDocument";

/**
 * The sentence, composed in `@shared/documents/tooNewMessage`.
 *
 * Re-exported rather than defined here because the renderer refuses documents of its own and has to
 * say the same thing about them; see that module for why there is exactly one wording.
 */
export { describeProjectDocumentTooNew };

/**
 * `error`, with a schema refusal inside it replaced by one an author can read.
 *
 * Applied at the boundary of an assembly rather than at each read. A refusal is thrown by the
 * reader that found it, travels up through loaders that know nothing about language, and is
 * rewrapped on the way; the `cause` chain is what survives that, so this looks through the chain
 * and hands back a plain `Error` whose message is the sentence. Anything else comes back
 * untouched - this is a translator, not a catch-all.
 *
 * A story document refused by the schema ladder is included, and comes out as the same sentence:
 * the ladder throws its own error type, from `@shared`, where the file kind is implicit and the
 * story's name is not in hand. `subject` is filled by the reader that knew both.
 */
export function localizeProjectDocumentRefusal(error: unknown, locale?: LocaleCode): unknown {
    const refusal = findProjectDocumentTooNewError(error);
    if (!refusal) {
        return error;
    }
    return new Error(describeProjectDocumentTooNew(refusal, locale), { cause: error });
}

/**
 * Let a loader keep "a file it cannot read degrades to the default" without letting that swallow
 * the one failure that must stop the assembly.
 *
 * Most of these loaders deliberately absorb a broken file: a hand-corrupted colour list must not be
 * why a preview will not start, and booting in the default palette is a state the author can see.
 * A document from a newer Studio is the opposite case - the default is silently *wrong* rather than
 * visibly plain, and a build made that way ships part of the author's work missing. So every one of
 * those catch blocks calls this first.
 */
export function rethrowIfTooNew(error: unknown): void {
    const refusal = findProjectDocumentTooNewError(error) ?? findStoryDocumentTooNewError(error);
    if (refusal) {
        throw refusal;
    }
}
