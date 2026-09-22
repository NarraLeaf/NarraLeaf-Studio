// @vitest-environment jsdom
/**
 * A press made while a frame changes page goes to the page the frame is going to, or nowhere - never
 * to the frame, and never to what the frame is on.
 *
 * A page a frame is leaving no longer takes input, but it is still drawn, and its elements still
 * take the press: with no handler of their own left, the press became the frame's. The frame's
 * click walks up the element tree and the surface the frame is on answers it with its own actions -
 * so on a dialogue box that advances on a click, pressing the page's Close button a second time as
 * the page faded out advanced a line the player never read. Measured on a copy of a real project, a
 * frame on the dialogue slot cleared to nothing: 3 presses of 3 on the fading page's button advanced
 * the story, where the same button at rest advances nothing.
 *
 * The surface here is a stage surface that answers `advance` on a click, as a dialogue box does, and
 * `advance` firing is the line advancing. jsdom has no layout, so the browser's rule is stated here
 * (`landsOn`): a press goes to the element under the point that takes pointer events, nothing in an
 * `inert` subtree does, and what is under the topmost element is its parent box. The element tree,
 * the frame, the animation layers and the surface's input lane are the real ones.
 */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import { DEFAULT_UI_PAGE_ANIMATION_SETTINGS } from "@shared/types/ui-editor/pageAnimation";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { GameSurfaceRenderer } from "./GameSurfaceRenderer";

const CROSS_FADE = {
    ...DEFAULT_UI_PAGE_ANIMATION_SETTINGS,
    enter: "fade" as const,
    enterDurationSeconds: 0.6,
    exit: "fade" as const,
    exitDurationSeconds: 0.6,
    exitBlocking: false,
};

const ADVANCE: UIInputActionDef = {
    id: "advance",
    name: "Advance",
    bindings: [{ kind: "pointer", gesture: "click" }],
};

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 60 }, ...more };
}

function pageOf(id: string, rootElementId: string): UISurface {
    return {
        id,
        name: id,
        host: "app",
        kind: "appSurface",
        designSize: { width: 640, height: 360 },
        rootElementId,
        settings: { pageAnimation: CROSS_FADE },
    } as UISurface;
}

const dialogue = {
    id: "dialogue",
    name: "Dialogue",
    host: "player",
    kind: "stageSurface",
    mount: { kind: "slot", slotId: "dialog" },
    designSize: { width: 1280, height: 720 },
    rootElementId: "dialogueRoot",
    actions: [{ actionId: "advance" }],
} as unknown as UISurface;

/** A dialogue box with a frame on it, pointed at one of two pages or at none. */
function documentShowing(targetSurfaceId: string | null): UIDocument {
    return {
        schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
        id: "doc",
        name: "Doc",
        actions: { advance: ADVANCE },
        surfaces: [dialogue, pageOf("tabA", "tabARoot"), pageOf("tabB", "tabBRoot")],
        elements: {
            dialogueRoot: element("dialogueRoot", "nl.root", null, ["frame"], { layout: { x: 0, y: 0, width: 1280, height: 720 } }),
            frame: element("frame", "nl.frame", "dialogueRoot", [], {
                layout: { x: 0, y: 0, width: 640, height: 360 },
                props: { targetSurfaceId },
            }),
            tabARoot: element("tabARoot", "nl.root", null, ["close", "note"]),
            close: element("close", "nl.button", "tabARoot", [], { props: { label: "Close" } }),
            note: element("note", "nl.text", "tabARoot", [], {
                layout: { x: 0, y: 100, width: 200, height: 60 },
                props: { text: "Note" },
            }),
            tabBRoot: element("tabBRoot", "nl.root", null, ["open", "caption"]),
            open: element("open", "nl.button", "tabBRoot", [], { props: { label: "Open" } }),
            caption: element("caption", "nl.text", "tabBRoot", [], {
                layout: { x: 0, y: 100, width: 200, height: 60 },
                props: { text: "Caption" },
            }),
        },
    } as unknown as UIDocument;
}

/** Events a press raises on what it lands on - as against the lifecycle a drawn page runs anyway. */
const PRESS_EVENT = /click|mouse/i;

function renderDialogue(initialTarget: string | null) {
    const presses: string[] = [];
    const advances: string[] = [];
    const adapter = {
        host: "player",
        blueprintRuntime: {
            surfaceId: dialogue.id,
            runtimeScopeId: "dialogue-scope",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async (elementId: string, eventName: string) => {
                if (PRESS_EVENT.test(eventName)) {
                    presses.push(`${elementId}:${eventName}`);
                }
            },
            dispatchSurfaceBlueprintEvent: async () => undefined,
            dispatchSurfaceInputAction: async (payload: { actionId: string }) => {
                advances.push(payload.actionId);
            },
        },
    } as unknown as UIHostAdapter;
    const registry = new ElementRendererRegistry(BuiltinElementRenderers);
    const tree = (document: UIDocument) => (
        <WidgetRuntimeStateProvider>
            <GameSurfaceRenderer
                document={document}
                surface={dialogue}
                rendererRegistry={registry}
                scale={1}
                hostAdapter={adapter}
                staticDocument
            />
        </WidgetRuntimeStateProvider>
    );
    const view = render(tree(documentShowing(initialTarget)));
    return {
        container: view.container,
        presses,
        advances,
        showPage: (target: string | null) => view.rerender(tree(documentShowing(target))),
    };
}

function layerOf(container: HTMLElement, surfaceId: string): HTMLElement | null {
    return container.querySelector<HTMLElement>(`[data-ui-surface-id="${surfaceId}"][data-ui-surface-prepaint]`);
}

function isLeaving(layer: HTMLElement | null): boolean {
    return Boolean(layer && Number(layer.style.zIndex) >= 30);
}

/** The label or text a player aims at, on the given page. */
function drawn(container: HTMLElement, surfaceId: string, text: string): HTMLElement {
    const layer = layerOf(container, surfaceId);
    const node = layer
        ? Array.from(layer.querySelectorAll<HTMLElement>("*"))
            .filter(candidate => candidate.children.length === 0)
            .find(candidate => candidate.textContent?.trim() === text)
        : undefined;
    if (!node) {
        throw new Error(`no "${text}" on ${surfaceId}`);
    }
    return node;
}

function takesPointerEvents(node: Element): boolean {
    if (node.closest("[inert]")) {
        return false;
    }
    for (let current: Element | null = node; current; current = current.parentElement) {
        const value = (current as HTMLElement).style?.pointerEvents;
        if (value) {
            return value !== "none";
        }
    }
    return true;
}

/** What a press lands on, given the element drawn topmost at the press point. */
function landsOn(container: HTMLElement, topmost: Element): Element | null {
    for (let current: Element | null = topmost; current && current !== container; current = current.parentElement) {
        if (takesPointerEvents(current)) {
            return current;
        }
    }
    return null;
}

function press(container: HTMLElement, topmost: Element): void {
    const target = landsOn(container, topmost);
    if (target) {
        fireEvent.click(target);
    }
}

async function settle(ms = 20): Promise<void> {
    await act(async () => {
        await new Promise(resolve => setTimeout(resolve, ms));
    });
}

async function pageShown(container: HTMLElement, surfaceId: string): Promise<void> {
    await waitFor(() => expect(layerOf(container, surfaceId)?.dataset.uiSurfacePrepaint).toBe("ready"));
    await settle();
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
    installResizeObserverStub();
    (globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

afterEach(() => cleanup());

describe("a frame on a dialogue box", () => {
    it("at rest, advances on a press on its page's text and not on its page's button", async () => {
        const dialogueBox = renderDialogue("tabA");
        await pageShown(dialogueBox.container, "tabA");

        press(dialogueBox.container, drawn(dialogueBox.container, "tabA", "Close"));
        expect(dialogueBox.advances).toEqual([]);
        expect(dialogueBox.presses).toContain("close:mouseClick");

        press(dialogueBox.container, drawn(dialogueBox.container, "tabA", "Note"));
        expect(dialogueBox.advances).toEqual(["advance"]);
    });

    it("advances nothing on a press on its page as the page is cleared away, and then advances again", async () => {
        const dialogueBox = renderDialogue("tabA");
        await pageShown(dialogueBox.container, "tabA");

        dialogueBox.showPage(null);
        await waitFor(() => expect(isLeaving(layerOf(dialogueBox.container, "tabA"))).toBe(true));
        await settle();
        const leaving = layerOf(dialogueBox.container, "tabA")!;
        const close = drawn(dialogueBox.container, "tabA", "Close");
        const note = drawn(dialogueBox.container, "tabA", "Note");
        press(dialogueBox.container, close);
        press(dialogueBox.container, note);

        // Nothing on the page on its way out can be pressed: a press over it reaches what is under
        // it, which here is the frame's own box.
        expect(Array.from(leaving.querySelectorAll("*")).filter(takesPointerEvents)).toEqual([]);
        expect(layerOf(dialogueBox.container, "tabA")).not.toBeNull();
        expect(dialogueBox.advances).toEqual([]);
        expect(dialogueBox.presses).toEqual([]);

        // Once the page has gone, a press on the frame is a press on the dialogue box again.
        await waitFor(() => expect(layerOf(dialogueBox.container, "tabA")).toBeNull(), { timeout: 3000 });
        const frame = dialogueBox.container.querySelector("[data-ui-element-id='frame']")!;
        press(dialogueBox.container, frame.querySelector("[data-ui-frame-page-box]") ?? frame);
        expect(dialogueBox.advances).toEqual(["advance"]);
    });

    it("hands a press on the page it changes to to that page, and advances nothing", async () => {
        const dialogueBox = renderDialogue("tabA");
        await pageShown(dialogueBox.container, "tabA");

        dialogueBox.showPage("tabB");
        await pageShown(dialogueBox.container, "tabB");
        await waitFor(() => expect(isLeaving(layerOf(dialogueBox.container, "tabA"))).toBe(true));
        press(dialogueBox.container, drawn(dialogueBox.container, "tabB", "Open"));
        press(dialogueBox.container, drawn(dialogueBox.container, "tabB", "Caption"));

        expect(layerOf(dialogueBox.container, "tabA")).not.toBeNull();
        expect(dialogueBox.presses).toContain("open:mouseClick");
        expect(dialogueBox.advances).toEqual([]);
    });
});
