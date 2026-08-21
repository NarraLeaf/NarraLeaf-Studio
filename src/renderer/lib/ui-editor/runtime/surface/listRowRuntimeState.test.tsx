// @vitest-environment jsdom
/**
 * Widget runtime state belongs to a row, not to the template every row is drawn from.
 *
 * Before the row context, `hovered` was recorded against the element id and every row read the same
 * flag back, so pointing at one row lit up all of them - and there was no way at all to say "this
 * row is the selected one", because nothing downstream of the list could tell the rows apart.
 *
 * The assertions read what a widget would read (`useWidgetRuntimeElementState`), so they fail if the
 * key stops carrying the row even when the store itself is behaving.
 */
import { render, cleanup, fireEvent } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UISurface } from "@shared/types/ui-editor/document";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import {
    useWidgetRuntimeElementKey,
    useWidgetRuntimeElementState,
    WidgetRuntimeStateProvider,
} from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import { ListRenderer } from "@/lib/ui-editor/widget-modules/builtin/list/renderer";
import { SurfaceElementTree } from "./SurfaceElementTree";

const SURFACE_ID = "surface";

const surface: UISurface = {
    id: SURFACE_ID,
    name: "Surface",
    host: "app",
    kind: "appSurface",
    designSize: { width: 320, height: 240 },
    rootElementId: "root",
};

function listDocument(): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        surfaces: [surface],
        structs: {
            "struct-1": {
                id: "struct-1",
                fields: [{ id: "f-id", key: "id", type: "string" }],
            },
        },
        elements: {
            root: {
                id: "root",
                type: "nl.root",
                parentId: null,
                childrenIds: ["list"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
            },
            list: {
                id: "list",
                type: "nl.list",
                parentId: "root",
                childrenIds: ["row"],
                layout: { x: 0, y: 0, width: 320, height: 240 },
                props: {
                    items: [{ id: "a" }, { id: "b" }, { id: "c" }],
                    itemStructId: "struct-1",
                    itemKeyFieldId: "f-id",
                },
            },
            row: {
                id: "row",
                type: "nl.probe",
                parentId: "list",
                childrenIds: [],
                layout: { x: 0, y: 0, width: 320, height: 30 },
                extra: { listSlot: "itemTemplate" },
            },
        },
    };
}

/** Reports what a real widget would read, as text the test can assert on. */
function Probe({ elementId }: { elementId: string }) {
    const key = useWidgetRuntimeElementKey(elementId);
    const state = useWidgetRuntimeElementState(elementId);
    return (
        <span data-testid="probe" data-key={key}>
            {state.signals.selected ? "selected" : "plain"}
        </span>
    );
}

function rendererRegistry(): ElementRendererRegistry {
    return new ElementRendererRegistry([
        { type: "nl.root", render: props => <>{props.children}</> },
        { type: "nl.probe", render: props => <Probe elementId={props.element.id} /> },
        { type: "nl.list", render: props => <ListRenderer {...props} /> },
    ]);
}

/**
 * A blueprint runtime is what makes the list treat itself as running rather than as a canvas
 * preview: selection is a runtime state, and the canvas deliberately draws the resting row.
 */
function hostAdapter(): UIHostAdapter {
    return {
        host: "app",
        blueprintRuntime: {
            surfaceId: SURFACE_ID,
            runtimeScopeId: "scope-1",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async () => undefined,
            hostApi: {},
        },
    } as unknown as UIHostAdapter;
}

function mount(document: UIDocument) {
    return render(
        <WidgetRuntimeStateProvider>
            <SurfaceElementTree
                document={document}
                surface={surface}
                rootElement={document.elements.root!}
                rendererRegistry={rendererRegistry()}
                hostAdapter={hostAdapter()}
                editorChrome={false}
            />
        </WidgetRuntimeStateProvider>,
    );
}

function probes(container: HTMLElement): HTMLElement[] {
    return [...container.querySelectorAll<HTMLElement>("[data-testid='probe']")];
}

beforeAll(() => {
    if (typeof globalThis.ResizeObserver === "undefined") {
        globalThis.ResizeObserver = class {
            public observe(): void {}
            public unobserve(): void {}
            public disconnect(): void {}
        } as unknown as typeof ResizeObserver;
    }
});

afterEach(() => cleanup());

describe("list row widget runtime state", () => {
    it("keys each row apart, so state cannot be shared by accident", () => {
        const { container } = mount(listDocument());
        const keys = probes(container).map(node => node.getAttribute("data-key"));
        expect(keys).toHaveLength(3);
        expect(new Set(keys).size).toBe(3);
    });

    it("marks only the clicked row as selected", () => {
        const { container } = mount(listDocument());
        expect(probes(container).map(node => node.textContent)).toEqual(["plain", "plain", "plain"]);

        const rows = [...container.querySelectorAll<HTMLElement>("[data-ui-list-item-index]")];
        fireEvent.click(rows[1]!);
        expect(probes(container).map(node => node.textContent)).toEqual(["plain", "selected", "plain"]);

        fireEvent.click(rows[2]!);
        expect(probes(container).map(node => node.textContent)).toEqual(["plain", "plain", "selected"]);
    });
});
