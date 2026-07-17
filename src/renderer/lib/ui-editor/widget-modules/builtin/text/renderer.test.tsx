// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
    UI_DOCUMENT_SCHEMA_VERSION,
    type UIDocument,
    type UISurface,
} from "@shared/types/ui-editor/document";
import type { UIElementSelection } from "@shared/types/ui-editor/selection";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";

/**
 * The workspace registers these services as singletons, so the editor tab's `hostAdapter` carries the
 * very same objects `getInstance()` would hand to every other renderer of the surface. Routing both
 * through one holder reproduces that coupling: if a renderer ever falls back to `getInstance()` again,
 * a preview will resolve the canvas's own services and the tests below will catch the revert.
 */
const singletons = vi.hoisted(() => ({
    stateService: null as unknown,
    documentService: null as unknown,
}));

vi.mock("@/lib/workspace/services/ui-editor/UIEditorStateService", () => ({
    UIEditorStateService: { getInstance: () => singletons.stateService },
}));

vi.mock("@/lib/workspace/services/ui-editor/UIDocumentService", () => ({
    UIDocumentService: { getInstance: () => singletons.documentService },
}));

vi.mock("@/apps/workspace/modules/properties/framework/utils/colorUtils", () => ({
    parseColorValue: (_raw: string | undefined, fallback: { hex: string; alpha?: number }) => fallback,
    colorValueToCss: (value: { hex: string; alpha?: number }) => value.hex,
}));

vi.mock("@/lib/workspace/hooks/useEditorFontFamily", () => ({
    useEditorFontFamily: () => ({ cssFamily: null, loading: false, error: null }),
}));

vi.mock("@/lib/ui-editor/hooks/useEditorAppearanceInspectorVariant", () => ({
    useEditorAppearanceInspectorVariant: () => null,
}));

import { beginInlineTextEdit } from "@/lib/ui-editor/interaction/inlineTextEdit";
import { TextRenderer } from "./renderer";

const SURFACE: UISurface = {
    id: "surface",
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 180 },
    rootElementId: "root",
};

type TextEditOverride = { kind: "textEdit"; surfaceId: string; elementId: string } | null;

function createDocument(text: string): UIDocument {
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
                childrenIds: ["text"],
                layout: { x: 0, y: 0, width: 320, height: 180 },
            },
            text: {
                id: "text",
                type: "nl.text",
                parentId: "root",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 120, height: 40 },
                props: { text },
            },
        },
    };
}

/** Stand-in for the singleton `UIEditorStateService`: only the members `TextRenderer` touches. */
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

/** Stand-in for the singleton `UIDocumentService`: mutates in place like `mutateDocument` does. */
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

type Services = {
    stateService: ReturnType<typeof createStateService>;
    documentService: ReturnType<typeof createDocumentService>;
};

/** Register the workspace singletons and hand back the services the editor tab puts on its adapter. */
function createServices(document: UIDocument): Services {
    const services = {
        stateService: createStateService(),
        documentService: createDocumentService(document),
    };
    singletons.stateService = services.stateService;
    singletons.documentService = services.documentService;
    return services;
}

function canvasHostAdapter({ stateService, documentService }: Services): UIHostAdapter {
    return {
        host: "app",
        editorStateService: stateService as never,
        editorDocumentService: documentService as never,
    };
}

/** How `UISurfacesPanel` / `ComponentLibraryPanel` render a surface: no editor services on the adapter. */
function previewHostAdapter(): UIHostAdapter {
    return { host: "app" };
}

function renderText(document: UIDocument, hostAdapter: UIHostAdapter) {
    return render(
        <TextRenderer
            element={document.elements.text}
            document={document}
            surface={SURFACE}
            hostAdapter={hostAdapter}
        />,
    );
}

/**
 * Drives `performance.now()` so a test can spend "time" in the textarea like a real user does.
 * Starts well past zero: the blur handler reads `editOpenedAtRef.current > 0` as "an edit is open",
 * so a clock at 0 would skip the opening-blur grace window that runs in the real app.
 */
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

describe("TextRenderer inline text edit", () => {
    it("commits the edited text when the canvas is the only renderer", () => {
        const document = createDocument("before");
        const services = createServices(document);
        const canvas = renderText(document, canvasHostAdapter(services));

        act(() => {
            beginInlineTextEdit(services.stateService as never, SURFACE.id, "text");
        });

        const textarea = canvas.container.querySelector("textarea");
        expect(textarea).not.toBeNull();

        fireEvent.change(textarea!, { target: { value: "after" } });
        clockMs += 1_000;
        act(() => {
            fireEvent.blur(textarea!);
        });

        expect(document.elements.text.props?.text).toBe("after");
    });

    it("does not let a preview of the same surface revert the edit on blur", () => {
        const document = createDocument("before");
        const services = createServices(document);
        // The surfaces panel previews every surface, including the one open in the editor tab.
        renderText(document, previewHostAdapter());
        const canvas = renderText(document, canvasHostAdapter(services));

        act(() => {
            beginInlineTextEdit(services.stateService as never, SURFACE.id, "text");
        });

        const textarea = canvas.container.querySelector("textarea");
        expect(textarea).not.toBeNull();

        fireEvent.change(textarea!, { target: { value: "after" } });
        clockMs += 1_000;
        act(() => {
            fireEvent.blur(textarea!);
        });

        expect(document.elements.text.props?.text).toBe("after");
    });

    it("does not let a preview of the same surface revert the edit when the override clears", () => {
        const document = createDocument("before");
        const services = createServices(document);
        const canvas = renderText(document, canvasHostAdapter(services));
        renderText(document, previewHostAdapter());

        act(() => {
            beginInlineTextEdit(services.stateService as never, SURFACE.id, "text");
        });

        const textarea = canvas.container.querySelector("textarea");
        expect(textarea).not.toBeNull();
        fireEvent.change(textarea!, { target: { value: "after" } });

        // Selecting another element clears the override without a blur reaching the textarea first.
        act(() => {
            services.stateService.setInteractionOverride(null);
        });

        expect(document.elements.text.props?.text).toBe("after");
    });

    it("mounts the editing textarea only in the editor canvas", () => {
        const document = createDocument("before");
        const services = createServices(document);
        const preview = renderText(document, previewHostAdapter());
        const canvas = renderText(document, canvasHostAdapter(services));

        act(() => {
            beginInlineTextEdit(services.stateService as never, SURFACE.id, "text");
        });

        // A second textarea for the same element would fight the canvas for focus and then commit
        // its own untouched draft over the real edit.
        expect(canvas.container.querySelectorAll("textarea")).toHaveLength(1);
        expect(preview.container.querySelector("textarea")).toBeNull();
        expect(preview.container.textContent).toContain("before");
    });
});
