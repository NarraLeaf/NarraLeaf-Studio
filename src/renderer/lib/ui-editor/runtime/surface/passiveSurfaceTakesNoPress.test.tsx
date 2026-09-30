// @vitest-environment jsdom
/**
 * A passive surface takes no press, however it is laid out: a press over it reaches what is drawn
 * behind it, once.
 *
 * The notification slot is passive - toasts are something the game says, not something the player
 * operates - and it floats over the stage for the whole session. Passive used to mean that every
 * widget wrapper turned its pointer events off, but a wrapper is not the only box in the element
 * tree that turns them back on: the box a free-layout container lays its children out in does, and
 * so does every list row. On a copy of a real project, a notification slot holding one full-size free
 * container took 3 presses out of 3 on the stage, and the dialogue under it never advanced.
 *
 * jsdom has no layout, so the browser's rule is stated here (`landsOn`): a press goes to the topmost
 * element under the point that takes pointer events, and nothing inside an `inert` subtree does.
 * The surface, its element tree, the container, the list and its rows are the real ones.
 */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { UI_DOCUMENT_SCHEMA_VERSION, type UIDocument, type UIElement, type UISurface } from "@shared/types/ui-editor/document";
import { ElementRendererRegistry } from "@/lib/ui-editor/runtime/ElementRendererRegistry";
import { BuiltinElementRenderers } from "@/lib/ui-editor/runtime/builtin";
import { WidgetRuntimeStateProvider } from "@/lib/ui-editor/runtime/appearance/WidgetRuntimeStateContext";
import type { UIHostAdapter } from "@/lib/ui-editor/runtime/types";
import { ensureAnimationFramePolyfill } from "@/lib/ui-editor/runtime/testing/lifecycleTestKit";
import { installResizeObserverStub } from "@/lib/ui-editor/runtime/testing/drawingLabFixture";
import { GameSurfaceRenderer } from "./GameSurfaceRenderer";

function element(id: string, type: string, parentId: string | null, childrenIds: string[], more?: Partial<UIElement>): UIElement {
    return { id, type, parentId, childrenIds, layout: { x: 0, y: 0, width: 200, height: 60 }, ...more };
}

const FULL = { x: 0, y: 0, width: 1920, height: 1080 };

const surface = {
    id: "notifications",
    name: "Notifications",
    kind: "stageSurface",
    mount: { kind: "stageSlot", slotId: "notification" },
    designSize: { width: 1920, height: 1080 },
    rootElementId: "root",
    settings: { backgroundColor: "transparent" },
} as unknown as UISurface;

/**
 * The shipped notification slot's toast list, with a toast in it, and beside it a full-size
 * free-layout panel of the kind an author lays a slot out on.
 */
const document = {
    schemaVersion: UI_DOCUMENT_SCHEMA_VERSION,
    id: "doc",
    name: "Doc",
    surfaces: [surface],
    elements: {
        root: element("root", "nl.root", null, ["panel", "toasts"], { layout: FULL }),
        panel: element("panel", "nl.container", "root", ["panelLabel"], {
            layout: FULL,
            props: { layoutKind: "free", fillVisible: false, strokeVisible: false },
        }),
        panelLabel: element("panelLabel", "nl.text", "panel", [], { props: { text: "Chapter one" } }),
        toasts: element("toasts", "nl.notification.list", "root", ["toast"], {
            layout: { x: 1420, y: 56, width: 440, height: 400 },
            props: {
                itemStructId: "nl.notificationItem",
                itemKeyFieldId: "id",
                items: [{ id: "saved", message: "Saved" }],
            },
        }),
        toast: element("toast", "nl.container", "toasts", ["toastText"], {
            layout: { x: 0, y: 0, width: 440, height: 66 },
            props: { layoutKind: "free" },
            extra: { listSlot: "itemTemplate" },
        }),
        toastText: element("toastText", "nl.text", "toast", [], { props: { text: "Saved" } }),
    },
} as unknown as UIDocument;

/** Events a press raises on what it lands on - as against the lifecycle a drawn toast runs anyway. */
const PRESS_EVENT = /click|mouse|itemHover|selectionChanged/i;

/** A slot runtime that records every press-raised event that reaches it. */
function recordingSlot() {
    const elementEvents: string[] = [];
    const adapter = {
        host: "player",
        blueprintRuntime: {
            surfaceId: surface.id,
            runtimeScopeId: "slot-scope",
            setSurfaceState: () => undefined,
            getSurfaceState: () => undefined,
            emitDebug: () => undefined,
            dispatchElementBlueprintEvent: async (elementId: string, eventName: string) => {
                if (PRESS_EVENT.test(eventName)) {
                    elementEvents.push(`${elementId}:${eventName}`);
                }
            },
            dispatchSurfaceBlueprintEvent: async (eventName: string) => {
                if (PRESS_EVENT.test(eventName)) {
                    elementEvents.push(`surface:${eventName}`);
                }
            },
        },
    } as unknown as UIHostAdapter;
    return { adapter, elementEvents };
}

/** The stage under the slot, as the game draws it: every press that reaches it is the next line. */
function renderOverStage(passive: boolean) {
    const slot = recordingSlot();
    const stage = { advances: 0 };
    const view = render(
        <div data-testid="game">
            <div data-testid="stage" onClick={() => (stage.advances += 1)} />
            {/* NarraLeaf's own wrapper around the slot, pointer-events-none. */}
            <div data-testid="slot" style={{ pointerEvents: "none" }}>
                <WidgetRuntimeStateProvider>
                    <GameSurfaceRenderer
                        document={document}
                        surface={surface}
                        rendererRegistry={new ElementRendererRegistry(BuiltinElementRenderers)}
                        scale={1}
                        hostAdapter={slot.adapter}
                        passive={passive}
                        staticDocument
                    />
                </WidgetRuntimeStateProvider>
            </div>
        </div>,
    );
    return { container: view.container, slot, stage };
}

/** Whether the browser's hit test could stop at this element. */
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

/**
 * What a press lands on, given the element of the slot that is topmost at the press point: that
 * element and its ancestors, then the stage beneath the slot.
 */
function landsOn(container: HTMLElement, topmost: Element): Element | null {
    const stage = container.querySelector("[data-testid='stage']")!;
    const underPoint: Element[] = [];
    for (let current: Element | null = topmost; current && current !== container; current = current.parentElement) {
        if (current.getAttribute("data-testid") === "game") {
            break;
        }
        underPoint.push(current);
    }
    underPoint.push(stage);
    return underPoint.find(takesPointerEvents) ?? null;
}

/** The box a free-layout container lays its children out in, which is over the whole panel. */
function panelChildBox(container: HTMLElement): HTMLElement {
    const panel = container.querySelector<HTMLElement>("[data-ui-element-id='panel']")!;
    const box = Array.from(panel.querySelectorAll<HTMLElement>("div")).find(
        candidate => candidate.style.zIndex === "1" && candidate.style.position === "absolute",
    );
    if (!box) {
        throw new Error("no child box on the panel");
    }
    return box;
}

function toastRow(container: HTMLElement): HTMLElement {
    const row = container.querySelector<HTMLElement>("[data-ui-list-item-key]");
    if (!row) {
        throw new Error("no toast on screen");
    }
    return row;
}

beforeAll(() => {
    ensureAnimationFramePolyfill();
    installResizeObserverStub();
});

afterEach(() => cleanup());

describe("a passive surface over the stage", () => {
    it("has nothing a press can land on", () => {
        const { container } = renderOverStage(true);
        const shell = container.querySelector(".ui-editor-surface")!;

        // The two boxes that turned pointer events back on for themselves are there to be hit.
        expect(panelChildBox(container).style.pointerEvents).toBe("auto");
        expect(toastRow(container).style.pointerEvents).toBe("auto");
        expect([shell, ...Array.from(shell.querySelectorAll("*"))].filter(takesPointerEvents)).toEqual([]);
    });

    it("hands a press anywhere over it to the stage, once, and runs nothing of its own", () => {
        const { container, slot, stage } = renderOverStage(true);
        const pressedOn = [
            panelChildBox(container),
            container.querySelector("[data-ui-element-id='panelLabel']")!,
            toastRow(container),
            container.querySelector("[data-ui-element-id='toastText']")!,
        ];

        for (const topmost of pressedOn) {
            const target = landsOn(container, topmost);
            if (target) {
                fireEvent.click(target);
            }
        }

        expect(stage.advances).toBe(pressedOn.length);
        expect(slot.elementEvents).toEqual([]);
    });

    it("keeps presses where an interactive surface draws something", () => {
        // The control: the same layout, not passive, takes the press over its panel and its toast -
        // which is what a surface the player operates should do, and what made passive necessary.
        const { container, slot, stage } = renderOverStage(false);

        for (const topmost of [panelChildBox(container), toastRow(container)]) {
            const target = landsOn(container, topmost);
            expect(target).toBe(topmost);
            fireEvent.click(target!);
        }

        expect(stage.advances).toBe(0);
        expect(slot.elementEvents).toContain("toasts:itemClick");
    });
});
