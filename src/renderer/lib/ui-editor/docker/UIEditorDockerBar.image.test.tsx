// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { Circle } from "lucide-react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppearanceModel } from "@shared/types/ui-editor/appearance";
import type { UIDocument, UIElement, UISurface } from "@shared/types/ui-editor/document";
import { resolveImageRectangleLike } from "@/lib/ui-editor/runtime/appearance/AppearanceResolver";
import { DEFAULT_SYSTEM_INTERACTION_SIGNALS } from "@/lib/ui-editor/runtime/appearance/SystemInteractionState";
import { createImageDockerBarItems } from "@/lib/ui-editor/widget-modules/builtin/image/dockerBar";
import { ImageRenderer } from "@/lib/ui-editor/widget-modules/builtin/image/renderer";
import { createInitialImageAppearanceFromProps } from "@/lib/ui-editor/widget-modules/shared/appearance/initialAppearanceModel";
import { widgetModuleRegistry } from "@/lib/ui-editor/widget-modules/registryInstance";
import { UIEditorDockerBar } from "./UIEditorDockerBar";

vi.mock("@/lib/ui-editor/widget-modules/insertPalette", () => ({ listInsertPaletteEntries: () => [] }));
vi.mock("@/lib/workspace/hooks/useAssetObjectUrl", () => ({
    useAssetObjectUrl: () => ({ url: null, metadata: null, loading: false, error: null }),
}));
vi.mock("@/lib/workspace/services/ui-editor/UIEditorStateService", () => ({
    UIEditorStateService: {
        getInstance: () => ({ getEnteredState: () => null, getInteractionOverride: () => null, on: () => () => undefined }),
    },
}));

type Entered = { surfaceId: string; elementId: string; variantId: string | null } | null;

function image(id: string, radius: number, border: number): UIElement {
    const props = { borderRadius: radius, borderWidth: border, borderRadiusLinked: true };
    return {
        id, type: "nl.image", name: id, parentId: "host", childrenIds: [],
        layout: { x: 0, y: 0, width: 100, height: 100 },
        props: { ...props, appearance: createInitialImageAppearanceFromProps(props) },
    } as UIElement;
}

function harness(images: UIElement[]) {
    const host = {
        id: "host", type: "test.state-host", parentId: "root", childrenIds: images.map(item => item.id),
        layout: { x: 0, y: 0, width: 100, height: 100 }, props: {},
    } as UIElement;
    const root = { ...host, id: "root", type: "nl.root", parentId: null, childrenIds: ["host"] };
    const document = {
        surfaces: [{ id: "page", kind: "appSurface", rootElementId: "root" }],
        components: [],
        elements: Object.fromEntries([root, host, ...images].map(item => [item.id, item])),
    };
    const events = new Map<string, Set<(...args: never[]) => void>>();
    const listeners = new Set<() => void>();
    let entered: Entered = null;
    const stateService = {
        getSelection: () => ({ type: "element", data: { editor: "ui", surfaceId: "page", elementIds: images.map(item => item.id) } }),
        getTool: () => ({ kind: "select" }),
        getEnteredState: () => entered,
        on: (event: string, listener: (...args: never[]) => void) => {
            const set = events.get(event) ?? new Set();
            set.add(listener);
            events.set(event, set);
            return () => set.delete(listener);
        },
        enter: (next: Entered) => {
            entered = next;
            events.get("enteredStateChanged")?.forEach(listener => listener());
        },
    };
    const documentService = {
        getDocument: () => document,
        onDocumentChanged: (listener: () => void) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
        updateElementProps: (id: string, patch: Record<string, unknown>) => {
            const current = document.elements[id];
            document.elements[id] = { ...current, props: { ...current.props, ...patch } };
            listeners.forEach(listener => listener());
        },
    };
    const view = render(<UIEditorDockerBar surfaceId="page" stateService={stateService as never}
        documentService={documentService as never} enableComponents={false} />);
    return { document, stateService, view };
}

function displayed(element: UIElement, variantId: string | null = null) {
    return resolveImageRectangleLike(element, element.props?.appearance as AppearanceModel, {
        variantOverrideId: variantId,
        signals: DEFAULT_SYSTEM_INTERACTION_SIGNALS,
    });
}

async function commit(input: HTMLInputElement, value: number) {
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: String(value) } });
    fireEvent.blur(input);
    await waitFor(() => expect(input.value).toBe(String(value)));
}

beforeEach(() => {
    vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
    widgetModuleRegistry.register({
        type: "nl.image", displayName: "Image", icon: Circle,
        createDefaultElement: () => ({}), render: () => null, createDockerBarItems: createImageDockerBarItems,
    });
    widgetModuleRegistry.register({
        type: "test.state-host", displayName: "Host", icon: Circle,
        createDefaultElement: () => ({}), render: () => null,
        listEditorStates: () => [{ id: null, name: "Off" }, { id: "on", name: "On" }],
    });
});

afterEach(() => {
    cleanup();
    widgetModuleRegistry.unregister("nl.image");
    widgetModuleRegistry.unregister("test.state-host");
    vi.unstubAllGlobals();
});

describe("image Docker Bar appearance", () => {
    it("reads and updates the appearance used to paint radius and border", async () => {
        const item = image("image", 7, 4);
        item.props = { ...item.props, borderRadius: 0, borderWidth: 1 };
        const { document } = harness([item]);
        const [radius, border] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
        expect(radius.value).toBe("7");
        expect(border.value).toBe("4");
        await commit(radius, 18);
        await commit(border, 6);
        expect(displayed(document.elements.image)).toMatchObject({ borderRadius: 18, borderWidth: 6 });
        const markup = renderToStaticMarkup(<ImageRenderer element={document.elements.image}
            document={document as unknown as UIDocument} surface={document.surfaces[0] as UISurface}
            hostAdapter={{ host: "app" }} />);
        expect(markup).toContain("border-top-left-radius:18px");
        expect(markup).toContain("border-top-width:6px");
    });

    it("follows an ancestor's entered state and creates the missing variant", async () => {
        const { document, stateService } = harness([image("image", 7, 4)]);
        const radius = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
        act(() => stateService.enter({ surfaceId: "page", elementId: "host", variantId: "on" }));
        await commit(radius, 25);
        expect(displayed(document.elements.image, "on").borderRadius).toBe(25);
        expect(displayed(document.elements.image).borderRadius).toBe(7);
        act(() => stateService.enter(null));
        expect(radius.value).toBe("7");
        act(() => stateService.enter({ surfaceId: "page", elementId: "host", variantId: "on" }));
        expect(radius.value).toBe("25");
    });

    it("shows an existing state without changing either variant", () => {
        const item = image("image", 7, 4);
        const model = item.props!.appearance as AppearanceModel;
        const on = createInitialImageAppearanceFromProps({ borderRadius: 28, borderWidth: 6 }).variants[0];
        model.variants.push({ ...on, id: "on", name: "On" });
        const { document, stateService } = harness([item]);
        const before = structuredClone(document.elements.image.props);
        const [radius, border] = screen.getAllByRole("spinbutton") as HTMLInputElement[];
        act(() => stateService.enter({ surfaceId: "page", elementId: "host", variantId: "on" }));
        expect([radius.value, border.value]).toEqual(["28", "6"]);
        expect(document.elements.image.props).toEqual(before);
        act(() => stateService.enter({ surfaceId: "page", elementId: "image", variantId: "on" }));
        expect([radius.value, border.value]).toEqual(["28", "6"]);
    });

    it("updates every selected image using its own appearance", async () => {
        const { document } = harness([image("first", 3, 1), image("second", 8, 2)]);
        const radius = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
        expect(radius.value).toBe("");
        await commit(radius, 18);
        expect(displayed(document.elements.first).borderRadius).toBe(18);
        expect(displayed(document.elements.second).borderRadius).toBe(18);
    });

    it("refreshes a multi-selection when a state applies to only one image", async () => {
        const first = image("first", 3, 1);
        const second = image("second", 8, 2);
        second.parentId = "root";
        const on = createInitialImageAppearanceFromProps({ borderRadius: 12, borderWidth: 1 }).variants[0];
        (first.props!.appearance as AppearanceModel).variants.push({ ...on, id: "on", name: "On" });
        const { document, stateService } = harness([first, second]);
        const radius = screen.getAllByRole("spinbutton")[0] as HTMLInputElement;
        expect(radius.value).toBe("");
        act(() => stateService.enter({ surfaceId: "page", elementId: "host", variantId: "on" }));
        expect(radius.value).toBe("");
        await commit(radius, 12);
        expect(displayed(document.elements.first, "on").borderRadius).toBe(12);
        expect(displayed(document.elements.first).borderRadius).toBe(3);
        expect(displayed(document.elements.second).borderRadius).toBe(12);
        expect(radius.value).toBe("12");
        act(() => stateService.enter(null));
        expect(radius.value).toBe("");
        act(() => stateService.enter({ surfaceId: "page", elementId: "host", variantId: "on" }));
        expect(radius.value).toBe("12");
    });

    it("leaves independent corners unchanged when the radii are unlinked", async () => {
        const item = image("image", 7, 4);
        const model = item.props!.appearance as AppearanceModel;
        const variant = model.variants[0];
        for (const group of variant.propertyGroups) {
            if (group.key === "borderRadiusLinked") group.rows[0].value = false;
            if (group.key === "borderRadiusTL") group.rows[0].value = 3;
            if (group.key === "borderRadiusTR") group.rows[0].value = 5;
        }
        const { document } = harness([item]);
        await commit(screen.getAllByRole("spinbutton")[0] as HTMLInputElement, 20);
        expect(displayed(document.elements.image)).toMatchObject({
            borderRadius: 20, borderRadiusLinked: false, borderRadiusTL: 3, borderRadiusTR: 5,
        });
    });
});
