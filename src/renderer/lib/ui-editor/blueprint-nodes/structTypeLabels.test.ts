/**
 * The words a value type is shown with, held to the two promises `formatBlueprintValueTypeLabel`
 * makes: one word per type in Chinese and Japanese, and English exactly as it read before the words
 * existed - type ids beside pins and in messages, the picker words in the pickers.
 *
 * The coverage half walks every type an author can pick or meet on a built-in node, so a type added
 * later without a word fails here instead of reaching a Chinese card as a programmer's id.
 */
import { describe, expect, it } from "vitest";
import { createTranslator } from "@shared/i18n";
import { BLUEPRINT_VARIABLE_TYPE_OPTIONS } from "@shared/types/blueprint/variableTypes";
import { SAVE_SCHEMA_FIELD_TYPES } from "@shared/types/saveSchema";
import { UI_PAGE_PARAM_TYPES } from "@shared/types/ui-editor/pageParams";
import { UI_STRUCT_FIELD_TYPES } from "@shared/types/ui-editor/struct";
import { allBuiltinBlueprintNodes } from "./built-in";
import { BLUEPRINT_FN_PIN_VALUE_TYPE_OPTIONS } from "./built-in/fnNodes";
import { formatBlueprintValueTypeLabel } from "./structTypeLabels";

const en = createTranslator("en").t;
const zh = createTranslator("zh").t;
const ja = createTranslator("ja").t;

const STORY_VARIABLE_TYPES = ["boolean", "number", "string", "json"] as const;
const COMPONENT_PARAM_TYPES = ["string", "text", "audioTrack"] as const;

/** Every type an author picks from a list somewhere in the interface. */
const PICKED_TYPES = [
    ...BLUEPRINT_VARIABLE_TYPE_OPTIONS.map(option => option.value),
    ...BLUEPRINT_FN_PIN_VALUE_TYPE_OPTIONS,
    ...UI_STRUCT_FIELD_TYPES,
    ...UI_PAGE_PARAM_TYPES,
    ...SAVE_SCHEMA_FIELD_TYPES,
    ...STORY_VARIABLE_TYPES,
    ...COMPONENT_PARAM_TYPES,
];

/** Every value type a built-in node's pins carry, fixed or added on the card. */
function builtinPinTypes(): string[] {
    const types = new Set<string>();
    for (const def of allBuiltinBlueprintNodes) {
        for (const pin of def.pins ?? []) {
            if (pin.semantic === "data" && pin.valueType) {
                types.add(pin.valueType);
            }
        }
        const dynamic = def.dynamicInputPins;
        if (dynamic) {
            if (dynamic.valueType) {
                types.add(dynamic.valueType);
            }
            for (const template of dynamic.generatedPinTemplates ?? []) {
                if (template.valueType) {
                    types.add(template.valueType);
                }
            }
            for (const option of dynamic.pinValueTypeOptions ?? []) {
                types.add(option);
            }
        }
    }
    return [...types];
}

/** The names that are proper nouns in every language and so read the same as the id. */
const SPELLED_THE_SAME = new Set(["json"]);

describe("formatBlueprintValueTypeLabel", () => {
    it("keeps English as it was: type ids inline, picker words in pickers", () => {
        expect(formatBlueprintValueTypeLabel("string", en)).toBe("string");
        expect(formatBlueprintValueTypeLabel("float", en)).toBe("float");
        expect(formatBlueprintValueTypeLabel("element:nl.button", en)).toBe("element:nl.button");
        expect(formatBlueprintValueTypeLabel("ImageAsset|null", en)).toBe("ImageAsset|null");
        expect(formatBlueprintValueTypeLabel("array<string>", en)).toBe("string list");

        expect(formatBlueprintValueTypeLabel("string", en, "option")).toBe("String");
        expect(formatBlueprintValueTypeLabel("number", en, "option")).toBe("Number");
        expect(formatBlueprintValueTypeLabel("float", en, "option")).toBe("Float");
        expect(formatBlueprintValueTypeLabel("text", en, "option")).toBe("Text");
        expect(formatBlueprintValueTypeLabel("audioTrack", en, "option")).toBe("Audio track");
        expect(formatBlueprintValueTypeLabel("AnimationToken", en, "option")).toBe("AnimationToken");
        expect(formatBlueprintValueTypeLabel("json", en, "option")).toBe("JSON");
    });

    it("writes every built-in pin's type in English as its id, as the card always has", () => {
        for (const type of builtinPinTypes()) {
            if (type.includes("struct:")) {
                continue; // struct types have been named by their struct in every language all along
            }
            const element = /^array<(.+)>$/.exec(type)?.[1];
            expect(formatBlueprintValueTypeLabel(type, en), type).toBe(element ? `${element} list` : type);
        }
    });

    it("writes one word per type in Chinese and Japanese, inline and in a picker alike", () => {
        for (const type of [...PICKED_TYPES, ...builtinPinTypes()]) {
            for (const t of [zh, ja]) {
                expect(formatBlueprintValueTypeLabel(type, t), type).toBe(formatBlueprintValueTypeLabel(type, t, "option"));
            }
        }
        expect(formatBlueprintValueTypeLabel("string", zh)).toBe("字符串");
        expect(formatBlueprintValueTypeLabel("array<string>", zh)).toBe("字符串列表");
        expect(formatBlueprintValueTypeLabel("boolean", zh)).toBe("布尔值");
        expect(formatBlueprintValueTypeLabel("string", ja)).toBe("文字列");
    });

    it("gives the same word to the same kind of value across the type spaces", () => {
        for (const t of [zh, ja]) {
            // A list field's and a story variable's `number` is what a pin carries as `float`.
            expect(formatBlueprintValueTypeLabel("number", t)).toBe(formatBlueprintValueTypeLabel("float", t));
            expect(formatBlueprintValueTypeLabel("list", t)).toBe(formatBlueprintValueTypeLabel("array", t));
            expect(formatBlueprintValueTypeLabel("image", t)).toBe(formatBlueprintValueTypeLabel("ImageAsset|null", t));
            expect(formatBlueprintValueTypeLabel("color", t)).toBe(formatBlueprintValueTypeLabel("RGBAColor", t));
        }
    });

    it("tells a page's text param from a string in every language", () => {
        for (const t of [en, zh, ja]) {
            expect(formatBlueprintValueTypeLabel("text", t, "option")).not.toBe(formatBlueprintValueTypeLabel("string", t, "option"));
        }
    });

    it("has a word for every type an author picks or a built-in pin carries", () => {
        // The walk itself is checked, or an empty catalogue would pass.
        expect(builtinPinTypes()).toEqual(expect.arrayContaining(["string", "float", "Timer", "element:nl.button", "array<string>"]));
        const missing: string[] = [];
        for (const type of [...PICKED_TYPES, ...builtinPinTypes()]) {
            for (const [locale, t] of [["zh", zh], ["ja", ja]] as const) {
                if (formatBlueprintValueTypeLabel(type, t) === type && !SPELLED_THE_SAME.has(type)) {
                    missing.push(`${locale}: ${type}`);
                }
            }
        }
        expect(missing).toEqual([]);
    });

    it("names an element by its widget, and an element of no known widget as an element", () => {
        expect(formatBlueprintValueTypeLabel("element:plugin.unknown", zh)).toBe("元素");
        expect(formatBlueprintValueTypeLabel("element", ja)).toBe("要素");
    });

    it("shows a type no catalogue names as it is spelled", () => {
        for (const t of [en, zh, ja]) {
            expect(formatBlueprintValueTypeLabel("PluginThing", t)).toBe("PluginThing");
            expect(formatBlueprintValueTypeLabel("PluginThing", t, "option")).toBe("PluginThing");
        }
    });
});
