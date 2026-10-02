/**
 * What the element picker writes onto an Element card or an element event head.
 *
 * Inside a component definition the element is picked on the component editor's surface, and the
 * picker used to store that id as it was. Every check at runtime compares a reference against the
 * definition's own surface, so a graph that used such a reference was refused the first time it ran.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import {
    buildUIComponentEditorSurfaceId,
    buildUIComponentSurfaceId,
    isUIElementRefInScope,
} from "@shared/types/ui-editor/componentInstanceKey";
import { readBlueprintElementRefParams } from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";
import { withPickedElement } from "./elementBindingSession";

describe("the element picker's answer", () => {
    it("stores an element picked inside a component definition under the definition's own surface", () => {
        const params = withPickedElement(undefined, {
            surfaceId: buildUIComponentEditorSurfaceId("slot"),
            elementId: "number",
            elementType: "nl.text",
        });

        expect(readBlueprintElementRefParams(params)).toEqual({
            surfaceId: buildUIComponentSurfaceId("slot"),
            elementId: "number",
            elementType: "nl.text",
        });
        // And so every placement of the definition may reach it.
        expect(isUIElementRefInScope(String(params.surfaceId), { surfaceId: "load", componentId: "slot" })).toBe(true);
    });

    it("stores an element picked on a page under that page", () => {
        const params = withPickedElement(undefined, { surfaceId: "settings", elementId: "panel", elementType: "nl.container" });

        expect(params.surfaceId).toBe("settings");
    });

    it("keeps whatever else the node carries", () => {
        const params = withPickedElement(
            { surfaceId: "old", elementId: "gone", elementType: "nl.text", note: "kept" },
            { surfaceId: "settings", elementId: "panel", elementType: "nl.container" },
        );

        expect(params).toEqual({ surfaceId: "settings", elementId: "panel", elementType: "nl.container", note: "kept" });
    });
});
