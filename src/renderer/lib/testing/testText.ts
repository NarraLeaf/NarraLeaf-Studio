import { translate } from "@/lib/i18n";
import type { TestText } from "./types";

/**
 * Render a {@link TestText} to a string, here and now.
 *
 * Imperative, so it is only for text that is *consumed* at the moment it is produced - a console
 * line, the message of a thrown refusal. Anything that stays on screen must keep the `TestText` and
 * render it through the hook, or it will not follow a live language switch.
 *
 * The two arms are not interchangeable: a plugin has no `TranslationKey`s and hands over what its
 * own translator already produced, so `text` is passed through untouched rather than being looked up
 * and coming back as a missing-key placeholder.
 */
export function formatTestText(text: TestText): string {
    return text.key !== undefined ? translate(text.key, text.params) : text.text;
}

/**
 * A locale-independent sort key for a title.
 *
 * Deliberately the key (or the literal), not the rendered string: `list()` is read by the picker,
 * the report tab and the plugin surface, and an order that changed when the editor language changed
 * would make "the second test in the list" mean two different things in one session. The lint
 * engine sorts its entries on the same principle and for the same reason.
 */
export function testTextSortKey(text: TestText): string {
    return text.key !== undefined ? text.key : text.text;
}
