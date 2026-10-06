/**
 * The translation units of words elements write directly, as they follow the elements when copied.
 *
 * A widget's own words are translated through a unit named after the widget (`ui:<elementId>.<prop>`),
 * and a component placement's directly written parameter value through one named after the placement
 * (`ui:<placementId>.param.<paramId>`), and a component's text parameter default through one named
 * after the component (`ui:<componentId>.param.<paramId>`). A page's text parameter default is
 * translated through one named after the page (`ui:<surfaceId>.param.<paramId>`), and the words a
 * Page widget gives one through one named after the widget (`ui:<frameId>.param.<name>`). A copy - pasted, duplicated, part of a
 * duplicated page or component - is a new element under a new id, so its words would arrive with no
 * translation in any language. These are the units to carry and where they land: read from the elements through the
 * shared site table (`uiTextSitesOf`, a plugin widget's declared props included), so a site the table does not list is never carried, and a widget
 * whose words come from a key - which has no unit of its own - carries nothing.
 *
 * Pure. Comments in English per project convention.
 */

import {
    getUIComponentLink,
    getUIComponentParams,
    isUIComponentTextParam,
    type UIComponentDefinition,
    type UIElement,
    type UISurface,
} from "./document";
import { uiComponentParamUnitId } from "./componentTextParams";
import { getUIFrameWidgetProps, UI_FRAME_ELEMENT_TYPE } from "./frame";
import { getUIPageParams, isUIPageTextParam } from "./pageParams";
import { uiPageParamUnitId } from "./pageTextParams";
import { readUITextSite, uiTextSitesOf, uiTextUnitId } from "./textSource";

/** A unit an element's own words are translated through, and the prop it is filed under. */
export type UITextOwnUnit = {
    elementId: string;
    /** The site's text prop, or `param.<paramId>` for a placement's parameter value. */
    prop: string;
    unitId: string;
};

/**
 * Every unit the elements of `table` translate their own words through: a widget's words written
 * directly on a site a player reads, and each parameter value a component placement writes directly.
 * A placement's own copy of its definition's words is not one - nothing reads it.
 */
export function listUITextOwnUnits(table: Readonly<Record<string, UIElement>>): UITextOwnUnit[] {
    const out: UITextOwnUnit[] = [];
    for (const element of Object.values(table)) {
        const link = getUIComponentLink(element);
        if (link) {
            for (const [paramId, words] of Object.entries(link.params ?? {})) {
                if (typeof words === "string" && !link.paramKeys?.[paramId]?.trim()) {
                    out.push({ elementId: element.id, prop: `param.${paramId}`, unitId: uiComponentParamUnitId(element.id, paramId) });
                }
            }
            continue;
        }
        for (const site of uiTextSitesOf(element.type)) {
            if (site.role === "words" && !readUITextSite(element, site).key) {
                out.push({ elementId: element.id, prop: site.textProp, unitId: uiTextUnitId(element.id, site.textProp) });
            }
        }
        // A Page widget's words for its page's text parameters, by the name it stores them under.
        // Every string it gives is carried: which of them a text parameter takes is the page's to
        // say, and a unit nothing translates costs nothing to carry.
        if (element.type === UI_FRAME_ELEMENT_TYPE) {
            for (const [name, words] of Object.entries(getUIFrameWidgetProps(element).params)) {
                if (typeof words === "string") {
                    out.push({ elementId: element.id, prop: `param.${name}`, unitId: uiPageParamUnitId(element.id, name) });
                }
            }
        }
    }
    return out;
}

/** The units a page translates its text parameters' defaults through (`ui:<surfaceId>.param.<paramId>`). */
export function listUIPageDefaultUnits(surface: Pick<UISurface, "id" | "kind"> & { params?: unknown }): string[] {
    return getUIPageParams(surface)
        .filter(param => isUIPageTextParam(param))
        .map(param => uiPageParamUnitId(surface.id, param.id));
}

/**
 * The default units of copied pages re-keyed onto the copies made under `surfaceIdMap` (old surface
 * id → new): old unit id → new unit id.
 */
export function mapCopiedUIPageDefaultUnits(
    surfaces: readonly (Pick<UISurface, "id" | "kind"> & { params?: unknown })[],
    surfaceIdMap: Readonly<Record<string, string>>,
): Map<string, string> {
    const out = new Map<string, string>();
    for (const surface of surfaces) {
        const newId = surfaceIdMap[surface.id];
        if (!newId) {
            continue;
        }
        for (const param of getUIPageParams(surface)) {
            if (isUIPageTextParam(param)) {
                out.set(uiPageParamUnitId(surface.id, param.id), uiPageParamUnitId(newId, param.id));
            }
        }
    }
    return out;
}

/**
 * The units a component definition translates its text parameters' defaults through
 * (`ui:<componentId>.param.<paramId>`), which every placement that gives no value of its own shows.
 */
export function listUIComponentDefaultUnits(component: Pick<UIComponentDefinition, "id" | "params">): string[] {
    return getUIComponentParams(component)
        .filter(param => isUIComponentTextParam(param))
        .map(param => uiComponentParamUnitId(component.id, param.id));
}

/**
 * The default units of copied component definitions re-keyed onto the copies made under
 * `componentIdMap` (old component id → new): old unit id → new unit id.
 */
export function mapCopiedUIComponentDefaultUnits(
    components: readonly Pick<UIComponentDefinition, "id" | "params">[],
    componentIdMap: Readonly<Record<string, string>>,
): Map<string, string> {
    const out = new Map<string, string>();
    for (const component of components) {
        const newId = componentIdMap[component.id];
        if (!newId) {
            continue;
        }
        for (const param of getUIComponentParams(component)) {
            if (isUIComponentTextParam(param)) {
                out.set(uiComponentParamUnitId(component.id, param.id), uiComponentParamUnitId(newId, param.id));
            }
        }
    }
    return out;
}

/**
 * The units of `table` re-keyed onto copies made under `idMap` (old element id → new): old unit id →
 * new unit id. `table` holds the elements as they arrive, under their old ids. A site in `skip` -
 * words a copy took from a key the receiving project lacks, which bring that key's translations
 * instead - is left out.
 */
export function mapCopiedUITextUnits(
    table: Readonly<Record<string, UIElement>>,
    idMap: Readonly<Record<string, string>>,
    skip: readonly { elementId: string; prop: string }[] = [],
): Map<string, string> {
    const skipped = new Set(skip.map(site => `${site.elementId}\u0000${site.prop}`));
    const out = new Map<string, string>();
    for (const unit of listUITextOwnUnits(table)) {
        const newId = idMap[unit.elementId];
        if (!newId || skipped.has(`${unit.elementId}\u0000${unit.prop}`)) {
            continue;
        }
        out.set(unit.unitId, uiTextUnitId(newId, unit.prop));
    }
    return out;
}
