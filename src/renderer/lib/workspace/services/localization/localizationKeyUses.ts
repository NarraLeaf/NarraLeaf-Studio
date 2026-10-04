/**
 * Where a named translation key is used: the widgets whose words it supplies and the blueprints that
 * read it. Asked before a key is removed, so the confirmation can say what is left pointing at
 * nothing.
 *
 * Pure: reads the two documents it is handed. Comments in English per project convention.
 */

import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { getUIComponentLink } from "@shared/types/ui-editor/document";
import { readUITextSite, uiTextSiteOf } from "@shared/types/ui-editor/textSource";
import { listBlueprintGraphSites } from "@/lib/lint/blueprintSites";
import { REFERENCE_KIND_BY_OPTIONS_SOURCE } from "@/lib/lint/rules/blueprint";
import { blueprintNodeRegistry } from "@/lib/ui-editor/blueprint-nodes/BlueprintNodeRegistry";
import { registerCoreBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/registerCoreBlueprintNodes";

export type LocalizationKeyUses = {
    /** Widgets reading their words from the key, as "page › widget" (or "component › widget"). */
    elements: { ownerName: string; elementName: string }[];
    /** Blueprints with a node naming the key, by name, each once. */
    blueprints: string[];
};

/**
 * Every widget and blueprint that names the key.
 *
 * Widgets are read through the text-site table (`textSites.ts`), so a placeholder's key counts as a
 * text's does; a component instance carries none of its definition's words and is skipped, while the
 * definition itself is listed under its own name. A blueprint node counts when one of its dropdowns
 * picks from the project's keys and holds this name.
 *
 * @param widgetName what to call a widget the author never named
 */
export function listLocalizationKeyUses(input: {
    uiDocument: UIDocument | null;
    blueprintDocument: BlueprintDocument | null;
    keyName: string;
    widgetName: (element: UIElement) => string;
}): LocalizationKeyUses {
    const { uiDocument, blueprintDocument, keyName } = input;
    const elements: LocalizationKeyUses["elements"] = [];
    const usesKey = (element: UIElement): boolean => {
        const site = uiTextSiteOf(element.type);
        return Boolean(site?.keyProp && site.role === "words" && !getUIComponentLink(element)
            && readUITextSite(element, site).key === keyName);
    };
    const nameOf = (element: UIElement) => element.name?.trim() || input.widgetName(element);
    for (const surface of uiDocument?.surfaces ?? []) {
        const seen = new Set<string>();
        const visit = (elementId: string): void => {
            const element = uiDocument?.elements[elementId];
            if (!element || seen.has(elementId)) {
                return;
            }
            seen.add(elementId);
            if (usesKey(element)) {
                elements.push({ ownerName: surface.name, elementName: nameOf(element) });
            }
            for (const childId of element.childrenIds ?? []) {
                visit(childId);
            }
        };
        visit(surface.rootElementId);
    }
    for (const component of uiDocument?.components ?? []) {
        for (const element of Object.values(component.elements ?? {})) {
            if (usesKey(element)) {
                elements.push({ ownerName: component.name, elementName: nameOf(element) });
            }
        }
    }

    registerCoreBlueprintNodes();
    const blueprints: string[] = [];
    for (const site of listBlueprintGraphSites(blueprintDocument)) {
        const names = Object.values(site.ir.nodes ?? {}).some(node =>
            (blueprintNodeRegistry.resolveCatalogEntryForNode(node.type, node.params).inspectorParams ?? []).some(param => {
                const source = param.dynamicOptionsSource;
                return Boolean(source && REFERENCE_KIND_BY_OPTIONS_SOURCE[source] === "textKey")
                    && String(node.params?.[param.key] ?? "").trim() === keyName;
            }),
        );
        if (names && !blueprints.includes(site.blueprintName)) {
            blueprints.push(site.blueprintName);
        }
    }
    return { elements, blueprints };
}
