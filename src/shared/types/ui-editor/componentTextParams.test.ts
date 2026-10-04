import { describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "../localization";
import type { UIComponentDefinition, UIDocument, UIElement } from "./document";
import { getUIComponentLink, resolveUIComponentParams } from "./document";
import {
    listUIPlacementTextValues,
    readUIComponentTextValue,
    resolveUIComponentTextParams,
    uiComponentParamUnitId,
    uiComponentTextValueUnitBinding,
    uiTextComponentParamOf,
    withUIComponentTextValue,
} from "./componentTextParams";
import { resolveUITextWords, uiTextRuntimeOriginOf, uiTextRuntimeUnitOf, uiTextSiteOf } from "./textSource";
import { uiTextSampleCauseOf } from "./textSample";

const TEXT_SITE = uiTextSiteOf("nl.text")!;

function element(id: string, type: string, more: Partial<UIElement> = {}): UIElement {
    return { id, type, parentId: null, childrenIds: [], layout: { x: 0, y: 0, width: 10, height: 10 }, ...more };
}

const nav: UIComponentDefinition = {
    id: "nav",
    name: "Nav item",
    rootElementId: "nav-root",
    params: [
        { id: "label", name: "Label", type: "text", defaultValue: "Item" },
        { id: "target", name: "Target", type: "string", defaultValue: "title" },
        { id: "unused", name: "Unused", type: "text", defaultValue: "Never shown" },
    ],
    elements: {
        "nav-root": element("nav-root", "nl.container", { childrenIds: ["nav-label"] }),
        "nav-label": element("nav-label", "nl.text", {
            parentId: "nav-root",
            props: { text: "Sample" },
            valueBindings: { text: { kind: "componentParam", paramId: "label" } },
        }),
    },
};

function placement(id: string, link: Record<string, unknown>): UIElement {
    return element(id, "nl.container", { extra: { componentLink: { componentId: "nav", linked: true, ...link } } });
}

describe("a text parameter's value on one placement", () => {
    it("is the words the placement writes, translated through the placement's own unit", () => {
        const link = getUIComponentLink(placement("p1", { params: { label: "Start" } }));
        expect(readUIComponentTextValue(nav, nav.params![0], link, "p1")).toEqual({
            origin: "placement",
            text: "Start",
            key: "",
            unitId: "ui:p1.param.label",
        });
    });

    it("is the key the placement names, which wins over words it still holds", () => {
        const link = getUIComponentLink(placement("p2", { params: { label: "Old" }, paramKeys: { label: " menu.title " } }));
        const value = readUIComponentTextValue(nav, nav.params![0], link, "p2");
        expect(value.key).toBe("menu.title");
        expect(value.text).toBe("");
        expect(uiComponentTextValueUnitBinding(value)).toEqual({ kind: "key", keyName: "menu.title" });
    });

    it("falls back to the default, translated once through the definition's unit", () => {
        const value = readUIComponentTextValue(nav, nav.params![0], getUIComponentLink(placement("p3", {})), "p3");
        expect(value).toEqual({ origin: "default", text: "Item", key: "", unitId: "ui:nav.param.label" });
        expect(uiComponentParamUnitId("nav", "label")).toBe("ui:nav.param.label");
    });

    it("written as an empty string is a value, not a fallback", () => {
        const value = readUIComponentTextValue(nav, nav.params![0], getUIComponentLink(placement("p4", { params: { label: "" } })), "p4");
        expect(value.origin).toBe("placement");
        expect(value.text).toBe("");
        expect(uiComponentTextValueUnitBinding(value)).toBeNull();
    });

    it("has no unit for words without a letter", () => {
        const value = readUIComponentTextValue(nav, nav.params![0], getUIComponentLink(placement("p5", { params: { label: "01" } })), "p5");
        expect(uiComponentTextValueUnitBinding(value)).toBeNull();
    });

    it("resolves only text parameters for the drawing", () => {
        const texts = resolveUIComponentTextParams(nav, getUIComponentLink(placement("p1", { params: { label: "Start", target: "save" } })), "p1");
        expect(Object.keys(texts).sort()).toEqual(["label", "unused"]);
        expect(texts.label.text).toBe("Start");
    });

    it("reads as the stored string - or the key's name - for a blueprint's Get Component Param", () => {
        expect(resolveUIComponentParams(nav, getUIComponentLink(placement("p1", { params: { label: "Start" } })))).toEqual({
            label: "Start",
            target: "title",
            unused: "Never shown",
        });
        expect(resolveUIComponentParams(nav, getUIComponentLink(placement("p2", { paramKeys: { label: "menu.title" } }))).label)
            .toBe("menu.title");
    });

    it("ignores a key named for a string parameter", () => {
        expect(resolveUIComponentParams(nav, getUIComponentLink(placement("p6", { paramKeys: { target: "menu.title" } }))).target)
            .toBe("title");
    });
});

describe("the placements' words every reader lists", () => {
    const document = { components: [nav] } as Pick<UIDocument, "components">;

    it("lists the text parameters a widget inside the definition shows, with the widgets that show them", () => {
        const values = listUIPlacementTextValues(document, placement("p1", { params: { label: "Start" } }));
        expect(values.map(entry => [entry.param.id, entry.value.text, entry.shownBy.map(shower => shower.id)])).toEqual([
            ["label", "Start", ["nav-label"]],
        ]);
    });

    it("lists nothing for an element that is not a placement, or a placement of a missing component", () => {
        expect(listUIPlacementTextValues(document, element("plain", "nl.text"))).toEqual([]);
        expect(listUIPlacementTextValues(document, element("lost", "nl.container", {
            extra: { componentLink: { componentId: "gone", linked: true } },
        }))).toEqual([]);
    });

    it("knows the bound widget's words as sample text, and which parameter they show", () => {
        const label = nav.elements["nav-label"];
        expect(uiTextComponentParamOf(label, TEXT_SITE)).toBe("label");
        expect(uiTextSampleCauseOf(label, TEXT_SITE, undefined)).toBe("componentParam");
    });

    it("lets a key the widget names win over the binding", () => {
        const keyed = { ...nav.elements["nav-label"], props: { localizationKey: "menu.title" } };
        expect(uiTextComponentParamOf(keyed, TEXT_SITE)).toBeNull();
    });
});

describe("a widget drawn with a parameter's value", () => {
    const bundle: GameLocalizationBundle = {
        sourceLocale: "zh",
        locales: [{ code: "zh" }, { code: "en" }] as never,
        tables: { en: { "ui:p1.param.label": "Start the journey", "key:menu.title": "Title", "ui:nav-label.text": "Sample, translated" } },
        keys: { "menu.title": "标题" },
    };

    it("hands the words on bound, with the placement's unit, and drops the sample's marks", () => {
        const label = { ...nav.elements["nav-label"], props: { text: "Sample", rich: [{ text: "Sample" }] } };
        const drawn = withUIComponentTextValue(label, TEXT_SITE, {
            origin: "placement",
            text: "开始旅程",
            key: "",
            unitId: "ui:p1.param.label",
        });
        expect((drawn.props as Record<string, unknown>).text).toBe("开始旅程");
        expect((drawn.props as Record<string, unknown>).rich).toBeUndefined();
        expect(uiTextRuntimeOriginOf(drawn)).toBe("bound");
        expect(uiTextRuntimeUnitOf(drawn)).toBe("ui:p1.param.label");
        const input = {
            site: TEXT_SITE,
            elementId: drawn.id,
            sourceText: "开始旅程",
            origin: uiTextRuntimeOriginOf(drawn),
            unitId: uiTextRuntimeUnitOf(drawn),
        };
        expect(resolveUITextWords(input, { kind: "game", bundle, locale: "en" })).toBe("Start the journey");
        expect(resolveUITextWords(input, { kind: "game", bundle, locale: "zh" })).toBe("开始旅程");
        expect(resolveUITextWords(input, { kind: "canvas", keys: null })).toBe("开始旅程");
    });

    it("hands a key on as the widget's own key, which reads the key everywhere", () => {
        const drawn = withUIComponentTextValue(nav.elements["nav-label"], TEXT_SITE, {
            origin: "placement",
            text: "",
            key: "menu.title",
            unitId: "ui:p2.param.label",
        });
        const props = drawn.props as Record<string, unknown>;
        expect(props.localizationKey).toBe("menu.title");
        expect(uiTextRuntimeUnitOf(drawn)).toBeUndefined();
        const input = { site: TEXT_SITE, elementId: drawn.id, sourceText: "", localizationKey: "menu.title", origin: uiTextRuntimeOriginOf(drawn) };
        expect(resolveUITextWords(input, { kind: "game", bundle, locale: "en" })).toBe("Title");
        expect(resolveUITextWords(input, { kind: "canvas", keys: { "menu.title": "标题" } })).toBe("标题");
    });

    it("shows nothing for a parameter the placement does not have, never the sample", () => {
        const drawn = withUIComponentTextValue(nav.elements["nav-label"], TEXT_SITE, undefined);
        expect((drawn.props as Record<string, unknown>).text).toBe("");
        expect(uiTextRuntimeUnitOf(drawn)).toBeUndefined();
    });
});
