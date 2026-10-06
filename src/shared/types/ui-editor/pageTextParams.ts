/**
 * A page's text parameters: words whoever opens a page hands it, declared on the page.
 *
 * The page's counterpart of a component's text parameters (`componentTextParams.ts`), read the same
 * way - the same value, the same step in the drawing - with one difference, in where the words come
 * from. A component is placed in the document; a page is mostly opened by a blueprint while the game
 * runs, with words the blueprint already holds in the player's language (a `Get Text`, a line of the
 * story). So the words a page shows through a `pageParam` binding are:
 *
 * - words given when it was opened - a node's input, a script's props - shown as given;
 * - words a Page widget gives in its inspector, which are part of the document and are translated
 *   through a unit that belongs to the widget, `ui:<frameId>.param.<name>` - named, like the value
 *   the widget stores, by the parameter's name, so the widget's words and their unit go together
 *   wherever the widget is copied;
 * - otherwise the declared default, translated through the page's own unit,
 *   `ui:<surfaceId>.param.<paramId>`.
 *
 * Every reader goes through here: the drawing (canvas and game alike, with no graph run), the
 * translation table, the interface lint, the glyph check and search. A parameter nothing on the page
 * shows has no translation row and no finding - its value reaches the screen only through a
 * blueprint, as a string (`Get Page Param`), as a component's does.
 *
 * Comments in English per project convention.
 */

import {
    uiComponentParamUnitId,
    type UIComponentTextValue,
    type UIComponentTextValues,
} from "./componentTextParams";
import type { UIDocument, UIElement, UIPageParam, UISurface } from "./document";
import { findUIElementSurfaceId, getUIFrameWidgetProps, UI_FRAME_ELEMENT_TYPE } from "./frame";
import { coerceUIPageParamValue, getUIPageParams, isUIPageTextParam } from "./pageParams";
import { readUITextSite, uiTextHasWords, uiTextSiteOf, type UITextSite } from "./textSource";

/**
 * The unit that translates a text parameter's words: the page's for its default (`ownerId` = the
 * surface id, `paramKey` = the parameter's id), a Page widget's for words the widget gives
 * (`ownerId` = the widget's element id, `paramKey` = the parameter's name, the key the widget stores
 * the words under). The spelling of a component's (`uiComponentParamUnitId`), and it cannot meet
 * one: surface, element and component ids are all distinct.
 */
export function uiPageParamUnitId(ownerId: string, paramKey: string): string {
    return uiComponentParamUnitId(ownerId, paramKey);
}

/** What a page's text parameters hold where it is being drawn. */
export type UIPageTextValues = {
    /**
     * Whether the page was opened - in a game, in Dev Mode, or in a Page widget, which opens it with
     * the widget's values. False on the page's own editing canvas, where nobody opened it: there a
     * parameter whose default has no words leaves the element's own words drawn, as sample text, so
     * the page can be laid out.
     */
    opened: boolean;
    /** By param id; every text parameter the page declares. */
    values: UIComponentTextValues;
};

/**
 * What a page's text parameters hold when it is opened with `props`.
 *
 * `props` are the ones the page was handed, before its defaults were laid over them
 * (`withUIPageParamDefaults`) - a value given and a default are translated differently, and the
 * overlaid props no longer tell the two apart. `giverId` is the Page widget that opened the page,
 * when one did: its words are its own, translated through its unit.
 */
export function resolveUIPageTextParams(
    surface: (Pick<UISurface, "id" | "kind"> & { params?: unknown }) | null | undefined,
    props: unknown,
    options: { opened: boolean; giverId?: string },
): UIPageTextValues {
    const values: Record<string, UIComponentTextValue> = {};
    if (surface) {
        const given = props && typeof props === "object" && !Array.isArray(props) ? (props as Record<string, unknown>) : {};
        for (const param of getUIPageParams(surface)) {
            if (isUIPageTextParam(param)) {
                values[param.id] = readUIPageTextValue(surface.id, param, given, options.giverId);
            }
        }
    }
    return { opened: options.opened, values };
}

function readUIPageTextValue(
    surfaceId: string,
    param: UIPageParam,
    given: Readonly<Record<string, unknown>>,
    giverId: string | undefined,
): UIComponentTextValue {
    const raw = Object.prototype.hasOwnProperty.call(given, param.name) ? given[param.name] : undefined;
    if (raw !== undefined && raw !== null) {
        return {
            origin: "placement",
            text: String(coerceUIPageParamValue("text", raw)),
            key: "",
            unitId: giverId ? uiPageParamUnitId(giverId, param.name) : "",
        };
    }
    return {
        origin: "default",
        text: typeof param.defaultValue === "string" ? param.defaultValue : "",
        key: "",
        unitId: uiPageParamUnitId(surfaceId, param.id),
    };
}

/** The page parameter an element's words show, when they are bound to one and the element names no key. */
export function uiTextPageParamOf(element: UIElement, site: UITextSite): string | null {
    if (site.role !== "words" || site.valueBinding === "none") {
        return null;
    }
    const reading = readUITextSite(element, site);
    return !reading.key && reading.binding?.kind === "pageParam" ? reading.binding.paramId : null;
}

/** The elements on page `surfaceId` whose words show its parameter `paramId`. */
export function listUIPageParamTextElements(
    document: Pick<UIDocument, "elements" | "surfaces">,
    surfaceId: string,
    paramId: string,
): UIElement[] {
    const out: UIElement[] = [];
    for (const element of Object.values(document.elements)) {
        const site = uiTextSiteOf(element.type);
        if (
            site
            && uiTextPageParamOf(element, site) === paramId
            && findUIElementSurfaceId(document as UIDocument, element.id) === surfaceId
        ) {
            out.push(element);
        }
    }
    return out;
}

/** Words one element puts on screen through a page's text parameter, and the unit they are translated through. */
export type UIPageTextValue = {
    /** The page that declares the parameter. */
    surfaceId: string;
    param: UIPageParam;
    /** Its `unitId` is never empty here: words shown as given are not the document's. */
    value: UIComponentTextValue;
    /** The elements on that page that show it; never empty. */
    shownBy: UIElement[];
};

/**
 * The words `element` puts on screen through page text parameters that the document holds, for the
 * readers that walk an element's words:
 *
 * - an element bound to its page's text parameter puts the declared default there (when it has
 *   words), under the page's unit - listed once per element that shows it, so a reader keeps one
 *   row per unit;
 * - a Page widget puts the words it gives each text parameter its page shows, under its own unit.
 *
 * Words given when a page is opened at run time are not the document's and are never listed.
 */
export function listUIPageTextValues(
    document: Pick<UIDocument, "elements" | "surfaces">,
    element: UIElement,
): UIPageTextValue[] {
    const out: UIPageTextValue[] = [];
    const site = uiTextSiteOf(element.type);
    const boundTo = site ? uiTextPageParamOf(element, site) : null;
    if (boundTo) {
        const surfaceId = findUIElementSurfaceId(document as UIDocument, element.id);
        const surface = surfaceId ? document.surfaces.find(candidate => candidate.id === surfaceId) : undefined;
        const param = getUIPageParams(surface).find(candidate => candidate.id === boundTo);
        if (surface && param && isUIPageTextParam(param)) {
            const value = readUIPageTextValue(surface.id, param, {}, undefined);
            if (uiTextHasWords(value.text)) {
                out.push({ surfaceId: surface.id, param, value, shownBy: [element] });
            }
        }
    }
    if (element.type === UI_FRAME_ELEMENT_TYPE) {
        const frame = getUIFrameWidgetProps(element);
        const target = frame.targetSurfaceId
            ? document.surfaces.find(candidate => candidate.id === frame.targetSurfaceId)
            : undefined;
        for (const param of getUIPageParams(target)) {
            if (!target || !isUIPageTextParam(param)) {
                continue;
            }
            const raw = frame.params[param.name];
            if (raw === undefined || raw === null) {
                continue;
            }
            const value = readUIPageTextValue(target.id, param, frame.params, element.id);
            if (!uiTextHasWords(value.text)) {
                continue;
            }
            const shownBy = listUIPageParamTextElements(document, target.id, param.id);
            if (shownBy.length > 0) {
                out.push({ surfaceId: target.id, param, value, shownBy });
            }
        }
    }
    return out;
}
