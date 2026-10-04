/**
 * Where a site's words come from, and what they resolve to - the one implementation every reader of
 * interface text goes through (the table itself is `textSites.ts`).
 *
 * The order is the game's: a translation key wins over everything the element carries, and otherwise
 * the element's own unit translates its own words. A site has one source of words and stores only
 * that one: a keyed element holds no words of its own, and an element's own words are translated
 * whenever the project has a second language - nothing opts them in (see `textSourceMigration.ts`
 * for the v13 step that removed the switch that used to).
 *
 * Pure: no service, no React. The game's hook (`useLocalizedWidgetText`) and the canvas hand it the
 * locale and the registry they hold; lint, the localization panel and the CLIs read the stored half.
 *
 * Comments in English per project convention.
 */

import { localizationKeyUnitId, resolveLocalizedUnitText, type GameLocalizationBundle } from "../localization";
import type { UIElement, UIElementValueBinding } from "./document";
import { UI_TEXT_SITES, type UITextSite } from "./textSites";
import { resolveByWidgetType } from "./widgetInheritance";

export type { UITextSite, UITextSiteRole, UITextSiteValueBinding } from "./textSites";
export { UI_TEXT_SITES } from "./textSites";

const SITE_BY_TYPE: Readonly<Record<string, UITextSite>> = Object.fromEntries(
    UI_TEXT_SITES.map(site => [site.widgetType, site]),
);

/**
 * The text site of a widget type, read through widget inheritance: a specialisation with an entry
 * of its own reads that one, and one without reads its parent's. Undefined for a widget that shows
 * no authored words.
 */
export function uiTextSiteOf(type: string | null | undefined): UITextSite | undefined {
    return resolveByWidgetType(SITE_BY_TYPE, type);
}

/** The site a widget declares for itself, for a module that knows its own type. Throws for none. */
export function requireUITextSite(type: string): UITextSite {
    const site = SITE_BY_TYPE[type];
    if (!site) {
        throw new Error(`No interface text site is declared for ${type}`);
    }
    return site;
}

/** The translation unit that carries an element's own words: `ui:<elementId>.<prop>`. */
export function uiTextUnitId(elementId: string, prop: string): string {
    return `ui:${elementId}.${prop}`;
}

/** What an element stores on a site, read without any widget's normalisation. */
export type UITextSiteReading = {
    /** The element's own words ("" when absent). */
    text: string;
    /** The translation key it names, trimmed ("" when none, or the site takes none). */
    key: string;
    /** The value binding on the words' prop, when there is one. */
    binding: UIElementValueBinding | undefined;
};

export function readUITextSite(element: UIElement, site: UITextSite): UITextSiteReading {
    const props = (element.props ?? {}) as Record<string, unknown>;
    const text = props[site.textProp];
    const key = site.keyProp ? props[site.keyProp] : undefined;
    return {
        text: typeof text === "string" ? text : "",
        key: typeof key === "string" ? key.trim() : "",
        binding: element.valueBindings?.[site.textProp],
    };
}

/**
 * Where an element's words come from, as its inspector offers the choice.
 *
 * - `literal`: the element's own words, translated through its own unit.
 * - `key`: a named translation key; the game shows the key's text and never the element's own.
 * - `blueprint`: a value blueprint writes the words.
 */
export type UITextSource = "literal" | "key" | "blueprint";

/**
 * The source a stored element's words are read from - derived, not stored.
 *
 * In the order the game resolves them: a key wins over everything, so an element that also carries
 * words of its own or a value blueprint is a keyed one. `keysApply` is false while the project has
 * no source language: a build then carries no keys, and the game shows the element's own words.
 *
 * Null for an element whose words are bound to a field of its list row (and to no key), which is
 * answered by the row and offers none of the three.
 */
export function uiTextSourceOf(element: UIElement, site: UITextSite, keysApply: boolean): UITextSource | null {
    const reading = readUITextSite(element, site);
    if (keysApply && reading.key) {
        return "key";
    }
    if (reading.binding?.kind === "listItemField") {
        return null;
    }
    if (reading.binding?.kind === "blueprintValue") {
        return "blueprint";
    }
    return "literal";
}

/**
 * Whether words are prose at all: one letter, in any script.
 *
 * Words without one - "", "1,250", "100%", "12:30", "→" - read the same in every language. They are
 * not offered for translation and nothing reports them untranslated; a translation they already carry
 * is still read.
 */
export function uiTextHasWords(text: string): boolean {
    return /\p{L}/u.test(text);
}

/**
 * The translation unit an element's words are read through at run time, when they have one.
 *
 * `key` is a named key (`key:<name>`), whose source words live in the key registry rather than on
 * the element; `implicit` is the element's own unit (`ui:<elementId>.<prop>`), whose source words are
 * the ones the author typed. Every element's own words have one, unless they have no letter in them
 * (`uiTextHasWords`). Whether the words are sample text - which have no unit either - is the
 * caller's question to ask, of `uiTextSampleCauseOf`, because it needs the blueprint document.
 */
export type UITextUnitBinding =
    | { kind: "key"; keyName: string }
    | { kind: "implicit"; unitId: string; sourceText: string };

export function uiTextUnitBindingOf(element: UIElement, site: UITextSite): UITextUnitBinding | null {
    const reading = readUITextSite(element, site);
    if (reading.key) {
        return { kind: "key", keyName: reading.key };
    }
    if (site.role === "words" && uiTextHasWords(reading.text)) {
        return { kind: "implicit", unitId: uiTextUnitId(element.id, site.textProp), sourceText: reading.text };
    }
    return null;
}

/**
 * Where the words a running game hands a widget came from, when they are not the element's own.
 *
 * - `written`: a runtime write - `Set Text`, `Set Label`, `Append Text`, `Clear Text`, a script's
 *   write. Shown as written, in every language, ahead of a translation key, a translation and a value
 *   binding, until the page is drawn afresh.
 * - `bound`: a value binding or a list row's field. Shown as the binding gives them; a key still wins,
 *   and the element's own unit, which translates the element's own words, is not read.
 *
 * Written onto the element a drawing hands its widget (`withUITextRuntimeWords`) and never stored: the
 * document holds the element's own words, and only the drawing knows what replaced them.
 */
export type UITextRuntimeOrigin = "written" | "bound";

/** The prop a drawing carries its words' origin in. Set by the drawing only; see {@link UITextRuntimeOrigin}. */
export const UI_TEXT_RUNTIME_ORIGIN_PROP = "runtimeTextOrigin";

/** The origin of the words a drawing hands a widget, or undefined for the element's own words. */
export function uiTextRuntimeOriginOf(element: Pick<UIElement, "props">): UITextRuntimeOrigin | undefined {
    const origin = (element.props as Record<string, unknown> | undefined)?.[UI_TEXT_RUNTIME_ORIGIN_PROP];
    return origin === "written" || origin === "bound" ? origin : undefined;
}

/** The element as a drawing hands it to its widget: `words` on its site, and where they came from. */
export function withUITextRuntimeWords(
    element: UIElement,
    site: UITextSite,
    words: unknown,
    origin: UITextRuntimeOrigin,
): UIElement {
    return {
        ...element,
        props: {
            ...(element.props ?? {}),
            [site.textProp]: words,
            [UI_TEXT_RUNTIME_ORIGIN_PROP]: origin,
        },
    };
}

/** The words a site shows, as the renderer has them in hand. */
export type UITextWordsInput = {
    site: UITextSite;
    elementId: string;
    /** The words the element was handed - its own, or what a binding or a runtime write put there. */
    sourceText: string;
    localizationKey?: string;
    /** Where `sourceText` came from when it is not the element's own words (`uiTextRuntimeOriginOf`). */
    origin?: UITextRuntimeOrigin;
};

/**
 * Where the words are being drawn.
 *
 * - `game`: a game with a localization payload, in the player's language.
 * - `canvas`: anywhere without one - the editor canvas, a preview - holding the key registry the
 *   editor published, or null when it published none (the project ships no keys).
 */
export type UITextWordsHost =
    | { kind: "game"; bundle: GameLocalizationBundle; locale: string }
    | { kind: "canvas"; keys: Readonly<Record<string, string>> | null };

/**
 * The words a site shows.
 *
 * Words written at run time are shown as written, everywhere. Otherwise, in a game: the key's
 * translation, then the key's source text, then the words handed in; without a key, words a binding
 * gave as they are, and the element's own words through its own unit, then as written. On the canvas:
 * a site that draws its key shows the key's source text, and every other case shows the words handed
 * in. A key the registry does not hold falls back to the words handed in, in both.
 */
export function resolveUITextWords(input: UITextWordsInput, host: UITextWordsHost): string {
    if (input.origin === "written") {
        return input.sourceText;
    }
    const keyName = input.localizationKey?.trim();
    if (host.kind === "canvas") {
        return keyName && input.site.canvasDrawsKey
            ? host.keys?.[keyName] ?? input.sourceText
            : input.sourceText;
    }
    if (keyName) {
        return resolveLocalizedUnitText(host.bundle, host.locale, localizationKeyUnitId(keyName))
            ?? host.bundle.keys?.[keyName]
            ?? input.sourceText;
    }
    if (input.origin === "bound") {
        return input.sourceText;
    }
    return resolveLocalizedUnitText(host.bundle, host.locale, uiTextUnitId(input.elementId, input.site.textProp))
        ?? input.sourceText;
}
