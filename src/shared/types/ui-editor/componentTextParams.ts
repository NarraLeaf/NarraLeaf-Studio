/**
 * A component's text parameters: words a player reads that each placement gives the definition.
 *
 * A component is placed many times and drawn from one definition, so whatever differs between its
 * placements has to live on the placement. For words that is a text parameter (`type: "text"`): a
 * placement gives it a value the way a text's words are given - written directly, or as a translation
 * key, one of the two and stored once - and a text or a button inside the definition shows it through a
 * `componentParam` value binding, the component's counterpart of a list row's field.
 *
 * Words a placement writes directly are translated through a unit that belongs to the placement,
 * `ui:<placementId>.param.<paramId>` - the element's own `ui:<elementId>.<prop>` with the parameter in
 * the place of the prop, so it can never meet a widget's own unit. A placement that gives no value
 * shows the definition's default, translated through the definition's unit,
 * `ui:<componentId>.param.<paramId>`, so a default shared by ten placements is translated once. A key
 * reads the key, as everywhere.
 *
 * Every reader goes through here: the drawing (canvas and game alike, with no graph run), the
 * translation table and its exports, the interface lint, the glyph check and `ui.js`. A parameter
 * that nothing inside the definition shows has no translation row and no finding - its value reaches
 * the screen only through a blueprint, as a string (`resolveUIComponentParams`).
 *
 * Comments in English per project convention.
 */

import {
    getUIComponentLink,
    getUIComponentParams,
    isUIComponentTextParam,
    type UIComponentDefinition,
    type UIComponentLink,
    type UIComponentParam,
    type UIDocument,
    type UIElement,
} from "./document";
import {
    readUITextSite,
    uiTextHasWords,
    uiTextSiteOf,
    uiTextUnitId,
    withUITextRuntimeWords,
    type UITextSite,
    type UITextUnitBinding,
} from "./textSource";

/**
 * The unit that translates words a text parameter is given directly: the placement's
 * (`ownerId` = the placement's element id), or the definition's for its default (`ownerId` = the
 * component's id).
 */
export function uiComponentParamUnitId(ownerId: string, paramId: string): string {
    return uiTextUnitId(ownerId, `param.${paramId}`);
}

/** The words one placement gives one text parameter. */
export type UIComponentTextValue = {
    /** Given on the placement, or the definition's default the placement falls back to. */
    origin: "placement" | "default";
    /** The words written directly ("" when the value names a key). */
    text: string;
    /** The translation key the value names, trimmed, or "". */
    key: string;
    /** The unit `text` is translated through: the placement's, or the definition's for a default. */
    unitId: string;
};

/** What a placement gives each of its component's text parameters, by param id. */
export type UIComponentTextValues = Readonly<Record<string, UIComponentTextValue>>;

/**
 * The value a placement gives one text parameter. A key the placement names wins over words it
 * holds, as on an element; a placement that holds neither falls back to the definition's default.
 */
export function readUIComponentTextValue(
    component: Pick<UIComponentDefinition, "id">,
    param: Pick<UIComponentParam, "id" | "defaultValue">,
    link: UIComponentLink | null | undefined,
    placementId: string,
): UIComponentTextValue {
    const key = link?.paramKeys?.[param.id]?.trim();
    if (key) {
        return { origin: "placement", text: "", key, unitId: uiComponentParamUnitId(placementId, param.id) };
    }
    const words = link?.params?.[param.id];
    if (typeof words === "string") {
        return { origin: "placement", text: words, key: "", unitId: uiComponentParamUnitId(placementId, param.id) };
    }
    return {
        origin: "default",
        text: typeof param.defaultValue === "string" ? param.defaultValue : "",
        key: "",
        unitId: uiComponentParamUnitId(component.id, param.id),
    };
}

/**
 * What one placement gives every text parameter its component declares - the context a drawing hands
 * the definition's insides. Empty, never null, for a component that declares none: a binding inside a
 * placement is answered by the placement either way, and a parameter it does not find shows nothing.
 */
export function resolveUIComponentTextParams(
    component: Pick<UIComponentDefinition, "id" | "params">,
    link: UIComponentLink | null | undefined,
    placementId: string,
): UIComponentTextValues {
    const out: Record<string, UIComponentTextValue> = {};
    for (const param of getUIComponentParams(component)) {
        if (isUIComponentTextParam(param)) {
            out[param.id] = readUIComponentTextValue(component, param, link, placementId);
        }
    }
    return out;
}

/**
 * The translation unit a value is read through, in the shape an element's words have one: the key it
 * names, or its own unit for words with a letter in them (`uiTextHasWords`). Null for words that read
 * the same in every language.
 */
export function uiComponentTextValueUnitBinding(value: UIComponentTextValue): UITextUnitBinding | null {
    if (value.key) {
        return { kind: "key", keyName: value.key };
    }
    if (uiTextHasWords(value.text)) {
        return { kind: "implicit", unitId: value.unitId, sourceText: value.text };
    }
    return null;
}

/** The component whose definition holds an element, when one does. */
export function findUIComponentHoldingElement(
    document: Pick<UIDocument, "components">,
    elementId: string,
): UIComponentDefinition | undefined {
    return (document.components ?? []).find(component => Boolean(component.elements?.[elementId]));
}

/** The parameter an element's words show, when they are bound to one and the element names no key. */
export function uiTextComponentParamOf(element: UIElement, site: UITextSite): string | null {
    if (site.role !== "words" || site.valueBinding === "none") {
        return null;
    }
    const reading = readUITextSite(element, site);
    return !reading.key && reading.binding?.kind === "componentParam" ? reading.binding.paramId : null;
}

/** The widgets inside a definition whose words show one of its parameters. */
export function listUIComponentParamTextElements(
    component: Pick<UIComponentDefinition, "elements">,
    paramId: string,
): UIElement[] {
    const out: UIElement[] = [];
    for (const element of Object.values(component.elements ?? {})) {
        const site = uiTextSiteOf(element.type);
        if (site && uiTextComponentParamOf(element, site) === paramId) {
            out.push(element);
        }
    }
    return out;
}

/** One text parameter's value on one placement, and the widgets inside the definition that show it. */
export type UIPlacementTextValue = {
    component: UIComponentDefinition;
    param: UIComponentParam;
    value: UIComponentTextValue;
    /** Never empty: a parameter nothing inside the definition shows is not listed. */
    shownBy: UIElement[];
};

/**
 * The words a placement puts on screen through its component's text parameters - every text parameter
 * some widget inside the definition shows, with the value this placement gives it. Empty for an
 * element that is not a placement.
 *
 * What the translation table, the lint and the glyph check read for a placement, in place of the
 * definition's own words, which are sample text there.
 */
export function listUIPlacementTextValues(
    document: Pick<UIDocument, "components">,
    placement: UIElement,
): UIPlacementTextValue[] {
    const link = getUIComponentLink(placement);
    if (!link) {
        return [];
    }
    const component = (document.components ?? []).find(candidate => candidate.id === link.componentId);
    if (!component) {
        return [];
    }
    const out: UIPlacementTextValue[] = [];
    for (const param of getUIComponentParams(component)) {
        if (!isUIComponentTextParam(param)) {
            continue;
        }
        const shownBy = listUIComponentParamTextElements(component, param.id);
        if (shownBy.length === 0) {
            continue;
        }
        out.push({ component, param, value: readUIComponentTextValue(component, param, link, placement.id), shownBy });
    }
    return out;
}

/**
 * The element as a drawing hands it to its widget when its words show a parameter's value: the key
 * the value names, which the widget reads as it reads its own; or the words, bound, with the unit they
 * are translated through. The element's own words and marks are sample text and are not handed on.
 */
export function withUIComponentTextValue(element: UIElement, site: UITextSite, value: UIComponentTextValue | undefined): UIElement {
    const bound = value?.key
        ? withUITextRuntimeWords(element, site, "", "bound")
        : withUITextRuntimeWords(element, site, value?.text ?? "", "bound", value ? value.unitId : undefined);
    const props = bound.props as Record<string, unknown>;
    if (site.marksProp) {
        delete props[site.marksProp];
    }
    if (site.keyProp) {
        if (value?.key) {
            props[site.keyProp] = value.key;
        } else {
            delete props[site.keyProp];
        }
    }
    return bound;
}
