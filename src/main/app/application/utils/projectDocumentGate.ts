import { createTranslator, FALLBACK_LOCALE, type LocaleCode } from "@shared/i18n";
import {
    findProjectDocumentTooNewError,
    type ProjectDocumentTooNewError,
} from "@shared/documents/newerSchema";
import { findStoryDocumentTooNewError } from "@shared/story/migrateStoryDocument";

/**
 * The sentence an author reads when the main process refuses a project file a newer Studio wrote.
 *
 * The refusal itself is a value (`ProjectDocumentTooNewError`) carrying three facts and no prose,
 * because it is thrown deep inside an assembly and caught at a boundary that knows the language.
 * This is that boundary's half: it turns the three facts into one sentence, and it is the only
 * place that composes it - Dev Mode's console, Dev Mode's failure screen and the build report all
 * print the message of the error they were handed, so a second wording here would be a second
 * answer to the same question.
 */
export function describeProjectDocumentTooNew(
    refusal: ProjectDocumentTooNewError,
    locale: LocaleCode = FALLBACK_LOCALE,
): string {
    const translator = createTranslator(locale);
    return translator.t("documents.tooNew.message", {
        subject: refusal.subject,
        // The kind list and the nouns are the same closed set, so this composes rather than
        // switching; `projectDocumentGate.test.ts` is what holds the two ends together.
        kind: translator.t(`documents.tooNew.kind.${refusal.kind}`),
        version: refusal.version,
        supported: refusal.supportedVersion,
    });
}

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
