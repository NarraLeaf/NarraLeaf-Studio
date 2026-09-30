/**
 * The sentence an author reads when a reader refuses a project file a newer NarraLeaf Studio wrote.
 *
 * The refusal itself is a value ({@link ProjectDocumentTooNewError}) carrying three facts and no
 * prose, because it is thrown deep inside a read and caught at a boundary that knows the language.
 * This is that boundary's half, and it is the only place that composes it: the main process prints
 * it on Dev Mode's console, on Dev Mode's failure screen and in the build report, and the renderer
 * puts it on the workspace failure screen. A second wording anywhere would be a second answer to
 * the same question, told in a different number of facts - which is how the interface document's
 * refusal came to say neither version number while the story's said both.
 *
 * Shared rather than main-only for that reason, and it imports nothing but the catalogue: the two
 * processes read the same documents and refuse them on the same terms.
 */

import { createTranslator, FALLBACK_LOCALE, type LocaleCode } from "@shared/i18n";
import type { ProjectDocumentTooNewError } from "./newerSchema";

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
