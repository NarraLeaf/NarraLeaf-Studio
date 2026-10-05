import { describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "../localization";
import type { UIDocument, UIElement } from "./document";
import { uiTextSampleCauseOf, withoutUITextSamples, withoutUITextSampleUnits } from "./textSample";
import { requireUITextSite } from "./textSource";

/**
 * Sample text: which words a player never reads, and the promise that a package never carries them.
 * Only a binding makes an element's words sample text. Words a blueprint writes over while the game
 * runs are the element's default value - the game shows them until the first write - and ship.
 */

const TEXT = requireUITextSite("nl.text");
const BUTTON = requireUITextSite("nl.button");

function element(id: string, type: string, props: Record<string, unknown>, valueBindings?: UIElement["valueBindings"]): UIElement {
    return {
        id,
        type,
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 } as UIElement["layout"],
        props,
        ...(valueBindings ? { valueBindings } : {}),
    };
}

const BOUND = { text: { kind: "blueprintValue" as const, blueprintId: "bp-name", valueType: "string" as const } };

describe("uiTextSampleCauseOf", () => {
    it("calls the words under a value blueprint, a row field or a component parameter sample", () => {
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Narra" }, BOUND), TEXT)).toBe("blueprintValue");
        expect(uiTextSampleCauseOf(
            element("a", "nl.text", { text: "Narra" }, { text: { kind: "listItemField", fieldId: "name" } }),
            TEXT,
        )).toBe("listItemField");
        expect(uiTextSampleCauseOf(
            element("a", "nl.button", { label: "Item" }, { label: { kind: "componentParam", paramId: "label" } }),
            BUTTON,
        )).toBe("componentParam");
    });

    it("calls the words a blueprint writes over what a player reads, beside a bound element's sample", () => {
        // 「分数：0」 is replaced by Set Text on a click and 「自动播放：关」 by Set Label: both are shown
        // until then. Nothing about who writes them is asked - only the name tag's binding is.
        const score = element("score", "nl.text", { text: "分数：0" });
        const auto = element("auto", "nl.button", { label: "自动播放：关" });
        const nametag = element("nametag", "nl.text", { text: "Narra" }, BOUND);
        expect(uiTextSampleCauseOf(score, TEXT)).toBeNull();
        expect(uiTextSampleCauseOf(auto, BUTTON)).toBeNull();
        expect(uiTextSampleCauseOf(nametag, TEXT)).toBe("blueprintValue");
    });

    it("leaves a keyed element's words alone, binding or not", () => {
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Start", localizationKey: "menu.start" }, BOUND), TEXT)).toBeNull();
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Start" }), TEXT)).toBeNull();
    });

    it("is not asked about the dialogue line, whose site says it has sample words", () => {
        const sentence = requireUITextSite("nl.dialog.sentence");
        expect(uiTextSampleCauseOf(element("s", "nl.dialog.sentence", { text: "A line" }, BOUND), sentence)).toBeNull();
    });
});

describe("withoutUITextSamples", () => {
    function documentOf(elements: UIElement[], componentElements: UIElement[] = []): UIDocument {
        return {
            schemaVersion: 12,
            id: "doc",
            name: "Doc",
            surfaces: [],
            elements: Object.fromEntries(elements.map(entry => [entry.id, entry])),
            components: componentElements.length
                ? [{ id: "c", name: "Save slot", rootElementId: componentElements[0].id, elements: Object.fromEntries(componentElements.map(entry => [entry.id, entry])) }]
                : [],
        } as UIDocument;
    }

    it("never lets sample words reach the package, from either element table, and ships the words a blueprint writes over", () => {
        const document = documentOf(
            [
                element("nametag", "nl.text", { text: "SAMPLE-NAME", rich: [{ text: "SAMPLE-NAME" }] }, BOUND),
                element("speaker", "nl.text", { text: "SAMPLE-ROW" }, { text: { kind: "listItemField", fieldId: "speaker" } }),
                element("title", "nl.text", { text: "Your Game" }),
                // Set Text replaces the score on a click: until then the game shows these words.
                element("score", "nl.text", { text: "Score: 0", rich: [{ text: "Score: 0" }] }),
            ],
            [
                element("label", "nl.text", { text: "SAMPLE-PARAM" }, { text: { kind: "componentParam", paramId: "label" } }),
                // The slot's own graph writes the place name over this.
                element("place", "nl.text", { text: "The corridor", fontSize: 20 }),
            ],
        );

        const { document: shipped, unitIds } = withoutUITextSamples(document);

        expect(JSON.stringify(shipped)).not.toMatch(/SAMPLE-/);
        expect(shipped.elements.nametag.props).toEqual({ text: "" });
        expect(shipped.elements.speaker.props).toEqual({ text: "" });
        // Emptied rather than removed: a widget reads a missing prop as its default words.
        expect(shipped.components?.[0].elements.label.props).toEqual({ text: "" });
        // What a player reads ships as written: the words a blueprint writes over, marks and all.
        expect(shipped.elements.title).toBe(document.elements.title);
        expect(shipped.elements.score).toBe(document.elements.score);
        expect(shipped.components?.[0].elements.place).toBe(document.components?.[0].elements.place);
        expect([...unitIds].sort()).toEqual(["ui:label.text", "ui:nametag.text", "ui:speaker.text"]);
        // The authored document is not touched.
        expect(document.elements.nametag.props?.text).toBe("SAMPLE-NAME");
    });

    it("hands back the same document when nothing in it is sample", () => {
        const document = documentOf([element("title", "nl.text", { text: "Your Game" }), element("score", "nl.text", { text: "Score: 0" })]);
        expect(withoutUITextSamples(document).document).toBe(document);
    });
});

describe("withoutUITextSampleUnits", () => {
    it("drops the translations of sample words and keeps every other one", () => {
        const localization: GameLocalizationBundle = {
            sourceLocale: "en",
            locales: [],
            tables: {
                zh: { "ui:nametag.text": "示例名", "ui:title.text": "你的游戏", "key:menu.start": "开始" },
                ja: { "key:menu.start": "はじめる" },
            },
        };
        const out = withoutUITextSampleUnits(localization, new Set(["ui:nametag.text"]));
        expect(out?.tables).toEqual({
            zh: { "ui:title.text": "你的游戏", "key:menu.start": "开始" },
            ja: { "key:menu.start": "はじめる" },
        });
        expect(withoutUITextSampleUnits(localization, new Set())).toBe(localization);
    });
});
