import { describe, expect, it } from "vitest";
import type { FieldType } from "../types";
import { fieldReadOnlyStrategy, needsStructuralReadOnly } from "./fieldReadOnlyStrategy";

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
    "fontAsset",
];

describe("fieldReadOnlyStrategy", () => {
    it("lets the field types whose renderers thread `readOnly` do it themselves", () => {
        expect(fieldReadOnlyStrategy("text")).toBe("own");
        expect(fieldReadOnlyStrategy("number")).toBe("own");
        expect(fieldReadOnlyStrategy("inputGroup")).toBe("own");
        expect(fieldReadOnlyStrategy("colorPicker")).toBe("own");
        expect(fieldReadOnlyStrategy("fontAsset")).toBe("own");
    });

    it("clamps the ones that render caller-supplied JSX", () => {
        // The measured failure: Position (`inputGroup`) locked while Rotation and opacity (`inlineRow`)
        // in the same panel accepted input, because an `inlineRow` item is the caller's own JSX.
        expect(fieldReadOnlyStrategy("inlineRow")).toBe("structural");
        expect(fieldReadOnlyStrategy("custom")).toBe("structural");
        expect(fieldReadOnlyStrategy("iconButtonGroup")).toBe("structural");
        expect(fieldReadOnlyStrategy("menuTrigger")).toBe("structural");
        expect(fieldReadOnlyStrategy("imageFill")).toBe("structural");
    });

    it("answers for every field type in the union", () => {
        for (const type of ALL_FIELD_TYPES) {
            expect(["own", "structural"]).toContain(fieldReadOnlyStrategy(type));
        }
    });

    it("defaults an unknown type to the clamp, not to writable", () => {
        // The safe direction: over-clamping greys out something already read-only, under-clamping
        // offers a write inside a frozen project.
        expect(needsStructuralReadOnly("someFutureField" as FieldType)).toBe(true);
    });
});
