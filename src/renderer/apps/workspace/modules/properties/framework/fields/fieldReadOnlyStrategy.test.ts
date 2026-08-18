import { describe, expect, it } from "vitest";
import type { FieldType } from "../types";
import {
  fieldReadOnlyStrategy,
  fieldTypeReadOnlyStrategy,
  needsStructuralReadOnly,
  selfReadOnly
} from "./fieldReadOnlyStrategy";

/** Every member of the union, so a new field type arrives here as a decision rather than a default. */
const ALL_FIELD_TYPES: FieldType[] = [
  "text",
  "textarea",
  "number",
  "checkbox",
  "select",
  "tags",
  "custom",
  "info",
  "thumbnail",
  "section",
  "colorPicker",
  "colorPickerGroup",
  "iconButtonGroup",
  "dropdownGroup",
  "menuTrigger",
  "inputGroup",
  "inlineRow",
  "imageFill",
  "fontAsset"
];

describe("fieldTypeReadOnlyStrategy", () => {
  it("lets the field types whose renderers thread `readOnly` do it themselves", () => {
    expect(fieldTypeReadOnlyStrategy("text")).toBe("own");
    expect(fieldTypeReadOnlyStrategy("number")).toBe("own");
    expect(fieldTypeReadOnlyStrategy("inputGroup")).toBe("own");
    expect(fieldTypeReadOnlyStrategy("colorPicker")).toBe("own");
    expect(fieldTypeReadOnlyStrategy("fontAsset")).toBe("own");
  });

  it("clamps the ones that render caller-supplied JSX", () => {
    // The measured failure: Position (`inputGroup`) locked while Rotation and opacity (`inlineRow`)
    // in the same panel accepted input, because an `inlineRow` item is the caller's own JSX.
    expect(fieldTypeReadOnlyStrategy("inlineRow")).toBe("structural");
    expect(fieldTypeReadOnlyStrategy("custom")).toBe("structural");
    expect(fieldTypeReadOnlyStrategy("iconButtonGroup")).toBe("structural");
    expect(fieldTypeReadOnlyStrategy("menuTrigger")).toBe("structural");
    expect(fieldTypeReadOnlyStrategy("imageFill")).toBe("structural");
  });

  it("answers for every field type in the union", () => {
    for (const type of ALL_FIELD_TYPES) {
      expect(["own", "structural"]).toContain(fieldTypeReadOnlyStrategy(type));
    }
  });
});

describe("fieldReadOnlyStrategy", () => {
  it("defaults an unknown type to the clamp, not to writable", () => {
    // The safe direction: over-clamping greys out something already read-only, under-clamping
    // offers a write inside a frozen project.
    expect(needsStructuralReadOnly({ type: "someFutureField" as FieldType })).toBe(true);
  });

  it("clamps a custom field whose component says nothing", () => {
    const Plain = () => null;
    expect(fieldReadOnlyStrategy({ type: "custom", component: Plain })).toBe("structural");
    expect(needsStructuralReadOnly({ type: "custom", component: Plain })).toBe(true);
  });

  it("leaves a custom field alone once its component declares it manages read-only", () => {
    // The blueprint entry a widget shows in its Interaction tab: a preview and a way into
    // another editor, both of which are reading. Clamped, a frozen workspace could select an
    // element and not open its blueprint.
    const Aware = selfReadOnly(() => null);
    expect(fieldReadOnlyStrategy({ type: "custom", component: Aware })).toBe("own");
    expect(needsStructuralReadOnly({ type: "custom", component: Aware })).toBe(false);
  });

  it("marks the component itself, so a copied field definition cannot drop the declaration", () => {
    const Aware = selfReadOnly(() => null);
    expect(Aware.readOnlyStrategy).toBe("own");
    // Two definitions, written independently, both inherit it.
    expect(fieldReadOnlyStrategy({ type: "custom", component: Aware })).toBe("own");
    expect(fieldReadOnlyStrategy({ type: "custom", component: Aware })).toBe("own");
  });
});
