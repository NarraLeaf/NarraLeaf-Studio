/**
 * What every text site of a project shows, in every language, before and after the v13 step - the
 * test kit the v13 golden comparison runs on.
 *
 * "Before" is what a v12 document showed under the runtime that read it: a package carried keys and
 * translations only for a project with a source language, an element's own words were translated
 * only behind the `localizable` switch, a key fell back to the element's copy of its words, and
 * sample words (`textSample.ts`) were stripped from the package with their switch and their units.
 * It is written out here, as the code before v13 did it, because the runtime no longer does.
 *
 * "After" is the v13 document from `migrateUITextSourcesV13`, packaged the way a build packages it
 * and resolved by the resolver the game runs (`resolveUITextWords`).
 *
 * A value binding's answer, and the story's line in its slot, are the same before and after and are
 * not computed: they are named (`<bound>`, `<story>`), so a site that shows one is compared by which
 * one it shows. Runtime writes are not part of either: they are the D2 change, not the document's.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument } from "@shared/types/blueprint/document";
import {
    keysOnlyLocalization,
    localizationKeyUnitId,
    resolveLocalizedUnitText,
    type GameLocalizationBundle,
    type LocalizationUnit,
} from "@shared/types/localization";
import { getUIComponentLink, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import { findUIElementSurfaceId } from "@shared/types/ui-editor/frame";
import { withoutUITextSamples, withoutUITextSampleUnits } from "@shared/types/ui-editor/textSample";
import { readUITextSite, resolveUITextWords, uiTextSiteOf, uiTextUnitId, type UITextSite } from "@shared/types/ui-editor/textSource";
import {
    applyUITextLocaleEdits,
    LEGACY_UI_TEXT_UNIT_PROP,
    migrateUITextSourcesV13,
    type UITextMigrationChange,
} from "@shared/types/ui-editor/textSourceMigration";

/** A project as its files hold it. */
export type GoldenProject = {
    document: UIDocument;
    /**
     * The graphs, so a case can state who writes an element's words. Neither resolution reads them:
     * words a blueprint writes over are the element's default value, shown and translated as the
     * element's own until the first write, which is not part of either.
     */
    blueprints: BlueprintDocument | null;
    /** Key name to source words. */
    keys: Record<string, string>;
    /** "" for a project without a source language. */
    sourceLocale: string;
    /** Every language the project declares, the source language included. */
    locales: string[];
    /** Every translation file but the source language's. */
    translations: Record<string, Record<string, LocalizationUnit>>;
};

/** Where a site is shown: a language a player reads it in, or the editor's canvas. */
export const GOLDEN_VIEWS = ["en", "zh-CN", "ja", "canvas"] as const;
export type GoldenView = (typeof GOLDEN_VIEWS)[number];

/** `elementId.prop` → what it shows in each view. */
export type GoldenResolution = Map<string, Record<GoldenView, string>>;

/** The words a widget shows where its own prop is absent: the widget's own default. */
const DEFAULT_WORDS: Readonly<Record<string, string>> = { text: "Text", label: "", placeholder: "" };

function ownWords(element: UIElement, site: UITextSite): string {
    const value = (element.props as Record<string, unknown> | undefined)?.[site.textProp];
    return typeof value === "string" ? value : DEFAULT_WORDS[site.textProp] ?? "";
}

function inStorySlot(document: UIDocument, element: UIElement, site: UITextSite): boolean {
    if (!site.storySlot) {
        return false;
    }
    const surfaceId = findUIElementSurfaceId(document, element.id);
    const surface = surfaceId ? document.surfaces.find(candidate => candidate.id === surfaceId) : undefined;
    return surface?.kind === "stageSurface" && surface.mount.slotId === site.storySlot;
}

/** Every element with a text site, from both element tables, with the table it is drawn from. */
function sites(document: UIDocument): { element: UIElement; site: UITextSite }[] {
    const out: { element: UIElement; site: UITextSite }[] = [];
    const tables = [document.elements, ...(document.components ?? []).map(component => component.elements)];
    for (const table of tables) {
        for (const element of Object.values(table ?? {})) {
            const site = uiTextSiteOf(element.type);
            if (site && !getUIComponentLink(element)) {
                out.push({ element, site });
            }
        }
    }
    return out;
}

/** The words a site shows before the game resolves keys and units: its own, or what fills it. */
function handedWords(document: UIDocument, element: UIElement, site: UITextSite): { words: string; bound: boolean } {
    if (site.role === "sample" && inStorySlot(document, element, site)) {
        return { words: "<story>", bound: true };
    }
    const binding = readUITextSite(element, site).binding;
    if (binding && site.valueBinding !== "none") {
        return { words: "<bound>", bound: true };
    }
    return { words: ownWords(element, site), bound: false };
}

function tablesOf(translations: GoldenProject["translations"], sourceLocale: string): Record<string, Record<string, string>> {
    const tables: Record<string, Record<string, string>> = {};
    for (const [locale, units] of Object.entries(translations)) {
        if (locale === sourceLocale) {
            continue;
        }
        const table: Record<string, string> = {};
        for (const [unitId, unit] of Object.entries(units)) {
            if (unit.target) {
                table[unitId] = unit.target;
            }
        }
        if (Object.keys(table).length > 0) {
            tables[locale] = table;
        }
    }
    return tables;
}

function bundleOf(project: GoldenProject, tables: Record<string, Record<string, string>>): GameLocalizationBundle | undefined {
    if (!project.sourceLocale || project.locales.length === 0) {
        return undefined;
    }
    return {
        sourceLocale: project.sourceLocale,
        locales: project.locales.map(code => ({ code, displayName: code })),
        tables,
        ...(Object.keys(project.keys).length > 0 ? { keys: project.keys } : {}),
    };
}

/** The language a player is reading in, as the game would read it for this project. */
function playedLocale(project: GoldenProject, view: GoldenView): string {
    if (!project.sourceLocale) {
        return "";
    }
    return project.locales.includes(view) ? view : project.sourceLocale;
}

/** What a v12 document showed, under the runtime that read it. */
export function resolveBeforeV13(project: GoldenProject): GoldenResolution {
    const strip = withoutUITextSamples(project.document);
    // Before v13 the strip also took the switch off sample words; it does not any more, so it is
    // taken off here for the elements the strip touched.
    const packaged = strip.document;
    const bundle = withoutUITextSampleUnits(bundleOf(project, tablesOf(project.translations, project.sourceLocale)), strip.unitIds);
    const out: GoldenResolution = new Map();
    for (const { element, site } of sites(project.document)) {
        const shipped = findElement(packaged, element.id) ?? element;
        const stripped = strip.unitIds.has(uiTextUnitId(element.id, site.textProp));
        const key = site.keyProp ? readUITextSite(element, site).key : "";
        const localizable = !stripped && (element.props as Record<string, unknown> | undefined)?.[LEGACY_UI_TEXT_UNIT_PROP] === true;
        const handed = handedWords(project.document, shipped, site);
        const row = {} as Record<GoldenView, string>;
        for (const view of GOLDEN_VIEWS) {
            if (view === "canvas") {
                const canvasHanded = handedWords(project.document, element, site);
                const words = canvasHanded.words === "<bound>" && readUITextSite(element, site).binding?.kind === "blueprintValue"
                    ? ownWords(element, site)
                    : canvasHanded.words === "<bound>" ? "<bound>" : canvasHanded.words;
                const keys = project.sourceLocale ? project.keys : null;
                row[view] = key && site.canvasDrawsKey && keys ? keys[key] ?? words : words;
                continue;
            }
            if (handed.words === "<story>") {
                row[view] = "<story>";
                continue;
            }
            if (!bundle) {
                row[view] = handed.words;
                continue;
            }
            const locale = playedLocale(project, view);
            if (key) {
                row[view] = resolveLocalizedUnitText(bundle, locale, localizationKeyUnitId(key)) ?? bundle.keys?.[key] ?? handed.words;
            } else if (localizable) {
                row[view] = resolveLocalizedUnitText(bundle, locale, uiTextUnitId(element.id, site.textProp)) ?? handed.words;
            } else {
                row[view] = handed.words;
            }
        }
        out.set(`${element.id}.${site.textProp}`, row);
    }
    return out;
}

function findElement(document: UIDocument, id: string): UIElement | undefined {
    return document.elements[id] ?? (document.components ?? []).map(component => component.elements[id]).find(Boolean);
}

/** The v13 document, its translations and the changes the step reports. */
export function migrateGoldenProject(project: GoldenProject): {
    project: GoldenProject;
    changes: UITextMigrationChange[];
} {
    const translations = Object.fromEntries(
        Object.entries(project.translations).filter(([locale]) => locale !== project.sourceLocale),
    );
    const result = migrateUITextSourcesV13(project.document, {
        keys: project.keys,
        sourceLocale: project.sourceLocale,
        translations,
    });
    return {
        project: {
            ...project,
            document: result.document,
            translations: {
                ...project.translations,
                ...applyUITextLocaleEdits(translations, result.localeEdits),
            } as GoldenProject["translations"],
        },
        changes: result.changes,
    };
}

/** What a v13 document shows, under the runtime that reads it. */
export function resolveAfterV13(project: GoldenProject): GoldenResolution {
    const strip = withoutUITextSamples(project.document);
    const tables = tablesOf(project.translations, project.sourceLocale);
    const bundle = withoutUITextSampleUnits(bundleOf(project, tables), strip.unitIds) ?? keysOnlyLocalization(project.keys);
    const out: GoldenResolution = new Map();
    for (const { element, site } of sites(project.document)) {
        const shipped = findElement(strip.document, element.id) ?? element;
        const key = site.keyProp ? readUITextSite(shipped, site).key : "";
        const handed = handedWords(project.document, shipped, site);
        const row = {} as Record<GoldenView, string>;
        for (const view of GOLDEN_VIEWS) {
            if (view === "canvas") {
                const canvasHanded = handedWords(project.document, element, site);
                const words = canvasHanded.words === "<bound>" && readUITextSite(element, site).binding?.kind === "blueprintValue"
                    ? ownWords(element, site)
                    : canvasHanded.words;
                row[view] = resolveUITextWords(
                    { site, elementId: element.id, sourceText: words, localizationKey: key },
                    { kind: "canvas", keys: project.keys },
                );
                continue;
            }
            if (handed.words === "<story>") {
                row[view] = "<story>";
                continue;
            }
            row[view] = resolveUITextWords(
                {
                    site,
                    elementId: element.id,
                    sourceText: handed.words,
                    localizationKey: key,
                    origin: handed.bound ? "bound" : undefined,
                },
                { kind: "game", bundle, locale: playedLocale(project, view) },
            );
        }
        out.set(`${element.id}.${site.textProp}`, row);
    }
    return out;
}

/** The sites whose words differ between two resolutions, with the views they differ in. */
export function goldenDifferences(before: GoldenResolution, after: GoldenResolution): { site: string; views: GoldenView[] }[] {
    const out: { site: string; views: GoldenView[] }[] = [];
    for (const [site, row] of before) {
        const next = after.get(site);
        const views = GOLDEN_VIEWS.filter(view => !next || next[view] !== row[view]);
        if (views.length > 0) {
            out.push({ site, views });
        }
    }
    return out;
}
