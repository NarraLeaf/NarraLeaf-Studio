import type { SelectOption } from "@/apps/workspace/modules/properties/framework/types";
import { widgetKindName } from "@/lib/ui-editor/blueprint-nodes/widgetKindName";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import type { Translator } from "@shared/i18n";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { isOperableWidgetType } from "@shared/types/ui-editor/inputAction";
import { readUIElementFocusability } from "@shared/types/ui-editor/navigation";
import { readUITextSite, uiTextSiteOf } from "@shared/types/ui-editor/textSource";

type TranslateFn = Translator["t"];

/** Long enough to tell two captions apart, short enough to stay beside the name in a select row. */
const WORDS_MAX_LENGTH = 24;

/**
 * Whether the focus can rest on an element: a control, or anything the author made reachable. What
 * the game decides from its graphs at run time (a container that answers a click) is not known here,
 * and is offered once the author marks it reachable.
 */
function canHoldFocus(element: UIElement): boolean {
    const focusability = readUIElementFocusability(element);
    if (focusability === "never") {
        return false;
    }
    return focusability === "always" || isOperableWidgetType(element.type);
}

/** An element as the outline names it: its name, or - unnamed - the name the insert palette gives its kind. */
function elementName(element: UIElement): string {
    return element.name?.trim() || widgetModuleRegistry.get(element.type)?.displayName || widgetKindName(element.type);
}

/** The words an element shows of its own, shortened for a select row; "" when it shows none. */
function elementWords(element: UIElement): string {
    const site = uiTextSiteOf(element.type);
    if (!site) {
        return "";
    }
    const reading = readUITextSite(element, site);
    const words = (reading.text.trim() || reading.key).replace(/\s+/g, " ");
    return words.length > WORDS_MAX_LENGTH ? `${words.slice(0, WORDS_MAX_LENGTH - 1)}…` : words;
}

/**
 * The elements a navigation setting may name - where a direction goes, where a page's focus starts -
 * as a select offers them, in outline order under `rootId`.
 *
 * Only what the focus can rest on: naming a text or a picture sends the focus nowhere. An element taken
 * out of navigation takes its contents with it, as it does in the game.
 *
 * Named as the outline names them. Two that would read the same (a row of buttons all called "Button")
 * are told apart by the words each shows, and numbered in outline order where those match too. Never by
 * id: an id is not something an author can recognise.
 *
 * `current` is the element the setting names now. It is offered even when the rules above would leave
 * it out, so a choice made before them still reads as itself rather than as the first entry.
 */
export function navigationTargetOptions(input: {
    document: UIDocument;
    rootId: string;
    t: TranslateFn;
    /** Never offered: the element being edited and the groups that hold it. */
    exclude?: ReadonlySet<string>;
    current?: string;
}): SelectOption[] {
    const { document, rootId, t, exclude, current } = input;
    const targets: UIElement[] = [];
    const seen = new Set<string>();
    const visit = (elementId: string, depth: number, outOfNavigation: boolean) => {
        const element = document.elements[elementId];
        if (!element || seen.has(elementId)) {
            return;
        }
        seen.add(elementId);
        const out = outOfNavigation || readUIElementFocusability(element) === "never";
        const offered = element.id === current || (!out && canHoldFocus(element));
        if (depth > 0 && offered && !exclude?.has(element.id)) {
            targets.push(element);
        }
        for (const childId of element.childrenIds) {
            visit(childId, depth + 1, out);
        }
    };
    visit(rootId, 0, false);

    const options: SelectOption[] = targets.map(element => ({ value: element.id, label: elementName(element) }));
    const countBy = (key: (option: SelectOption) => string) => {
        const counts = new Map<string, number>();
        for (const option of options) {
            counts.set(key(option), (counts.get(key(option)) ?? 0) + 1);
        }
        return counts;
    };
    const byLabel = countBy(option => option.label);
    targets.forEach((element, index) => {
        if ((byLabel.get(options[index].label) ?? 0) > 1) {
            const words = elementWords(element);
            if (words && words !== options[index].label) {
                options[index].secondaryLabel = words;
            }
        }
    });
    const readsAs = (option: SelectOption) => `${option.label}\u0000${option.secondaryLabel ?? ""}`;
    const byReading = countBy(readsAs);
    const numbered = new Map<string, number>();
    for (const option of options) {
        const reading = readsAs(option);
        if ((byReading.get(reading) ?? 0) > 1) {
            const index = (numbered.get(reading) ?? 0) + 1;
            numbered.set(reading, index);
            option.label = t("properties.navigation.numbered", { name: option.label, index: String(index) });
        }
    }
    return options;
}
