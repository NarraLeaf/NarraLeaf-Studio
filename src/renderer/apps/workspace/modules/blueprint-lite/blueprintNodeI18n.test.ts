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
import { describe, expect, it } from "vitest";
import { allBuiltinBlueprintNodes } from "@/lib/ui-editor/blueprint-nodes/built-in";
import {
  resolveBlueprintCategoryLabel,
  resolveBlueprintLabel,
  resolveBlueprintNodeTitle
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
  "A",
  "B",
  "X",
  "Y",
  "-",
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD"
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
      .filter((def) => !UNTRANSLATED_TITLES.has(def.displayName))
      .filter((def) => resolveBlueprintNodeTitle(def.displayName, echoKey) === def.displayName)
      .map((def) => `${def.displayName} (${def.type})`);
    expect(unmapped).toEqual([]);
  });

  it("maps every palette category", () => {
    const unmapped = [...new Set(allBuiltinBlueprintNodes.map((def) => def.category))].filter(
      (category) => resolveBlueprintCategoryLabel(category, echoKey) === category
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
