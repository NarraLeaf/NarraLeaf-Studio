import type { TranslationKey } from "@shared/i18n";
import { getUIComponentLink, type UIComponentDefinition, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { listUIPlacementTextValues } from "@shared/types/ui-editor/componentTextParams";
import { listUIPageTextValues } from "@shared/types/ui-editor/pageTextParams";
import { readUITextSite, resolveUITextWords, uiTextSiteLabel, uiTextSiteOf, uiTextSitesOf } from "@shared/types/ui-editor/textSource";
import { uiTextSampleCauseOf } from "@shared/types/ui-editor/textSample";
import { i18nStore, translate } from "@/lib/i18n";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { Services } from "../../services";
import { LocalizationService } from "../../localization/LocalizationService";
import { UIDocumentService } from "../../ui-editor/UIDocumentService";
import type { SearchIndexEntry } from "../searchIndexModel";
import type { SearchJumpTarget } from "../searchJumpTarget";
import type { SearchSource } from "../searchSource";

/** What a result row calls the things the document cannot name for itself. */
export interface UITextEntryLabels {
    /** Said after the place of words no player reads: a binding decides what shows there. */
    sample: string;
    /** What a widget the author never named is called. */
    widgetName: (element: UIElement) => string;
}

export interface UITextExtractionInput {
    /** The project's translation keys, name → source words. Null before they have loaded. */
    keys: Readonly<Record<string, string>> | null;
    labels: UITextEntryLabels;
}

/**
 * Every interface word an author can find on a page or in a component, each row opening the page or
 * the component with the widget selected.
 *
 * The words are the ones the canvas draws in the source language, read through the shared site table
 * and resolver (`uiTextSitesOf`, `resolveUITextWords`): a widget's own words - each prop a plugin's
 * widget declares as words among them - a translation key's
 * source words where the widget names one, and the words a component placement gives each text
 * parameter some widget inside the definition shows (`listUIPlacementTextValues`). A placement carries
 * none of its definition's words, so its own copy is not read, as nowhere else reads it.
 *
 * Sample text - the dialogue and NVL lines' stand-ins, and words a binding decides in the game
 * (`uiTextSampleCauseOf`) - is listed too, because it is on the canvas and the author typed it, but
 * its context line says it is sample text: a search for what a player reads must not answer with words
 * no player sees without saying so. Words a blueprint writes over are not sample text: they are the
 * widget's default value, which a player reads until the first write, and are listed as such.
 *
 * Pages first, in the order the document lists them and each depth first, then the component
 * definitions. Words without a single non-space character have nothing to find and are skipped.
 */
export function extractUITextEntries(document: UIDocument, input: UITextExtractionInput): SearchIndexEntry[] {
    const entries: SearchIndexEntry[] = [];
    const nameOf = (element: UIElement): string => element.name?.trim() || input.labels.widgetName(element);

    const read = (element: UIElement, ownerName: string, target: SearchJumpTarget): void => {
        for (const { param, value, shownBy } of listUIPlacementTextValues(document, element)) {
            const site = uiTextSiteOf(shownBy[0]?.type);
            if (!site) {
                continue;
            }
            const words = resolveUITextWords(
                { site, elementId: element.id, sourceText: value.text, localizationKey: value.key, origin: "bound" },
                { kind: "canvas", keys: input.keys },
            );
            if (!words.trim()) {
                continue;
            }
            entries.push({
                id: `uitext:${element.id}.param.${param.id}`,
                group: "uiText",
                text: words,
                detail: `${ownerName} › ${nameOf(element)} › ${param.name.trim() || nameOf(shownBy[0])}`,
                target,
            });
        }
        // A page's text parameters: the default a text on the page shows, the words a Page widget gives.
        for (const { param, value } of listUIPageTextValues(document, element)) {
            if (!value.text.trim()) {
                continue;
            }
            entries.push({
                id: `uitext:${element.id}.pageParam.${param.id}`,
                group: "uiText",
                text: value.text,
                detail: `${ownerName} › ${nameOf(element)} › ${param.name}`,
                target,
            });
        }
        if (getUIComponentLink(element)) {
            return;
        }
        const sites = uiTextSitesOf(element.type);
        for (const site of sites) {
            const reading = readUITextSite(element, site);
            const words = resolveUITextWords(
                { site, elementId: element.id, sourceText: reading.text, localizationKey: reading.key },
                { kind: "canvas", keys: input.keys },
            );
            if (!words.trim()) {
                continue;
            }
            const sample = site.role === "sample" || uiTextSampleCauseOf(element, site) !== null;
            // A plugin widget with several words names which of them matched.
            const widget = sites.length > 1
                ? `${nameOf(element)} › ${uiTextSiteLabel(site, i18nStore.getLocale())}`
                : nameOf(element);
            entries.push({
                id: `uitext:${element.id}.${site.textProp}`,
                group: "uiText",
                text: words,
                detail: sample ? `${ownerName} › ${widget} · ${input.labels.sample}` : `${ownerName} › ${widget}`,
                target,
            });
        }
    };

    for (const surface of document.surfaces ?? []) {
        walkSurface(document, surface, element =>
            read(element, surface.name, { kind: "uiSurface", surfaceId: surface.id, elementId: element.id }));
    }
    for (const component of document.components ?? []) {
        walkComponent(component, element =>
            read(element, component.name, { kind: "uiComponent", componentId: component.id, elementId: element.id }));
    }
    return entries;
}

/** A page's elements depth first, each once even in a document whose children loop. */
function walkSurface(document: UIDocument, surface: UISurface, visit: (element: UIElement) => void): void {
    const seen = new Set<string>();
    const descend = (elementId: string): void => {
        const element = document.elements[elementId];
        if (!element || seen.has(elementId)) {
            return;
        }
        seen.add(elementId);
        visit(element);
        for (const childId of element.childrenIds ?? []) {
            descend(childId);
        }
    };
    descend(surface.rootElementId);
}

/** A component definition's elements depth first from its root, then any its tree does not reach. */
function walkComponent(component: UIComponentDefinition, visit: (element: UIElement) => void): void {
    const seen = new Set<string>();
    const descend = (elementId: string): void => {
        const element = component.elements[elementId];
        if (!element || seen.has(elementId)) {
            return;
        }
        seen.add(elementId);
        visit(element);
        for (const childId of element.childrenIds ?? []) {
            descend(childId);
        }
    };
    descend(component.rootElementId);
    for (const elementId of Object.keys(component.elements ?? {})) {
        descend(elementId);
    }
}

/**
 * The interface's words, in one slice.
 *
 * One slice because the pages and the components live in one document whose change event fires for
 * the whole of it. Two other inputs make a slice stale: the translation keys (a keyed widget's row is
 * the key's words) and the interface language (the sample-text note and unnamed widgets' names are
 * translated into the rows).
 *
 * No `dedupKey`: two widgets that say the same thing on the same page are two places to go.
 */
export const uiTextSource: SearchSource = {
    id: "uiText",
    groups: ["uiText"],
    dependsOn: [Services.UIDocument, Services.Localization],
    extract: async ctx => {
        let document: UIDocument;
        try {
            document = ctx.services.get<UIDocumentService>(Services.UIDocument).getDocument();
        } catch {
            // The interface document loads lazily; not built yet is an ordinary state at startup.
            return [];
        }
        let keys: Record<string, string> | null = null;
        try {
            const registry = await ctx.services.get<LocalizationService>(Services.Localization).loadKeys();
            keys = Object.fromEntries(Object.entries(registry.keys).map(([name, definition]) => [name, definition.sourceText]));
        } catch {
            // Keyed widgets then read as the canvas reads them before the registry is published.
        }
        return extractUITextEntries(document, {
            keys,
            labels: {
                sample: translate("widgets.sampleText.label" as TranslationKey),
                widgetName: element => widgetModuleRegistry.get(element.type)?.displayName || element.type,
            },
        });
    },
    watch: (ctx, signal) => {
        const edits = ctx.services.get<UIDocumentService>(Services.UIDocument).onDocumentChanged(() => signal.invalidate());
        const keys = ctx.services.get<LocalizationService>(Services.Localization).onKeysChanged(() => signal.invalidate());
        const locale = i18nStore.subscribe(() => signal.invalidate());
        return () => {
            edits();
            keys();
            locale();
        };
    },
};
