import { describe, expect, it } from "vitest";
import type { GameLocalizationBundle } from "../localization";
import type { UIDocument, UIElement } from "./document";
import { uiTextSampleCauseOf, withoutUITextSamples, withoutUITextSampleUnits } from "./textSample";
import { requireUITextSite } from "./textSource";
import type { UITextWriter, UITextWriterIndex } from "./textWriters";

/**
 * Sample text: which words a player never reads, and the promise that a package never carries them.
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

function writer(effect: UITextWriter["effect"], textProp: UITextWriter["textProp"] = "text"): UITextWriter {
    return { blueprintId: "bp", graphKind: "event", graphId: "g", nodeId: "n", nodeType: "t", effect, textProp };
}

const BOUND = { text: { kind: "blueprintValue" as const, blueprintId: "bp-name", valueType: "string" as const } };

describe("uiTextSampleCauseOf", () => {
    it("calls the words under a value blueprint or a row field sample", () => {
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Narra" }, BOUND), TEXT, undefined)).toBe("blueprintValue");
        expect(uiTextSampleCauseOf(
            element("a", "nl.text", { text: "Narra" }, { text: { kind: "listItemField", fieldId: "name" } }),
            TEXT,
            undefined,
        )).toBe("listItemField");
    });

    it("calls the words a blueprint replaces sample, and keeps the words it only appends to", () => {
        const place = element("place", "nl.text", { text: "The corridor" });
        expect(uiTextSampleCauseOf(place, TEXT, [writer("replace")])).toBe("written");
        expect(uiTextSampleCauseOf(place, TEXT, [writer("append")])).toBeNull();
        expect(uiTextSampleCauseOf(place, TEXT, [writer("append"), writer("replace")])).toBe("written");
        expect(uiTextSampleCauseOf(element("b", "nl.button", { label: "Off" }), BUTTON, [writer("replace", "label")])).toBe("written");
    });

    it("leaves a keyed element's words alone, and the words a player reads", () => {
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Start", localizationKey: "menu.start" }, BOUND), TEXT, [writer("replace")])).toBeNull();
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Start" }), TEXT, undefined)).toBeNull();
        expect(uiTextSampleCauseOf(element("a", "nl.text", { text: "Start" }), TEXT, [])).toBeNull();
    });

    it("is not asked about the dialogue line, whose site says it has sample words", () => {
        const sentence = requireUITextSite("nl.dialog.sentence");
        expect(uiTextSampleCauseOf(element("s", "nl.dialog.sentence", { text: "A line" }, BOUND), sentence, [writer("replace")])).toBeNull();
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

    it("never lets sample words reach the package, from either element table", () => {
        const document = documentOf(
            [
                element("nametag", "nl.text", { text: "SAMPLE-NAME", rich: [{ text: "SAMPLE-NAME" }], localizable: true }, BOUND),
                element("speaker", "nl.text", { text: "SAMPLE-ROW" }, { text: { kind: "listItemField", fieldId: "speaker" } }),
                element("title", "nl.text", { text: "Your Game", localizable: true }),
                element("log", "nl.text", { text: "Log: " }),
            ],
            [element("place", "nl.text", { text: "SAMPLE-PLACE", fontSize: 20 })],
        );
        const writers: UITextWriterIndex = new Map([
            ["place", [writer("replace")]],
            ["log", [writer("append")]],
        ]);

        const { document: shipped, unitIds } = withoutUITextSamples(document, writers);

        expect(JSON.stringify(shipped)).not.toMatch(/SAMPLE-/);
        expect(shipped.elements.nametag.props).toEqual({ text: "" });
        expect(shipped.elements.speaker.props).toEqual({ text: "" });
        // Emptied rather than removed: a widget reads a missing prop as its default words.
        expect(shipped.components?.[0].elements.place.props).toEqual({ text: "", fontSize: 20 });
        // What a player reads ships as written, the start of an appended line included.
        expect(shipped.elements.title).toBe(document.elements.title);
        expect(shipped.elements.log).toBe(document.elements.log);
        expect([...unitIds].sort()).toEqual(["ui:nametag.text", "ui:place.text", "ui:speaker.text"]);
        // The authored document is not touched.
        expect(document.elements.nametag.props?.text).toBe("SAMPLE-NAME");
    });

    it("hands back the same document when nothing in it is sample", () => {
        const document = documentOf([element("title", "nl.text", { text: "Your Game" })]);
        expect(withoutUITextSamples(document, new Map()).document).toBe(document);
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
