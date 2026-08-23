// @vitest-environment jsdom
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement } from "@shared/types/ui-editor/document";
import type { UIHostAdapterBlueprintRuntime } from "@/lib/ui-editor/runtime/types";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { TextInputRenderer } from "./renderer";

vi.mock("@/apps/workspace/modules/properties/framework/utils/colorUtils", () => ({
    parseColorValue: (_raw: string | undefined, fallback: { hex: string; alpha?: number }) => fallback,
    colorValueToCss: (value: { hex: string; alpha?: number }) => value.hex,
}));

vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null, metadata: null, loading: false, error: null }),
}));

vi.mock("@/lib/workspace/hooks/useEditorFontFamily", () => ({
    useEditorFontFamily: () => ({ cssFamily: null, loading: false, error: null }),
}));

function createDocument(props?: Record<string, unknown>): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [
            {
                id: "surface",
                name: "Surface",
                host: "app",
                kind: "appSurface",
                designSize: { width: 320, height: 180 },
                rootElementId: "root",
            },
        ],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["textInput"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            textInput: {
                id: "textInput",
                type: "nl.textInput",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 220, height: 40 },
                props: {
                    value: "Ada",
                    placeholder: "Your name",
                    inputMode: "text",
                    maxLength: 0,
                    readOnly: false,
                    disabled: false,
                    textAlign: "left",
                    ...props,
                },
            },
        },
    };
}

function createBlueprintRuntime(): UIHostAdapterBlueprintRuntime {
    return {
        surfaceId: "surface",
        setSurfaceState: () => {},
        getSurfaceState: () => undefined,
        emitDebug: () => {},
        dispatchElementBlueprintEvent: async () => {},
    };
}

/** Lowercased so assertions do not hinge on how the renderer casts attribute names (`readOnly` vs `readonly`). */
function renderTextInput(document: UIDocument, blueprintRuntime?: UIHostAdapterBlueprintRuntime): string {
    const element = document.elements.textInput as UIElement;
    return renderToStaticMarkup(
        <WidgetRuntimeStateProvider>
            <TextInputRenderer
                element={element}
                document={document}
                surface={document.surfaces[0]!}
                hostAdapter={{ host: "app", blueprintRuntime }}
            />
        </WidgetRuntimeStateProvider>,
    ).toLowerCase();
}

describe("TextInputRenderer", () => {
    it("renders the authored value and placeholder", () => {
        const markup = renderTextInput(createDocument());

        expect(markup).toContain('value="ada"');
        expect(markup).toContain('placeholder="your name"');
        expect(markup).toContain('type="text"');
    });

    it("is inert on the editor canvas: a mounted store alone must not make the field live", () => {
        // The canvas mounts a WidgetRuntimeStateStore too — only `blueprintRuntime` marks a running game.
        const markup = renderTextInput(createDocument());

        expect(markup).toContain('readonly=""');
        expect(markup).toContain('tabindex="-1"');
        expect(markup).toContain("pointer-events:none");
    });

    it("becomes live once the host adapter carries a blueprint runtime", () => {
        const markup = renderTextInput(createDocument(), createBlueprintRuntime());

        expect(markup).not.toContain('readonly=""');
        expect(markup).not.toContain('tabindex="-1"');
        expect(markup).not.toContain("pointer-events:none");
    });

    it("keeps an authored read-only field read-only while live", () => {
        const markup = renderTextInput(createDocument({ readOnly: true }), createBlueprintRuntime());

        expect(markup).toContain('readonly=""');
        // Read only is not inert: the player can still focus it and the widget still gets focus/blur.
        expect(markup).not.toContain('tabindex="-1"');
    });

    it("masks a password field and hints the numeric keyboard for number mode", () => {
        expect(renderTextInput(createDocument({ inputMode: "password" }))).toContain('type="password"');

        const numberMarkup = renderTextInput(createDocument({ inputMode: "number", value: "42" }));
        // `type="number"` is deliberately avoided: partial input ("-", "1.") empties its DOM value.
        expect(numberMarkup).toContain('type="text"');
        expect(numberMarkup).toContain('inputmode="numeric"');
    });

    it("clamps the authored value to max length in code points", () => {
        // "👍".length is 2 UTF-16 units, so a DOM maxLength would truncate mid-surrogate.
        const markup = renderTextInput(createDocument({ value: "👍👍👍", maxLength: 2 }));

        expect(markup).toContain('value="👍👍"');
        expect(markup).not.toContain("maxlength");
    });
});

describe("TextInputRenderer submit and IME composition", () => {
    afterEach(cleanup);

    function renderLive(dispatch: (elementId: string, event: string, payload: unknown) => void) {
        const document = createDocument({ value: "" });
        const element = document.elements.textInput as UIElement;
        render(
            <WidgetRuntimeStateProvider>
                <TextInputRenderer
                    element={element}
                    document={document}
                    surface={document.surfaces[0]!}
                    hostAdapter={{
                        host: "app",
                        blueprintRuntime: {
                            ...createBlueprintRuntime(),
                            dispatchElementBlueprintEvent: async (elementId, event, payload) => {
                                dispatch(elementId, event, payload);
                            },
                        },
                    }}
                />
            </WidgetRuntimeStateProvider>,
        );
        return screen.getByPlaceholderText("Your name");
    }

    it("submits on Enter", () => {
        const events: string[] = [];
        fireEvent.keyDown(renderLive((_id, event) => events.push(event)), { key: "Enter" });

        expect(events).toEqual(["submit"]);
    });

    it("stays silent on the Enter that confirms an IME conversion", () => {
        // Naming the protagonist in Japanese: the first Enter turns kana into kanji and belongs to
        // the candidate window. Submitting on it hands the game the unconverted reading.
        const events: string[] = [];
        fireEvent.keyDown(renderLive((_id, event) => events.push(event)), { key: "Enter", isComposing: true });

        expect(events).toEqual([]);
    });

    it("stays silent on the legacy 229 keycode some layouts send instead", () => {
        const events: string[] = [];
        fireEvent.keyDown(renderLive((_id, event) => events.push(event)), { key: "Enter", keyCode: 229 });

        expect(events).toEqual([]);
    });
});
