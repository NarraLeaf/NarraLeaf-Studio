import type { UIElement } from "@shared/types/ui-editor/document";
import { uiTextSampleCauseOf, type UITextSampleCause } from "@shared/types/ui-editor/textSample";
import type { UITextSite, UITextSource } from "@shared/types/ui-editor/textSource";
import { uiTextSiteIsWrittenOver, type UITextWriter } from "@shared/types/ui-editor/textWriters";

/**
 * The box a text's or a button's inspector edits the element's own words in, under the choice of where
 * the words come from.
 *
 * - `words`: the words a player reads.
 * - `default`: the words a player reads until a blueprint writes over them while the game runs - the
 *   element's default value, labelled as such, with the writers listed beneath.
 * - `sample`: sample text; the binding named by `cause` answers the words in the game.
 * - `none`: no box for the element's own words. A key is chosen, whose own field edits the key's
 *   words, or a list row's field answers them and the canvas draws the list's rows there.
 */
export type LabelWordsBox =
    | { kind: "words" }
    | { kind: "default" }
    | { kind: "sample"; cause: UITextSampleCause }
    | { kind: "none" };

/**
 * Which box the element's own words are edited in.
 *
 * `shown` is the source the field shows as chosen (`uiTextSourceOf`, or `key` while a key is being
 * picked). `writers` are the element's own (`UITextWriterIndex.get(element.id)`). Sample text is
 * decided by `uiTextSampleCauseOf` and a default value by `uiTextSiteIsWrittenOver`, the same two
 * answers the packager, the translation table and the checks read, so the box never says something
 * about the words that the rest of Studio does not.
 */
export function labelWordsBoxOf(
    element: UIElement,
    site: UITextSite,
    writers: readonly UITextWriter[] | undefined,
    shown: UITextSource | null,
): LabelWordsBox {
    if (shown === "key") {
        return { kind: "none" };
    }
    const cause = uiTextSampleCauseOf(element, site);
    if (cause === "listItemField") {
        return { kind: "none" };
    }
    if (cause) {
        return { kind: "sample", cause };
    }
    return uiTextSiteIsWrittenOver(writers, site) ? { kind: "default" } : { kind: "words" };
}
