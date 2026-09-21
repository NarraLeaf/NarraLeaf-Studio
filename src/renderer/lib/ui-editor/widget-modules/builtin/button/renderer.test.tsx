// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UIElement,
    type UISurface,
} from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";

vi.mock("@/apps/workspace/modules/properties/framework/utils/colorUtils", () => ({
    parseColorValue: (_raw: string | undefined, fallback: { hex: string; alpha?: number }) => fallback,
    colorValueToCss: (value: { hex: string; alpha?: number }) => value.hex,
}));

vi.mock("@/lib/workspace/hooks/useEditorFontFamily", () => ({
    useEditorFontFamily: () => ({ cssFamily: null, loading: false, error: null }),
}));

vi.mock("@/lib/ui-editor/hooks/useEnteredElementState", () => ({
    useEnteredElementState: () => null,
}));

import { beginInlineTextEdit } from "@/lib/ui-editor/interaction/inlineTextEdit";
import { mergeElementWithBlueprintValues } from "@/lib/ui-editor/blueprint-runtime/BlueprintValueRuntimeStore";
import {
    GameLocalizationContext,
    type GameLocalizationRuntime,
} from "@/lib/ui-editor/runtime/localization/GameLocalizationContext";
import { ButtonRenderer } from "./renderer";

const SURFACE: UISurface = {
    id: "surface",
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 180 },
    rootElementId: "root",
};

const RUBY_LABEL = "山田さん";
const RUBY_RUNS = [
    { text: "山田", marks: { ruby: "やまだ" } },
    { text: "さん" },
];

function createDocument(props: Record<string, unknown>): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [SURFACE],
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["button"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            button: {
                id: "button",
                type: "nl.button",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 160, height: 48 },
                props: { ...props },
            },
        },
    };
}

type TextEditOverride = { kind: "textEdit"; surfaceId: string; elementId: string } | null;

/** Stand-in for `UIEditorStateService`: only the members the renderer touches. */
function createStateService() {
    let override: TextEditOverride = null;
    let selection: { type: string; data: UIElementSelection | null } = { type: "none", data: null };
    const listeners = new Set<(payload: { previous: TextEditOverride; next: TextEditOverride }) => void>();
    return {
        getInteractionOverride: () => override,
        setInteractionOverride(next: TextEditOverride) {
            const same =
                override?.kind === next?.kind &&
                override?.surfaceId === next?.surfaceId &&
                override?.elementId === next?.elementId;
            if (same) {
                return;
            }
            const previous = override;
            override = next;
            for (const listener of [...listeners]) {
                listener({ previous, next });
            }
        },
        on(event: string, listener: (payload: { previous: TextEditOverride; next: TextEditOverride }) => void) {
            if (event !== "interactionOverrideChanged") {
                return () => undefined;
            }
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        getSelection: () => selection,
        setUIElementSelection(data: UIElementSelection) {
            selection = { type: "element", data };
        },
    };
}

/** Stand-in for `UIDocumentService`: merges a props patch in place like `updateElementProps` does. */
function createDocumentService(document: UIDocument) {
    let revision = 0;
    const listeners = new Set<() => void>();
    return {
        getDocument: () => document,
        getRevision: () => revision,
        onDocumentChanged(listener: () => void) {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        updateElementProps(elementId: string, propsPatch: Record<string, unknown>) {
            const element = document.elements[elementId];
            element.props = { ...(element.props ?? {}), ...propsPatch };
            revision += 1;
            for (const listener of [...listeners]) {
                listener();
            }
        },
        clearElementBlueprintValueBinding: () => undefined,
    };
}

function renderButton(element: UIElement, document: UIDocument, hostAdapter: UIHostAdapter = { host: "app" }, wrap?: (node: ReactNode) => ReactNode) {
    const node = (
        <ButtonRenderer element={element} document={document} surface={SURFACE} hostAdapter={hostAdapter} />
    );
    return render(<>{wrap ? wrap(node) : node}</>);
}

/** A game in `locale`, whose table translates this button's label. */
function localizationRuntime(locale: string, translated: string): GameLocalizationRuntime {
    return {
        bundle: {
            sourceLocale: "ja",
            locales: [{ code: "ja" }, { code: "en" }] as never,
            tables: { en: { "ui:button.label": translated } },
        },
        getLocale: () => locale,
        subscribe: () => () => undefined,
    };
}

let clockMs = 5_000;

beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    clockMs = 5_000;
    vi.spyOn(performance, "now").mockImplementation(() => clockMs);
});

afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
});

describe("ButtonRenderer marked label", () => {
    it("draws the reading over the characters it was written for", () => {
        const document = createDocument({ label: RUBY_LABEL, rich: RUBY_RUNS });
        const { container } = renderButton(document.elements.button, document);
        const ruby = container.querySelector("ruby")!;
        expect(ruby).not.toBeNull();
        expect(ruby.querySelector("rt")!.textContent).toBe("やまだ");
        expect(ruby.textContent).toBe("やまだ山田");
        expect(container.querySelector(".nl-text-runs")!.textContent).toBe("やまだ山田さん");
        // The runs replace the paragraph rather than sitting beside it.
        expect(container.querySelector("p")).toBeNull();
    });

    it("sets each mark on the run that carries it, and leaves the label's own type to the box", () => {
        const document = createDocument({
            label: "abc",
            fontSize: 22,
            rich: [
                { text: "a", marks: { bold: true } },
                { text: "b", marks: { color: "#ff0000" } },
                { text: "c", marks: { emphasis: "dot" } },
            ],
        });
        const { container } = renderButton(document.elements.button, document);
        const words = [...container.querySelectorAll(".nl-text-runs > span")] as HTMLElement[];
        expect(words.map(word => word.textContent)).toEqual(["a", "b", "c"]);
        expect(words[0].style.fontWeight).toBe("bold");
        expect(words[1].style.color).toBe("rgb(255, 0, 0)");
        expect(words[2].style.textEmphasis).toBe("filled dot");
        // Size and colour are the label's, set once on the box the words inherit from.
        expect(words.every(word => word.style.fontSize === "")).toBe(true);
        const box = container.querySelector(".nl-text-runs")!.parentElement as HTMLElement;
        expect(box.style.fontSize).toBe("22px");
    });

    it("draws a plain label exactly as it did before labels could be marked", () => {
        const document = createDocument({ label: "Start" });
        const { container } = renderButton(document.elements.button, document);
        const paragraph = container.querySelector("p")!;
        expect(paragraph.textContent).toBe("Start");
        expect(paragraph.children).toHaveLength(0);
        expect(container.querySelector(".nl-text-runs")).toBeNull();
    });

    it("falls back to the plain label when the runs no longer spell it", () => {
        // What a blueprint that set the label at runtime, or a hand edit that knew nothing of the
        // marks, leaves behind: a label the stored runs do not spell.
        const document = createDocument({ label: "Continue", rich: RUBY_RUNS });
        const { container } = renderButton(document.elements.button, document);
        expect(container.querySelector(".nl-text-runs")).toBeNull();
        expect(container.querySelector("ruby")).toBeNull();
        expect(container.querySelector("p")!.textContent).toBe("Continue");
    });

    it("falls back to the plain label when the game is played in another language", () => {
        const document = createDocument({ label: RUBY_LABEL, rich: RUBY_RUNS, localizable: true });
        const wrap = (runtime: GameLocalizationRuntime) => (node: ReactNode) => (
            <GameLocalizationContext.Provider value={runtime}>{node}</GameLocalizationContext.Provider>
        );

        const translated = renderButton(document.elements.button, document, { host: "app" }, wrap(localizationRuntime("en", "Mr Yamada")));
        expect(translated.container.querySelector("ruby")).toBeNull();
        expect(translated.container.querySelector("p")!.textContent).toBe("Mr Yamada");
        translated.unmount();

        // In the source language the label is still the string the runs spell, so they draw.
        const source = renderButton(document.elements.button, document, { host: "app" }, wrap(localizationRuntime("ja", "Mr Yamada")));
        expect(source.container.querySelector("rt")!.textContent).toBe("やまだ");
    });

    it("falls back to the plain label when a list row's field drives it", () => {
        const document = createDocument({ label: RUBY_LABEL, rich: RUBY_RUNS });
        document.elements.button.valueBindings = { label: { kind: "listItemField", fieldId: "name" } };
        const row = mergeElementWithBlueprintValues(document.elements.button, SURFACE.id, null, {
            item: { name: "Save 3" },
            index: 2,
            count: 4,
            key: "row-2",
            struct: { id: "slot", fields: [{ id: "name", key: "name", type: "string" }] },
        });
        expect((row.props as { label?: string }).label).toBe("Save 3");

        const { container } = renderButton(row, document);
        expect(container.querySelector("ruby")).toBeNull();
        expect(container.querySelector("p")!.textContent).toBe("Save 3");
    });

    it("keeps the marks an inline edit on the canvas did not reach", () => {
        const document = createDocument({ label: "Hello world", rich: [{ text: "Hello " }, { text: "world", marks: { bold: true } }] });
        const services = { stateService: createStateService(), documentService: createDocumentService(document) };
        const hostAdapter: UIHostAdapter = {
            host: "app",
            editorStateService: services.stateService as never,
            editorDocumentService: services.documentService as never,
        };
        const canvas = renderButton(document.elements.button, document, hostAdapter);

        act(() => {
            beginInlineTextEdit(services.stateService as never, SURFACE.id, "button");
        });
        const textarea = canvas.container.querySelector("textarea")!;
        expect(textarea.value).toBe("Hello world");
        fireEvent.change(textarea, { target: { value: "Goodbye world" } });
        clockMs += 1_000;
        act(() => {
            fireEvent.blur(textarea);
        });

        expect(document.elements.button.props?.label).toBe("Goodbye world");
        expect(document.elements.button.props?.rich).toEqual([
            { text: "Goodbye " },
            { text: "world", marks: { bold: true } },
        ]);
    });
});
