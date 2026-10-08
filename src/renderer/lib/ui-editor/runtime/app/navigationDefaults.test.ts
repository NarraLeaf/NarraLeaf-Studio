// @vitest-environment jsdom
/**
 * What the navigation actions do when nothing on screen answers them, and when they stand down: a
 * page that answers the press itself keeps it, a focused control takes Confirm for itself, Shift+Tab
 * is only Previous, and Back leaves a page but not the story.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import { resolveRuntimeInputVocabulary, uiNavigationActionId } from "@shared/types/ui-editor/navigation";
import { GAME_ROOT_ATTRIBUTE } from "@/lib/ui-editor/runtime/input/keyboardFocusHandover";
import { resolveGlobalInputActionPayloads, type UIInputSignal } from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import type { KeyboardOwner } from "./keyboardOwner";
import { claimNavigationConfirm, raisedNavigationIntents, runNavigationDefaults } from "./navigationDefaults";
import type { HostAdapterBundle } from "./types";

const PAGE: UISurface = {
    id: "page",
    name: "page",
    host: "app",
    kind: "appSurface",
    designSize: { width: 640, height: 360 },
    rootElementId: "root",
};

function mount() {
    document.body.innerHTML = `
        <div ${GAME_ROOT_ATTRIBUTE}>
            <div class="ui-editor-surface" data-ui-nav-scope="owner" tabindex="-1">
                <div id="a" role="button" tabindex="0" data-box="0,0,100,40"></div>
                <div id="b" role="button" tabindex="0" data-box="0,50,100,40"></div>
            </div>
        </div>
    `;
    for (const element of Array.from(document.querySelectorAll<HTMLElement>("[data-box]"))) {
        const [left, top, width, height] = element.dataset.box!.split(",").map(Number);
        element.getBoundingClientRect = () => ({
            left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({}),
        }) as DOMRect;
    }
    return {
        root: document.querySelector(`[${GAME_ROOT_ATTRIBUTE}]`)!,
        by: (id: string) => document.getElementById(id) as HTMLElement,
    };
}

function pageOwner(actions: UISurface["actions"] = [], pageBack = vi.fn(async () => undefined)): KeyboardOwner {
    const host = {
        hostAdapter: { blueprintRuntime: { hostApi: { navigation: { pageBack } } } },
        runtimeScopeId: "page:1",
    } as unknown as HostAdapterBundle;
    return { surface: { ...PAGE, actions }, host };
}

const GALLERY_NEXT: UIInputActionDef = { id: "galleryNext", name: "Next picture", bindings: [{ kind: "key", key: "ArrowDown" }] };

function press(signal: UIInputSignal, actions: Record<string, UIInputActionDef> = {}) {
    const vocabulary = resolveRuntimeInputVocabulary(actions);
    const actionIds = resolveGlobalInputActionPayloads({ vocabulary, signal }).map(action => action.actionId);
    return { vocabulary, signal, actionIds };
}

const key = (name: string, shiftKey = false): UIInputSignal => ({ kind: "key", event: { key: name, shiftKey } });
const pad = (button: string): UIInputSignal => ({ kind: "gamepad", button });

afterEach(() => {
    document.body.innerHTML = "";
});

describe("a navigation press nothing on screen answers", () => {
    it("moves the focus, by the arrows and by the pad", () => {
        const { root, by } = mount();
        const owner = pageOwner();
        expect(runNavigationDefaults({ gameRoot: root, owner, ...press(key("ArrowDown")) })).toBe(true);
        expect(document.activeElement).toBe(by("a"));
        expect(runNavigationDefaults({ gameRoot: root, owner, ...press(pad("D-pad Down")) })).toBe(true);
        expect(document.activeElement).toBe(by("b"));
        expect(runNavigationDefaults({ gameRoot: root, owner, ...press(pad("Left Stick Up")) })).toBe(true);
        expect(document.activeElement).toBe(by("a"));
    });

    it("is only Previous on Shift+Tab, though plain Tab's binding matches it too", () => {
        const shiftTab = press(key("Tab", true));
        expect(shiftTab.actionIds).toEqual(expect.arrayContaining([uiNavigationActionId("next"), uiNavigationActionId("previous")]));
        expect([...raisedNavigationIntents(shiftTab.actionIds)]).toEqual(["previous"]);
    });

    it("backs out of the page that holds the keys, and out of nothing on the stage", () => {
        const { root } = mount();
        const pageBack = vi.fn(async () => undefined);
        expect(runNavigationDefaults({ gameRoot: root, owner: pageOwner([], pageBack), ...press(pad("B")) })).toBe(true);
        expect(pageBack).toHaveBeenCalledTimes(1);
        expect(runNavigationDefaults({ gameRoot: root, owner: { stage: [] }, ...press(key("Escape")) })).toBe(false);
    });
});

describe("a page that answers the press itself", () => {
    it("keeps it, whether it answers a navigation action or its own action on the same key", () => {
        const { root } = mount();
        const answersDown = pageOwner([{ actionId: uiNavigationActionId("down") }]);
        expect(runNavigationDefaults({ gameRoot: root, owner: answersDown, ...press(key("ArrowDown")) })).toBe(false);

        const gallery = pageOwner([{ actionId: GALLERY_NEXT.id }]);
        const pressed = press(key("ArrowDown"), { [GALLERY_NEXT.id]: GALLERY_NEXT });
        expect(runNavigationDefaults({ gameRoot: root, owner: gallery, ...pressed })).toBe(false);
        expect(document.activeElement).toBe(document.body);
    });
});

describe("Confirm", () => {
    it("is a focused control's to take, and nobody's while nothing is focused", () => {
        const { root, by } = mount();
        const clicked = vi.fn();
        by("a").addEventListener("click", clicked);
        const confirm = press(pad("A")).actionIds;
        expect(claimNavigationConfirm(root, confirm)).toBe(false);
        runNavigationDefaults({ gameRoot: root, owner: pageOwner(), ...press(pad("D-pad Down")) });
        expect(claimNavigationConfirm(root, confirm)).toBe(true);
        // `a` answers no Enter of its own, so the press clicks it.
        expect(clicked).toHaveBeenCalledTimes(1);
    });
});
