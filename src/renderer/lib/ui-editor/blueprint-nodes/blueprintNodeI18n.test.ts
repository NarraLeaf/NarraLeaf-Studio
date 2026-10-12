/**
 * Coverage guard for the render-time blueprint metadata lookups.
 *
 * `blueprintNodeI18n.ts` maps the English strings baked into node definitions onto
 * translation keys, and silently falls back to the English text when a string has no
 * mapping. That fallback is why the palette shipped for a long time with whole node
 * families (every Game preference getter/setter, every widget Get/Set pair) still in
 * English: nothing failed, they just rendered untranslated.
 *
 * The mapping is keyed by exact text, so it also rots when a node is renamed - the old
 * key keeps resolving for a display name nobody produces any more. Both failure modes
 * look identical from here: the resolver hands back what it was given.
 *
 * A translator that echoes the key it is asked for therefore detects a gap exactly when
 * the resolver returns its own input.
 */
import { afterEach, describe, expect, it } from "vitest";
import { i18nStore } from "@/lib/i18n/store";
import { allBuiltinBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/built-in";
import { indexBlueprintNodeTranslations } from "@/lib/ui-editor/blueprint-nodes/nodeTranslations";
import {
    resolveBlueprintCategoryLabel,
    resolveBlueprintLabel,
    resolveBlueprintNodeTitle,
} from "./blueprintNodeI18n";

const echoKey = ((key: string) => key) as never;

/**
 * Node titles that stay in their original form in every language: the arithmetic and
 * comparison operators, which are symbols rather than words.
 */
const UNTRANSLATED_TITLES = new Set(["+", "+1", "−", "−1", "×", "÷", "<", "=", ">", "≠", "≤", "≥"]);

/**
 * Labels that stay in their original form: single-letter operand pins (`A + B`),
 * coordinate axes, the placeholder for an empty select option, and the HTTP request
 * methods.
 *
 * The methods are protocol tokens rather than words. They are spelled this way in the
 * request the author is composing and in every API's documentation, so a translated
 * `GET` would name something that does not exist.
 */
const UNTRANSLATED_LABELS = new Set([
    "A", "B", "X", "Y", "-",
    "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD",
    "LB", "RB", "LT", "RT", "Back", "Start", "L3", "R3", "Home",
    "D-pad Up", "D-pad Down", "D-pad Left", "D-pad Right",
    "Left Stick Up", "Left Stick Down", "Left Stick Left", "Left Stick Right",
    "LeftX", "LeftY", "RightX", "RightY",
]);

function collectLabels(): Array<{ text: string; where: string }> {
    const out: Array<{ text: string; where: string }> = [];
    const push = (text: string | undefined, where: string) => {
        if (text) {
            out.push({ text, where });
        }
    };
    for (const def of allBuiltinBlueprintNodes) {
        for (const pin of def.pins ?? []) {
            push(pin.label, `${def.type}#${pin.id}`);
        }
        for (const param of def.inspectorParams ?? []) {
            push(param.label, `${def.type}!${param.key}`);
            push(param.emptyOptionLabel, `${def.type}!${param.key} (empty option)`);
            for (const option of param.options ?? []) {
                push(option.label, `${def.type}!${param.key}=${option.value}`);
            }
        }
        push(def.dynamicInputPins?.labelPrefix, `${def.type} (dynamic pin prefix)`);
        push(def.dynamicInputPins?.addButtonLabel, `${def.type} (add pin button)`);
    }
    return out;
}

describe("blueprint node i18n coverage", () => {
    it("maps every built-in node title", () => {
        const unmapped = allBuiltinBlueprintNodes
            .filter(def => !UNTRANSLATED_TITLES.has(def.displayName))
            .filter(def => resolveBlueprintNodeTitle(def.displayName, echoKey) === def.displayName)
            .map(def => `${def.displayName} (${def.type})`);
        expect(unmapped).toEqual([]);
    });

    it("maps every palette category", () => {
        const unmapped = [...new Set(allBuiltinBlueprintNodes.map(def => def.category))].filter(
            category => resolveBlueprintCategoryLabel(category, echoKey) === category,
        );
        expect(unmapped).toEqual([]);
    });

    it("maps every pin, inspector and option label", () => {
        const seen = new Set<string>();
        const unmapped = collectLabels()
            .filter(({ text }) => !UNTRANSLATED_LABELS.has(text))
            .filter(({ text }) => resolveBlueprintLabel(text, echoKey) === text)
            .filter(({ text }) => !seen.has(text) && seen.add(text))
            .map(({ text, where }) => `${text} (${where})`);
        expect(unmapped).toEqual([]);
    });
});

/**
 * A node the host did not define brings its own words. They are indexed by English text the same
 * way the host's tables are, so every reader that only holds a title or a label still finds them.
 */
describe("translations a node declares for itself", () => {
    indexBlueprintNodeTranslations({
        zh: {
            "Get Shelf Items": "获取货架物品",
            "Shelf": "货架",
            "Crate": "货箱",
            // The host already translates this one; its wording is kept.
            "Count": "计数",
        },
    });

    afterEach(() => {
        i18nStore.setLocale("en");
    });

    it("draws the declared wording in the active locale", () => {
        i18nStore.setLocale("zh");
        expect(resolveBlueprintNodeTitle("Get Shelf Items", echoKey)).toBe("获取货架物品");
        expect(resolveBlueprintCategoryLabel("Shelf", echoKey)).toBe("货架");
        expect(resolveBlueprintLabel("Crate", echoKey)).toBe("货箱");
    });

    it("translates a numbered label by its stem", () => {
        i18nStore.setLocale("zh");
        expect(resolveBlueprintLabel("Crate 2", echoKey)).toBe("货箱 2");
    });

    it("keeps the host's wording for a word the host translates", () => {
        i18nStore.setLocale("zh");
        expect(resolveBlueprintLabel("Count", echoKey)).toBe("blueprint.port.count");
    });

    it("falls back to English in a locale the node does not cover", () => {
        expect(resolveBlueprintNodeTitle("Get Shelf Items", echoKey)).toBe("Get Shelf Items");
        expect(resolveBlueprintLabel("Crate 2", echoKey)).toBe("Crate 2");
    });
});
