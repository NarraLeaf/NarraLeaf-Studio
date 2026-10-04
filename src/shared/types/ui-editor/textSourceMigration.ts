/**
 * The v13 step of the interface document: every text site keeps one source of words, stored once.
 *
 * Up to v12 an element could hold its own words, a translation key, a switch that translated its own
 * words through its own unit, and a value binding all at once, and which of them a player read was
 * decided by an order of precedence written down nowhere the author could see. From v13 a site has
 * one source and stores only that one: a keyed element holds the key's name and no words of its own,
 * an element's own words are translated whenever the project has a second language (no switch), and
 * a value binding beside a key is gone.
 *
 * **The constraint this step is held to: every site shows the same words in every language as it did
 * before.** Where the old shape could not be expressed in the new one without changing what is shown
 * - marks drawn over a key's words, a key the registry no longer has, a key whose words differed from
 * the element's own in a project whose game never read keys - the element is turned into one that
 * holds its own words (and the translations it was showing are copied into its own unit), and the
 * change is reported so the author can be told. Everything else is convergence nobody can see and is
 * not reported.
 *
 * Pure: the document, the key registry, the source language and the translation files go in; the new
 * document, the edits the translation files need, and the list of visible changes come out. Three
 * callers run it, because the interface document is read from disk in more places than the editor:
 * `UIDocumentService.load()` writes the result, a package assembled from a project nobody has opened
 * since applies it in memory (`bundleAssembler`), and `ui.js` reads through it. The skeleton template
 * is written through it as well (`scripts/gen-skeleton-locale.mjs`).
 *
 * Runs on a document older than v13 only. It is not idempotent and cannot be: in a v13 document an
 * element's own words are translated without a switch, so the step that removes the leftover
 * translation of an element that had none would remove a translation the author made.
 *
 * Comments in English per project convention.
 */

import type { LocalizationUnit } from "../localization";
import { localizationKeyUnitId } from "../localization";
import { getUIComponentLink, type UIDocument, type UIElement } from "./document";
import { findUIElementSurfaceId } from "./frame";
import { normalizeUITextRuns, resolveUITextRuns } from "./textRuns";
import { readUITextSite, uiTextSiteOf, uiTextUnitId, type UITextSite } from "./textSource";

/** The interface document version this step produces. */
export const UI_TEXT_SOURCES_SCHEMA_VERSION = 13;

/**
 * The switch that, before v13, translated an element's own words through its own unit. Nothing reads
 * it any more; it is named here so the step that removes it, and the tools that meet it in an older
 * file, spell it once.
 */
export const LEGACY_UI_TEXT_UNIT_PROP = "localizable";

/** What the step needs besides the document. */
export type UITextMigrationInput = {
    /** The project's named keys: name to source-language words (`editor/localization/keys.json`). */
    keys: Readonly<Record<string, string>>;
    /** The project's source language, or "" when it has none - and so, before v13, read no keys. */
    sourceLocale: string;
    /**
     * Every translation file but the source language's, as the language's units. Only these languages
     * receive edits.
     */
    translations: Readonly<Record<string, Readonly<Record<string, LocalizationUnit>>>>;
};

/** What one language's translation file needs after the step. */
export type UITextLocaleEdit = {
    /** Units to write, replacing what is there. */
    set: Record<string, LocalizationUnit>;
    /** Units to remove. */
    remove: string[];
};

/**
 * A change the author can see, and so is told about.
 *
 * - `marksKept`: the element's marks were drawn over its key's words, which a key cannot carry. It
 *   holds the words and the marks itself now, with the key's translations, and no longer shares the
 *   key.
 * - `bindingDropped`: the element named a key and was bound as well. The key always won, so the
 *   binding never showed; it is removed.
 * - `missingKey`: the key the element named is not in the project. The element holds the words it
 *   showed, with the translations that were still being read for the key.
 * - `keyDiffered`: the project has no source language, so its game showed the element's own words
 *   rather than the key's, and they differ. The element keeps its own words.
 */
export type UITextMigrationChangeKind = "marksKept" | "bindingDropped" | "missingKey" | "keyDiffered";

export type UITextMigrationChange = {
    kind: UITextMigrationChangeKind;
    elementId: string;
    /** The prop the words are in (`text`, `label`, `placeholder`). */
    prop: string;
    /** The key the element named. */
    keyName: string;
    /** Where the element is: a page, or a component definition. Absent for an element on neither. */
    surfaceId?: string;
    componentId?: string;
};

export type UITextMigrationResult = {
    /** The document at v13. The input when nothing had to change apart from the version. */
    document: UIDocument;
    /** Edits per language, only for languages that need any. */
    localeEdits: Record<string, UITextLocaleEdit>;
    /** The changes an author can see, in document order. */
    changes: UITextMigrationChange[];
};

/** Collects the language-file edits of one run. */
class LocaleEdits {
    readonly byLocale: Record<string, UITextLocaleEdit> = {};

    constructor(private readonly translations: UITextMigrationInput["translations"]) {}

    private edit(locale: string): UITextLocaleEdit {
        let edit = this.byLocale[locale];
        if (!edit) {
            edit = { set: {}, remove: [] };
            this.byLocale[locale] = edit;
        }
        return edit;
    }

    /** Take out a unit wherever a language holds one. */
    removeEverywhere(unitId: string): void {
        for (const [locale, units] of Object.entries(this.translations)) {
            if (units[unitId] && !this.edit(locale).remove.includes(unitId)) {
                this.edit(locale).remove.push(unitId);
            }
        }
    }

    /**
     * Make `toUnitId` say in every language what `fromUnitId` says, and nothing where it says nothing.
     *
     * Copied whole, `sourceHash` included: the words the new unit translates are the words the old one
     * was translated against, so a translation that was current stays current and one that was stale
     * stays stale. A language without the old unit loses any unit the element had, because that one
     * was never read and would be from now on.
     */
    copyEverywhere(fromUnitId: string, toUnitId: string): void {
        for (const [locale, units] of Object.entries(this.translations)) {
            const from = units[fromUnitId];
            if (from?.target) {
                this.edit(locale).set[toUnitId] = { ...from };
            } else if (units[toUnitId]) {
                this.edit(locale).remove.push(toUnitId);
            }
        }
    }

    /** Only the languages with something to do. */
    collect(): Record<string, UITextLocaleEdit> {
        const out: Record<string, UITextLocaleEdit> = {};
        for (const [locale, edit] of Object.entries(this.byLocale)) {
            if (Object.keys(edit.set).length > 0 || edit.remove.length > 0) {
                out[locale] = edit;
            }
        }
        return out;
    }
}

/** An element's props with some keys taken out. */
function withoutProps(element: UIElement, keys: readonly (string | undefined)[]): UIElement {
    const props = { ...(element.props ?? {}) } as Record<string, unknown>;
    for (const key of keys) {
        if (key) {
            delete props[key];
        }
    }
    return { ...element, props };
}

/** An element without the value binding on one prop. */
function withoutBinding(element: UIElement, prop: string): UIElement {
    if (!element.valueBindings?.[prop]) {
        return element;
    }
    const valueBindings = { ...element.valueBindings };
    delete valueBindings[prop];
    const next: UIElement = { ...element, valueBindings };
    if (Object.keys(valueBindings).length === 0) {
        delete next.valueBindings;
    }
    return next;
}

/**
 * The element's site turned into one that holds `words` itself: the key and the old switch go, and
 * the marks stay only while they still spell the words. The prop holding the words is written even
 * when it is empty, because a widget reads a missing one as its default words.
 */
export function uiTextSiteWithOwnWords(element: UIElement, site: UITextSite, words: string): UIElement {
    const next = withoutProps(element, [site.keyProp, LEGACY_UI_TEXT_UNIT_PROP]);
    const props = next.props as Record<string, unknown>;
    props[site.textProp] = words;
    if (site.marksProp && props[site.marksProp] !== undefined
        && !resolveUITextRuns(words, normalizeUITextRuns(props[site.marksProp]))) {
        delete props[site.marksProp];
    }
    return next;
}

/** Whether marks are drawn over these words - the condition every renderer draws them on. */
function marksSpell(element: UIElement, site: UITextSite, words: string): boolean {
    if (!site.marksProp) {
        return false;
    }
    const raw = (element.props as Record<string, unknown> | undefined)?.[site.marksProp];
    return resolveUITextRuns(words, normalizeUITextRuns(raw)) !== null;
}

/** Whether a sample site sits on the page whose game draws the story's words in its place. */
function isInStorySlot(document: UIDocument, element: UIElement, site: UITextSite): boolean {
    if (!site.storySlot) {
        return false;
    }
    const surfaceId = findUIElementSurfaceId(document, element.id);
    const surface = surfaceId ? document.surfaces.find(candidate => candidate.id === surfaceId) : undefined;
    return surface?.kind === "stageSurface" && surface.mount.slotId === site.storySlot;
}

/** A component instance's copy of its definition's props in the v13 shape: no switch, no words under a key. */
function settleInstanceCopy(element: UIElement, site: UITextSite): UIElement {
    const props = (element.props ?? {}) as Record<string, unknown>;
    const keyed = site.role === "words" && Boolean(readUITextSite(element, site).key);
    const drop = [
        LEGACY_UI_TEXT_UNIT_PROP,
        ...(keyed ? [site.textProp, site.marksProp] : []),
    ].filter((prop): prop is string => Boolean(prop) && props[prop as string] !== undefined);
    return drop.length > 0 ? withoutProps(element, drop) : element;
}

type ElementOutcome = {
    element: UIElement;
    changes: UITextMigrationChangeKind[];
    keyName: string;
};

/** One element through the rules. `inStorySlot` is asked only of a sample site. */
function migrateElement(
    element: UIElement,
    site: UITextSite,
    input: UITextMigrationInput,
    edits: LocaleEdits,
    inStorySlot: () => boolean,
): ElementOutcome {
    const reading = readUITextSite(element, site);
    const props = (element.props ?? {}) as Record<string, unknown>;
    const ownWords = typeof props[site.textProp] === "string" ? props[site.textProp] as string : "";
    const wasTranslated = props[LEGACY_UI_TEXT_UNIT_PROP] === true;
    const unitId = uiTextUnitId(element.id, site.textProp);
    const changes: UITextMigrationChangeKind[] = [];
    let next = element;

    if (site.role === "sample") {
        // A dialogue or NVL line's words are drawn by the story in its slot, and neither its own words
        // nor a binding reach a player there; the inspector already says so of a binding. Elsewhere a
        // binding does draw the line's words, and stays.
        if (reading.binding && inStorySlot()) {
            next = withoutBinding(next, site.textProp);
        }
        if (props[LEGACY_UI_TEXT_UNIT_PROP] !== undefined) {
            next = withoutProps(next, [LEGACY_UI_TEXT_UNIT_PROP]);
        }
        if (!wasTranslated) {
            edits.removeEverywhere(unitId);
        }
        return { element: next, changes, keyName: "" };
    }

    const keyName = reading.key;
    if (!keyName) {
        // Words of the element's own. The switch goes: from v13 they are translated without it. A
        // leftover translation of words that had no switch was never read, and would be from now on.
        if (props[LEGACY_UI_TEXT_UNIT_PROP] !== undefined) {
            next = withoutProps(next, [LEGACY_UI_TEXT_UNIT_PROP]);
        }
        if (!wasTranslated) {
            edits.removeEverywhere(unitId);
        }
        return { element: next, changes, keyName };
    }

    const registered = Object.prototype.hasOwnProperty.call(input.keys, keyName);
    const keyWords = registered ? input.keys[keyName] : "";
    const keysWereRead = Boolean(input.sourceLocale);

    if (!registered) {
        // The game showed the element's own words in the source language - or what a binding put in
        // their place - and, in another language, the key's translation where the language file still
        // held one. Those translations become the element's own; a binding keeps showing.
        next = uiTextSiteWithOwnWords(next, site, ownWords);
        if (reading.binding) {
            edits.removeEverywhere(unitId);
        } else if (keysWereRead) {
            edits.copyEverywhere(localizationKeyUnitId(keyName), unitId);
        } else {
            edits.removeEverywhere(unitId);
        }
        changes.push("missingKey");
        return { element: next, changes, keyName };
    }

    if (!keysWereRead) {
        // A project with no source language shipped no keys, so its game showed the element's own
        // words - or what a binding put in their place - and drew their marks.
        if (reading.binding || ownWords !== keyWords || marksSpell(element, site, ownWords)) {
            next = uiTextSiteWithOwnWords(next, site, ownWords);
            edits.removeEverywhere(unitId);
            if (!reading.binding && ownWords !== keyWords) {
                changes.push("keyDiffered");
            }
            return { element: next, changes, keyName };
        }
        // Words equal to the key's: the key says the same thing from now on.
        next = withoutProps(next, [site.textProp, site.marksProp, LEGACY_UI_TEXT_UNIT_PROP]);
        if (!wasTranslated) {
            edits.removeEverywhere(unitId);
        }
        return { element: next, changes, keyName };
    }

    // The key was read, in every language, ahead of anything else the element held.
    if (reading.binding) {
        next = withoutBinding(next, site.textProp);
        changes.push("bindingDropped");
    }
    if (marksSpell(element, site, keyWords)) {
        // The source language drew the marks over the key's words. A key carries no marks, so the
        // element keeps the words and the marks, with the key's translations as its own.
        next = uiTextSiteWithOwnWords(next, site, keyWords);
        edits.copyEverywhere(localizationKeyUnitId(keyName), unitId);
        changes.push("marksKept");
        return { element: next, changes, keyName };
    }
    next = withoutProps(next, [site.textProp, site.marksProp, LEGACY_UI_TEXT_UNIT_PROP]);
    if (!wasTranslated) {
        edits.removeEverywhere(unitId);
    }
    return { element: next, changes, keyName };
}

/**
 * The v13 step. See the top of this file for what it holds to; the rules per site are in
 * `migrateElement`, and `textSourceMigration.test.ts` states each one as a case.
 *
 * Returns a document at v13 even when nothing else changed. A document already at v13 or later is
 * returned untouched with no edits.
 */
export function migrateUITextSourcesV13(document: UIDocument, input: UITextMigrationInput): UITextMigrationResult {
    if ((document.schemaVersion ?? 0) >= UI_TEXT_SOURCES_SCHEMA_VERSION) {
        return { document, localeEdits: {}, changes: [] };
    }
    const edits = new LocaleEdits(input.translations);
    const changes: UITextMigrationChange[] = [];

    const migrateTable = (
        table: Record<string, UIElement>,
        where: (element: UIElement) => Pick<UITextMigrationChange, "surfaceId" | "componentId">,
        inStorySlot: (element: UIElement, site: UITextSite) => boolean,
    ): Record<string, UIElement> => {
        let out = table;
        for (const [id, element] of Object.entries(table)) {
            const site = uiTextSiteOf(element.type);
            if (!site) {
                continue;
            }
            // A component instance is drawn from its definition, whose own elements are migrated
            // where they are kept; the props an instance carries are a copy nothing draws. They are
            // brought to the v13 shape all the same, quietly - no translation is read for them and
            // nothing an author sees changes.
            if (getUIComponentLink(element)) {
                const settled = settleInstanceCopy(element, site);
                if (settled !== element) {
                    if (out === table) {
                        out = { ...table };
                    }
                    out[id] = settled;
                }
                continue;
            }
            const outcome = migrateElement(element, site, input, edits, () => inStorySlot(element, site));
            if (outcome.element !== element) {
                if (out === table) {
                    out = { ...table };
                }
                out[id] = outcome.element;
            }
            for (const kind of outcome.changes) {
                changes.push({ kind, elementId: element.id, prop: site.textProp, keyName: outcome.keyName, ...where(element) });
            }
        }
        return out;
    };

    const elements = migrateTable(
        document.elements ?? {},
        element => {
            const surfaceId = findUIElementSurfaceId(document, element.id);
            return surfaceId ? { surfaceId } : {};
        },
        (element, site) => isInStorySlot(document, element, site),
    );
    let components = document.components;
    if (components) {
        const migrated = components.map(component => {
            const table = migrateTable(
                component.elements ?? {},
                () => ({ componentId: component.id }),
                // A definition is drawn wherever it is placed; a binding in it is kept.
                () => false,
            );
            return table === component.elements ? component : { ...component, elements: table };
        });
        if (migrated.some((component, index) => component !== components![index])) {
            components = migrated;
        }
    }

    return {
        document: {
            ...document,
            schemaVersion: UI_TEXT_SOURCES_SCHEMA_VERSION,
            elements,
            ...(components ? { components } : {}),
        },
        localeEdits: edits.collect(),
        changes,
    };
}

/**
 * The words of the named keys elements bring with them to another project - each key's source words,
 * and its translations by language - so a key the receiving project lacks can become the widgets'
 * own words rather than a name pointing at nothing.
 */
export type UITextCarriedKeys = Record<string, { words: string; translations?: Record<string, LocalizationUnit> }>;

/** Read a carried-keys record off something parsed, keeping only what has the right shape. */
export function readUITextCarriedKeys(value: unknown): UITextCarriedKeys | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
    }
    const out: UITextCarriedKeys = {};
    for (const [name, raw] of Object.entries(value as Record<string, unknown>)) {
        const entry = raw as { words?: unknown; translations?: unknown } | null;
        if (!entry || typeof entry !== "object" || typeof entry.words !== "string") {
            continue;
        }
        const translations: Record<string, LocalizationUnit> = {};
        if (entry.translations && typeof entry.translations === "object") {
            for (const [locale, unit] of Object.entries(entry.translations as Record<string, unknown>)) {
                const candidate = unit as Partial<LocalizationUnit> | null;
                if (candidate && typeof candidate.target === "string" && candidate.target) {
                    translations[locale] = {
                        target: candidate.target,
                        sourceHash: typeof candidate.sourceHash === "string" ? candidate.sourceHash : "",
                        status: candidate.status === "machine" || candidate.status === "reviewed" ? candidate.status : "translated",
                    };
                }
            }
        }
        out[name] = { words: entry.words, ...(Object.keys(translations).length > 0 ? { translations } : {}) };
    }
    return Object.keys(out).length > 0 ? out : undefined;
}

/** The keys a table of elements names on their text sites, and as instances' text parameter values. */
export function listUITextKeysNamed(table: Readonly<Record<string, UIElement>>): string[] {
    const names = new Set<string>();
    for (const element of Object.values(table)) {
        const site = uiTextSiteOf(element.type);
        const key = site?.keyProp ? readUITextSite(element, site).key : "";
        if (key) {
            names.add(key);
        }
        for (const paramKey of Object.values(getUIComponentLink(element)?.paramKeys ?? {})) {
            names.add(paramKey);
        }
    }
    return [...names];
}

/**
 * An instance whose text parameters name keys the project lacks, with each such value given as the
 * key's words directly - the words the elements brought, else the key's name. Null when none does.
 */
function settleInstanceParamKeys(
    element: UIElement,
    input: { hasKey: (name: string) => boolean; carried?: UITextCarriedKeys },
): { element: UIElement; converted: { paramId: string; keyName: string }[] } | null {
    const link = getUIComponentLink(element);
    const missing = Object.entries(link?.paramKeys ?? {}).filter(([, keyName]) => !input.hasKey(keyName));
    if (!link || missing.length === 0) {
        return null;
    }
    const params = { ...(link.params ?? {}) };
    const paramKeys = { ...(link.paramKeys ?? {}) };
    for (const [paramId, keyName] of missing) {
        params[paramId] = input.carried?.[keyName]?.words ?? keyName;
        delete paramKeys[paramId];
    }
    return {
        element: {
            ...element,
            extra: {
                ...(element.extra ?? {}),
                componentLink: {
                    componentId: link.componentId,
                    linked: true,
                    params,
                    ...(Object.keys(paramKeys).length > 0 ? { paramKeys } : {}),
                },
            },
        },
        converted: missing.map(([paramId, keyName]) => ({ paramId, keyName })),
    };
}

/** A widget that arrived naming a key the project lacks, and now holds that key's words itself. */
export type UITextArrivalConversion = { elementId: string; prop: string; keyName: string };

/**
 * Elements arriving from elsewhere - a paste, a template, a page copied in another project - settled
 * the way this project stores text from v13 on.
 *
 * The switch that translated an element's own words goes, as it went in the v13 step. A widget
 * naming a key this project has keeps the key and nothing else, its words being the key's here. A
 * widget naming a key this project lacks becomes one that holds the key's words itself - the words
 * the elements brought with them when they did, else the copy an older document kept on the widget,
 * else the key's name - so nothing arrives pointing at a key that is not there. An instance's text
 * parameter that names a key the project lacks is given the key's words the same way (prop
 * `param.<paramId>`, whose unit is the instance's own).
 *
 * Returns the table (the same object when nothing changed) and the widgets it converted, by their
 * ids in `table`, for the translations a caller can bring with them.
 */
export function settleIncomingUITextSources(
    table: Readonly<Record<string, UIElement>>,
    input: { hasKey: (name: string) => boolean; carried?: UITextCarriedKeys },
): { table: Record<string, UIElement>; converted: UITextArrivalConversion[] } {
    let out = table as Record<string, UIElement>;
    const converted: UITextArrivalConversion[] = [];
    const replace = (id: string, element: UIElement): void => {
        if (out === table) {
            out = { ...table };
        }
        out[id] = element;
    };
    for (const [id, element] of Object.entries(table)) {
        const site = uiTextSiteOf(element.type);
        if (getUIComponentLink(element)) {
            // Drawn from its definition; its own copy is only brought to the v13 shape. What it gives
            // the definition's text parameters is its own, and settled like a widget's words.
            let settled = site ? settleInstanceCopy(element, site) : element;
            const params = settleInstanceParamKeys(settled, input);
            if (params) {
                settled = params.element;
                for (const { paramId, keyName } of params.converted) {
                    converted.push({ elementId: id, prop: `param.${paramId}`, keyName });
                }
            }
            if (settled !== element) {
                replace(id, settled);
            }
            continue;
        }
        if (!site) {
            continue;
        }
        let next = element;
        if ((element.props as Record<string, unknown> | undefined)?.[LEGACY_UI_TEXT_UNIT_PROP] !== undefined) {
            next = withoutProps(next, [LEGACY_UI_TEXT_UNIT_PROP]);
        }
        const keyName = site.role === "words" ? readUITextSite(element, site).key : "";
        if (keyName && input.hasKey(keyName)) {
            next = withoutProps(next, [site.textProp, site.marksProp]);
        } else if (keyName) {
            const own = readUITextSite(element, site).text;
            const words = input.carried?.[keyName]?.words ?? (own || keyName);
            next = uiTextSiteWithOwnWords(next, site, words);
            converted.push({ elementId: id, prop: site.textProp, keyName });
        }
        if (next !== element) {
            replace(id, next);
        }
    }
    return { table: out, converted };
}

/**
 * Apply a run's edits to translation units held in memory: `units` per language, the source
 * language's excluded. Languages without edits come back as the same objects.
 */
export function applyUITextLocaleEdits(
    translations: Readonly<Record<string, Readonly<Record<string, LocalizationUnit>>>>,
    edits: Readonly<Record<string, UITextLocaleEdit>>,
): Record<string, Readonly<Record<string, LocalizationUnit>>> {
    const out: Record<string, Readonly<Record<string, LocalizationUnit>>> = { ...translations };
    for (const [locale, edit] of Object.entries(edits)) {
        const units = { ...(translations[locale] ?? {}) };
        for (const unitId of edit.remove) {
            delete units[unitId];
        }
        Object.assign(units, edit.set);
        out[locale] = units;
    }
    return out;
}
