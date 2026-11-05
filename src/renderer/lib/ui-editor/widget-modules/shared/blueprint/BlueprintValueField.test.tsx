// @vitest-environment jsdom
/**
 * A Blueprint Value the author has just made opens in a tab of its own.
 *
 * Opening a blueprint is navigation, so it lands in the preview tab the next blueprint opened takes
 * over - except a blueprint the author has just created, whose creation was the intent a preview
 * waits for (`BlueprintOpenOptions.preview`). The binding control opened its new blueprint as a
 * preview, and opening any other blueprint next replaced it.
 *
 * Comments in English per project convention.
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIInspectorData } from "@/lib/ui-editor/widget-modules/types";

const openBlueprint = vi.fn();

vi.mock("@/apps/workspace/modules/blueprint-lite/hooks/useOpenBlueprintTarget", () => ({
    useOpenBlueprintTarget: () => openBlueprint,
}));
vi.mock("@/apps/workspace/modules/blueprint-lite/hooks/useBlueprintDocumentRevision", () => ({
    useBlueprintDocumentRevision: () => 0,
}));
vi.mock("@/apps/workspace/context", () => ({
    useWorkspace: () => ({ context: null, isInitialized: false }),
}));

const { useBlueprintValueBinding } = await import("./BlueprintValueField");

const element = {
    id: "text",
    type: "nl.text",
    parentId: "root",
    childrenIds: [],
    layout: { x: 0, y: 0, width: 100, height: 20 },
    props: { text: "Hello" },
} as unknown as UIElement;

function inspectorData(): UIInspectorData {
    return {
        surfaceId: "surface",
        element,
        documentService: {
            getDocument: () => ({ elements: { text: element } }),
            ensureElementBlueprintValueBinding: () => ({ blueprintId: "bp-new" }),
        },
    } as unknown as UIInspectorData;
}

afterEach(() => {
    openBlueprint.mockReset();
});

describe("the Blueprint Value control", () => {
    it("opens the blueprint it creates as a tab of its own, not a preview", () => {
        const { result } = renderHook(() => useBlueprintValueBinding({
            propPath: "text",
            valueType: "string",
            valueLabel: "text",
            title: "widgets.blueprintValue.textTitle",
            getDisplayName: () => "Text",
            getLiteralValue: () => "Hello",
        }, inspectorData()));

        act(() => {
            result.current.create();
        });

        expect(openBlueprint).toHaveBeenCalledTimes(1);
        expect(openBlueprint.mock.calls[0]![0]).toMatchObject({ blueprintId: "bp-new", ownerKind: "widgetValue" });
        expect(openBlueprint.mock.calls[0]![1]).toEqual({ preview: false });
    });
});
