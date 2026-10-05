/**
 * Where a named translation key is used: the widgets whose words it supplies and the blueprints that
 * read it. Asked before a key is removed, so the confirmation can say which widgets take the key's
 * words as their own and which blueprints are left reading a key that is gone; and when a translation
 * file is exported, so a translator reading a key's row can see which pages and components show it.
 *
 * Pure: reads the two documents it is handed. Comments in English per project convention.
 */

import { anchorComponentId, anchorSurfaceId } from "@shared/blueprint/ownerShape";
import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { getUIComponentLink, getUIComponentParams } from "@shared/types/ui-editor/document";
import { readUITextSite, uiTextSitesOf } from "@shared/types/ui-editor/textSource";
import { listBlueprintGraphSites } from "@/lib/lint/blueprintSites";
import { REFERENCE_KIND_BY_OPTIONS_SOURCE } from "@/lib/lint/rules/blueprint";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";

export type LocalizationKeyUses = {
    /** Widgets reading their words from the key, as "page › widget" (or "component › widget"). */
    elements: { ownerName: string; elementName: string }[];
    /** Blueprints with a node naming the key, by name, each once. */
    blueprints: string[];
    /**
     * The pages and components the key is used on, by name, each once: those holding a widget that
     * reads it, then those whose blueprints read it. A blueprint that belongs to no page or component
     * (the project's own, a story row's) adds none.
     */
    places: string[];
};

export type LocalizationKeyUsesInput = {
    uiDocument: UIDocument | null;
    blueprintDocument: BlueprintDocument | null;
    /** What to call a widget the author never named. */
    widgetName: (element: UIElement) => string;
};

/**
 * Every widget and blueprint that names the key.
 *
 * Widgets are read through the text-site table (`textSites.ts`), so a placeholder's key counts as a
 * text's does; a component instance carries none of its definition's words and is skipped, while the
 * definition itself is listed under its own name. An instance that reads a text parameter's value
 * from the key is listed as "widget › parameter". A blueprint node counts when one of its dropdowns
 * picks from the project's keys and holds this name.
 */
export function listLocalizationKeyUses(input: LocalizationKeyUsesInput & { keyName: string }): LocalizationKeyUses {
    return indexLocalizationKeyUses(input).get(input.keyName) ?? { elements: [], blueprints: [], places: [] };
}

/**
 * The uses of every key named anywhere, by key name - one walk of both documents for all of them, so
 * a translation export with a hundred keys reads each page once rather than a hundred times. Keys
 * nothing names are absent.
 */
export function indexLocalizationKeyUses(input: LocalizationKeyUsesInput): ReadonlyMap<string, LocalizationKeyUses> {
    const { uiDocument, blueprintDocument } = input;
    const index = new Map<string, LocalizationKeyUses>();
    const usesOf = (keyName: string): LocalizationKeyUses => {
        let uses = index.get(keyName);
        if (!uses) {
            uses = { elements: [], blueprints: [], places: [] };
            index.set(keyName, uses);
        }
        return uses;
    };
    const addPlace = (uses: LocalizationKeyUses, ownerName: string): void => {
        const name = ownerName.trim();
        if (name && !uses.places.includes(name)) {
            uses.places.push(name);
        }
    };
    const nameOf = (element: UIElement) => element.name?.trim() || input.widgetName(element);
    /**
     * The keys a widget reads its own words from, each once: Studio's own widgets have one site, a
     * plugin's widget can read several of its words from keys.
     */
    const keysOf = (element: UIElement): string[] => {
        if (getUIComponentLink(element)) {
            return [];
        }
        const keys = new Set<string>();
        for (const site of uiTextSitesOf(element.type)) {
            const key = site.keyProp && site.role === "words" ? readUITextSite(element, site).key : "";
            if (key) {
                keys.add(key);
            }
        }
        return [...keys];
    };
    const read = (element: UIElement, ownerName: string): void => {
        for (const keyName of keysOf(element)) {
            const uses = usesOf(keyName);
            uses.elements.push({ ownerName, elementName: nameOf(element) });
            addPlace(uses, ownerName);
        }
        // The text parameters an instance reads from a key, as "widget › parameter".
        const link = getUIComponentLink(element);
        if (!link?.paramKeys) {
            return;
        }
        const component = uiDocument?.components?.find(candidate => candidate.id === link.componentId);
        const params = getUIComponentParams(component);
        for (const [paramId, rawName] of Object.entries(link.paramKeys)) {
            const paramKey = rawName.trim();
            if (!paramKey) {
                continue;
            }
            const uses = usesOf(paramKey);
            uses.elements.push({
                ownerName,
                elementName: `${nameOf(element)} › ${params.find(param => param.id === paramId)?.name.trim() || paramId}`,
            });
            addPlace(uses, ownerName);
        }
    };
    for (const surface of uiDocument?.surfaces ?? []) {
        const seen = new Set<string>();
        const visit = (elementId: string): void => {
            const element = uiDocument?.elements[elementId];
            if (!element || seen.has(elementId)) {
                return;
            }
            seen.add(elementId);
            read(element, surface.name);
            for (const childId of element.childrenIds ?? []) {
                visit(childId);
            }
        };
        visit(surface.rootElementId);
    }
    for (const component of uiDocument?.components ?? []) {
        for (const element of Object.values(component.elements ?? {})) {
            read(element, component.name);
        }
    }

    registerCoreBlueprintNodes();
    for (const site of listBlueprintGraphSites(blueprintDocument)) {
        // A blueprint with no owner of its own (an older document's) still counts, on no page.
        const surfaceId = site.owner ? anchorSurfaceId(site.owner) : null;
        const componentId = site.owner ? anchorComponentId(site.owner) : null;
        const ownerName = surfaceId
            ? uiDocument?.surfaces.find(surface => surface.id === surfaceId)?.name ?? ""
            : componentId
                ? uiDocument?.components?.find(component => component.id === componentId)?.name ?? ""
                : "";
        for (const node of Object.values(site.ir.nodes ?? {})) {
            for (const param of blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params).inspectorParams ?? []) {
                const source = param.dynamicOptionsSource;
                if (!source || REFERENCE_KIND_BY_OPTIONS_SOURCE[source] !== "textKey") {
                    continue;
                }
                const keyName = String(node.params?.[param.key] ?? "").trim();
                if (!keyName) {
                    continue;
                }
                const uses = usesOf(keyName);
                if (!uses.blueprints.includes(site.blueprintName)) {
                    uses.blueprints.push(site.blueprintName);
                }
                addPlace(uses, ownerName);
            }
        }
    }
    return index;
}

/**
 * The context a key's row carries in an exported translation file: the key's name, then the pages and
 * components it is used on, so a translator knows where the words appear (`menu.start · Title, Pause`).
 * Names only, never an id; just the name for a key nothing uses.
 */
export function describeLocalizationKeyContext(keyName: string, uses: LocalizationKeyUses | undefined): string {
    const places = uses?.places ?? [];
    return places.length > 0 ? `${keyName} · ${places.join(", ")}` : keyName;
}
