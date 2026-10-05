/**
 * Every place on an interface where an author writes words a player reads, and the rules for where
 * those words come from.
 *
 * One table, because the same question - which prop of which widget is player-facing text, which
 * prop names its translation key, whether the element's own words can be translated - is asked by
 * the game's resolver, the canvas, the inspector, three lint rule families, the localization panel
 * and its exports, the value-binding runtime, the canvas double-click, the interface CLI, the page a
 * template hands a project and the skeleton template's language generator. Each of those used to
 * carry its own copy, and copies that drifted are how a word came to read one way on the canvas and
 * another in the game. Read a site through `textSource.ts` (`uiTextSiteOf`), which resolves a
 * specialisation through widget inheritance; `textSites.consistency.test.ts` fails when any reader
 * knows a site this table does not.
 *
 * **A plugin's widget is not in this table and cannot be**: it is registered at run time. Its sites are
 * the ones its manifest declares (`contributes.widgetText`), built by `uiTextSitesFromPluginDeclaration`
 * in `textSource.ts` and answered behind this table through the contributed-widget lookups
 * (`contributedWidgets.ts`), so every reader that asks `uiTextSitesOf` treats a plugin's words as it
 * treats a text's or a button's. A widget type here can have only one site; a plugin's can have several.
 *
 * **No imports, on purpose.** `scripts/gen-skeleton-locale.mjs` is plain Node and loads this file by
 * transforming it on the fly; anything it imported would have to be resolvable from there too.
 *
 * Comments in English per project convention.
 */

/**
 * What the words on a site are.
 *
 * - `words`: what a player reads. Either the element's own, which are translated through the
 *   element's own unit (`ui:<elementId>.<textProp>`) whenever the project has a second language, or
 *   a translation key's.
 * - `sample`: stand-in words the canvas shows where the game draws something else in their place -
 *   the story's current line, in the dialogue slot and the NVL slot (`storySlot`).
 */
export type UITextSiteRole = "words" | "sample";

/**
 * Whether a value binding - a list row's field, a value blueprint - writes a site's words.
 *
 * - `offered`: the inspector and `ui.js` offer to bind them, and the runtime resolves the binding.
 * - `carried`: the runtime resolves a binding the element already carries, and nothing offers to make
 *   one.
 * - `none`: nothing resolves a binding here.
 */
export type UITextSiteValueBinding = "offered" | "carried" | "none";

export type UITextSite = {
    /** The widget type, exactly. A specialisation without an entry of its own reads its parent's. */
    readonly widgetType: string;
    /**
     * The prop that holds the words: `text`, `label` or `placeholder` on Studio's own widgets, any
     * prop a plugin's widget declares on its own.
     */
    readonly textProp: string;
    readonly role: UITextSiteRole;
    /**
     * The prop naming a translation key the words are read from instead of the element's own. The
     * game reads the key before anything else the element carries (`resolveUITextWords`).
     */
    readonly keyProp?: string;
    /** The marked runs (ruby, emphasis, ...) kept beside the words, when the site keeps them. */
    readonly marksProp?: "rich";
    /** Whether the canvas draws a keyed element's key text, as the game does in the source language. */
    readonly canvasDrawsKey: boolean;
    /** Whether a double-click on the canvas types the words in place. */
    readonly typedOnCanvas: boolean;
    readonly valueBinding: UITextSiteValueBinding;
    /** For a `sample` site: the stage slot whose game draws the story's words in place of these. */
    readonly storySlot?: "dialog" | "nvl";
    /**
     * For a site a plugin's widget declares: what the properties panel calls the words, and the
     * same per editor locale. Studio's own widgets have one site each, named by the widget.
     */
    readonly label?: string;
    readonly localizedLabel?: Readonly<Record<string, string>>;
    /** For a site a plugin's widget declares: whether the words may run over several lines. */
    readonly multiline?: boolean;
};

export const UI_TEXT_SITES: readonly UITextSite[] = [
    {
        widgetType: "nl.text",
        textProp: "text",
        role: "words",
        keyProp: "localizationKey",
        marksProp: "rich",
        canvasDrawsKey: true,
        typedOnCanvas: true,
        valueBinding: "offered",
    },
    {
        widgetType: "nl.button",
        textProp: "label",
        role: "words",
        keyProp: "localizationKey",
        marksProp: "rich",
        canvasDrawsKey: true,
        typedOnCanvas: true,
        valueBinding: "offered",
    },
    {
        widgetType: "nl.textInput",
        textProp: "placeholder",
        role: "words",
        keyProp: "placeholderLocalizationKey",
        canvasDrawsKey: true,
        typedOnCanvas: false,
        valueBinding: "none",
    },
    {
        widgetType: "nl.dialog.sentence",
        textProp: "text",
        role: "sample",
        marksProp: "rich",
        canvasDrawsKey: false,
        typedOnCanvas: false,
        valueBinding: "carried",
        storySlot: "dialog",
    },
    {
        widgetType: "nl.nvl.texts",
        textProp: "text",
        role: "sample",
        marksProp: "rich",
        canvasDrawsKey: false,
        typedOnCanvas: false,
        valueBinding: "carried",
        storySlot: "nvl",
    },
];
