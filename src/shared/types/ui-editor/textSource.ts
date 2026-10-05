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

import { resolveLocalizationKeyWords, resolveLocalizedUnitText, type GameLocalizationBundle } from "../localization";
import type { PluginWidgetTextContribution } from "../plugins";
import { getContributedWidget } from "./contributedWidgets";
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

/**
 * Every text site of a widget type: Studio's own widget's one site (`uiTextSiteOf`), or the ones a
 * loaded plugin's widget declares in its manifest (`uiTextSitesFromPluginDeclaration`). Empty for a
 * widget that shows no authored words, and for a plugin widget whose plugin is not loaded.
 *
 * What every reader that walks an element's words asks - the translation table and its exports, the
 * interface lint, the glyph check, the key-use list, removing a key and settling a paste. The
 * questions only Studio's own widgets have an answer to (whether a double-click types in place,
 * whether a value binding writes the words, which blueprint nodes write them) go on asking
 * `uiTextSiteOf`: a plugin site answers no to each of them.
 */
export function uiTextSitesOf(type: string | null | undefined): readonly UITextSite[] {
    const own = uiTextSiteOf(type);
    if (own) {
        return [own];
    }
    return getContributedWidget(type)?.textSites ?? [];
}

/**
 * The text sites a plugin's widget declares, from its manifest's `contributes.widgetText` entries.
 *
 * Each is a site a player reads, whose key the canvas draws as it draws a text's, that nothing types
 * on the canvas (only Studio's own renderers do that) and that no value binding writes (the plugin
 * hands its renderer the words, and a binding has nowhere to reach them). The key prop is the one the
 * manifest validator settled (`<prop>LocalizationKey` unless declared).
 */
export function uiTextSitesFromPluginDeclaration(
    widgetType: string,
    entries: readonly PluginWidgetTextContribution[] | undefined,
): UITextSite[] {
    return (entries ?? []).map(entry => ({
        widgetType,
        textProp: entry.prop,
        role: "words",
        keyProp: entry.keyProp ?? `${entry.prop}LocalizationKey`,
        canvasDrawsKey: true,
        typedOnCanvas: false,
        valueBinding: "none",
        ...(entry.label ? { label: entry.label } : {}),
        ...(entry.localized ? { localizedLabel: entry.localized } : {}),
        ...(entry.multiline ? { multiline: true } : {}),
    }));
}

/**
 * What a site's words are called, in an editor locale: a plugin site's declared label (exact locale
 * first, as plugin names are matched), else its prop. Studio's own widgets name their one site
 * themselves, so this is for the places that name a plugin's words beside its widget.
 */
export function uiTextSiteLabel(site: UITextSite, locale: string): string {
    return site.localizedLabel?.[locale] ?? site.label ?? site.textProp;
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
 * words of its own or a value blueprint is a keyed one - whether or not the project has a source
 * language, because a key is shared words before it is a translation.
 *
 * Null for an element whose words are bound to a field of its list row or to a text parameter of its
 * component (and to no key): the row, or the placement, answers them, and none of the three is
 * offered.
 */
export function uiTextSourceOf(element: UIElement, site: UITextSite): UITextSource | null {
    const reading = readUITextSite(element, site);
    if (reading.key) {
        return "key";
    }
    if (reading.binding?.kind === "listItemField" || reading.binding?.kind === "componentParam") {
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
 * - `bound`: a value binding, a list row's field or a component's text parameter. Shown as the binding
 *   gives them; a key still wins, and the element's own unit, which translates the element's own words,
 *   is not read. A binding whose words have a unit of their own - a text parameter's value, translated
 *   through the placement's unit - hands that unit along (`uiTextRuntimeUnitOf`).
 *
 * Written onto the element a drawing hands its widget (`withUITextRuntimeWords`) and never stored: the
 * document holds the element's own words, and only the drawing knows what replaced them.
 */
export type UITextRuntimeOrigin = "written" | "bound";

/** The prop a drawing carries its words' origin in. Set by the drawing only; see {@link UITextRuntimeOrigin}. */
export const UI_TEXT_RUNTIME_ORIGIN_PROP = "runtimeTextOrigin";

/**
 * The prop a drawing carries the unit bound words are translated through, when the binding has one.
 * Set by the drawing only, beside {@link UI_TEXT_RUNTIME_ORIGIN_PROP}.
 */
export const UI_TEXT_RUNTIME_UNIT_PROP = "runtimeTextUnit";

/** The origin of the words a drawing hands a widget, or undefined for the element's own words. */
export function uiTextRuntimeOriginOf(element: Pick<UIElement, "props">): UITextRuntimeOrigin | undefined {
    const origin = (element.props as Record<string, unknown> | undefined)?.[UI_TEXT_RUNTIME_ORIGIN_PROP];
    return origin === "written" || origin === "bound" ? origin : undefined;
}

/** The unit the bound words a drawing hands a widget are translated through, or undefined for none. */
export function uiTextRuntimeUnitOf(element: Pick<UIElement, "props">): string | undefined {
    const unitId = (element.props as Record<string, unknown> | undefined)?.[UI_TEXT_RUNTIME_UNIT_PROP];
    return typeof unitId === "string" && unitId ? unitId : undefined;
}

/**
 * The element as a drawing hands it to its widget: `words` on its site, where they came from, and the
 * unit they are translated through when they have one of their own.
 */
export function withUITextRuntimeWords(
    element: UIElement,
    site: UITextSite,
    words: unknown,
    origin: UITextRuntimeOrigin,
    unitId?: string,
): UIElement {
    const props: Record<string, unknown> = {
        ...(element.props ?? {}),
        [site.textProp]: words,
        [UI_TEXT_RUNTIME_ORIGIN_PROP]: origin,
    };
    if (unitId) {
        props[UI_TEXT_RUNTIME_UNIT_PROP] = unitId;
    } else {
        delete props[UI_TEXT_RUNTIME_UNIT_PROP];
    }
    return { ...element, props };
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
    /** The unit bound words are translated through, when the binding gave one (`uiTextRuntimeUnitOf`). */
    unitId?: string;
};

/**
 * Where the words are being drawn.
 *
 * - `game`: a game, in the player's language. Every game has a localization payload; a project
 *   without a source language ships one that holds only its keys (`keysOnlyLocalization`).
 * - `canvas`: anywhere without one - the editor canvas, a preview - holding the key registry the
 *   editor published, or null when it has published none yet.
 */
export type UITextWordsHost =
    | { kind: "game"; bundle: GameLocalizationBundle; locale: string }
    | { kind: "canvas"; keys: Readonly<Record<string, string>> | null };

/**
 * The element with the words each of `sites` shows written into the site's prop - what a plugin's
 * widget is handed to draw, so it shows a key's words, or its own words translated, without resolving
 * anything itself. The same element (by reference) when no site's words change.
 *
 * A plugin site carries no runtime origin: no blueprint node writes into a plugin's widget, and no
 * value binding reaches it.
 */
export function withUITextSitesResolved(
    element: UIElement,
    sites: readonly UITextSite[],
    host: UITextWordsHost,
): UIElement {
    let props: Record<string, unknown> | null = null;
    for (const site of sites) {
        const reading = readUITextSite(element, site);
        const words = resolveUITextWords({
            site,
            elementId: element.id,
            sourceText: reading.text,
            ...(reading.key ? { localizationKey: reading.key } : {}),
        }, host);
        if (words !== (element.props as Record<string, unknown> | undefined)?.[site.textProp]) {
            props ??= { ...(element.props ?? {}) };
            props[site.textProp] = words;
        }
    }
    return props ? { ...element, props } : element;
}

/**
 * The words a site shows.
 *
 * Words written at run time are shown as written, everywhere. Otherwise, in a game: the key's
 * translation, then the key's source text, then the words handed in; without a key, words a binding
 * gave as they are - or through the unit the binding gave with them, a component text parameter's
 * placement - and the element's own words through its own unit, then as written. On the canvas:
 * a site that draws its key shows the key's source text, and every other case shows the words handed
 * in. A key the registry does not hold shows its name, in both (`resolveLocalizationKeyWords`), as the
 * blueprint readers of a key do; before a canvas has a registry it shows the words handed in.
 */
export function resolveUITextWords(input: UITextWordsInput, host: UITextWordsHost): string {
    if (input.origin === "written") {
        return input.sourceText;
    }
    const keyName = input.localizationKey?.trim();
    if (host.kind === "canvas") {
        if (!keyName || !input.site.canvasDrawsKey || !host.keys) {
            return input.sourceText;
        }
        return Object.prototype.hasOwnProperty.call(host.keys, keyName) ? host.keys[keyName] : keyName;
    }
    if (keyName) {
        return resolveLocalizationKeyWords(host.bundle, host.locale, keyName);
    }
    if (input.origin === "bound") {
        return input.unitId
            ? resolveLocalizedUnitText(host.bundle, host.locale, input.unitId) ?? input.sourceText
            : input.sourceText;
    }
    return resolveLocalizedUnitText(host.bundle, host.locale, uiTextUnitId(input.elementId, input.site.textProp))
        ?? input.sourceText;
}
