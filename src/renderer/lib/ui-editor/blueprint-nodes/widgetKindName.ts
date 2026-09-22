import type { TranslationKey } from "@shared/i18n";
import { translate } from "@/lib/i18n";

/**
 * The palette categories that name a widget kind, by the type a document stores.
 *
 * A runtime error that says which kind of widget a node wanted has only the stored type in hand
 * (`nl.slider`), and that is not a word an author has ever seen. The node palette already names
 * every kind a built-in node acts on - its categories are the kinds - so the sentence borrows that
 * word rather than keeping a second list of widget names.
 */
const WIDGET_KIND_KEYS: Readonly<Record<string, TranslationKey>> = {
    "nl.button": "blueprint.category.button",
    "nl.container": "blueprint.category.container",
    "nl.frame": "blueprint.category.frame",
    "nl.image": "blueprint.category.image",
    "nl.list": "blueprint.category.list",
    "nl.slider": "blueprint.category.slider",
    "nl.switch": "blueprint.category.switch",
    "nl.text": "blueprint.category.text",
    "nl.textInput": "blueprint.category.textInput",
};

/** A widget kind in the author's language, for a runtime error; "Widget" for any other type. */
export function widgetKindName(elementType: string): string {
    return translate(WIDGET_KIND_KEYS[elementType] ?? "blueprint.category.widget");
}
