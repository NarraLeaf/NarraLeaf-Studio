// @vitest-environment jsdom
/**
 * What the navigation slots do when nothing on screen answers the intents that fill them, and when
 * they stand down: a project that fills no slot has no navigation, a page that answers the press
 * itself keeps it, a focused control takes Confirm for itself, Shift+Tab is only Previous, and Back
 * leaves a page but not the story.
 *
 * Comments in English per project convention.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { UISurface } from "@shared/types/ui-editor/document";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import {
    raisedUINavigationSlots,
    UI_NAVIGATION_SLOT_PRESET_BINDINGS,
    UI_NAVIGATION_SLOTS,
} from "@shared/types/ui-editor/navigation";
import { NAV_ENABLED_ATTRIBUTE } from "@/lib/ui-editor/runtime/navigation/focusNavigation";
import { GAME_ROOT_ATTRIBUTE } from "@/lib/ui-editor/runtime/input/keyboardFocusHandover";
import { resolveGlobalInputActionPayloads, type UIInputSignal } from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import type { KeyboardOwner } from "./keyboardOwner";
import { claimNavigationConfirm, runNavigationDefaults } from "./navigationDefaults";
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
        <div ${GAME_ROOT_ATTRIBUTE} ${NAV_ENABLED_ATTRIBUTE}>
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

/** A project's intents filling every slot, bound as the starter project binds them. */
const SLOTTED: Record<string, UIInputActionDef> = Object.fromEntries(UI_NAVIGATION_SLOTS.map(slot => [`nav.${slot}`, {
    id: `nav.${slot}`,
    name: slot,
    bindings: [...UI_NAVIGATION_SLOT_PRESET_BINDINGS[slot]],
    navigationSlot: slot,
}]));

function press(signal: UIInputSignal, actions: Record<string, UIInputActionDef> = {}, slotted = true) {
    const vocabulary = { ...(slotted ? SLOTTED : {}), ...actions };
    const actionIds = resolveGlobalInputActionPayloads({ vocabulary, signal }).map(action => action.actionId);
    return { vocabulary, signal, actionIds };
}

const key = (name: string, shiftKey = false): UIInputSignal => ({ kind: "key", event: { key: name, shiftKey } });
const pad = (button: string): UIInputSignal => ({ kind: "gamepad", button });

afterEach(() => {
    document.body.innerHTML = "";
});

describe("a project whose intents fill no slot", () => {
    it("has no navigation: the arrows, Confirm and Back are only the intents the project bound to them", () => {
        const { root } = mount();
        const owner = pageOwner();
        expect(runNavigationDefaults({ gameRoot: root, owner, ...press(key("ArrowDown"), {}, false) })).toBe(false);
        expect(runNavigationDefaults({ gameRoot: root, owner, ...press(pad("B"), {}, false) })).toBe(false);
        expect(document.activeElement).toBe(document.body);
    });
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
        expect(shiftTab.actionIds).toEqual(expect.arrayContaining(["nav.next", "nav.previous"]));
        expect([...raisedUINavigationSlots(shiftTab.vocabulary, shiftTab.actionIds)]).toEqual(["previous"]);
    });

    it("goes nowhere from the page the game starts on, however much the page stack holds under it", () => {
        const { root } = mount();
        const pageBack = vi.fn(async () => undefined);
        const title = pageOwner([], pageBack);
        expect(runNavigationDefaults({
            gameRoot: root,
            owner: title,
            isEntrySurface: surfaceId => surfaceId === PAGE.id,
            ...press(pad("B")),
        })).toBe(false);
        expect(pageBack).not.toHaveBeenCalled();
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
    it("keeps it, whether it answers the intent in the slot or its own intent on the same key", () => {
        const { root } = mount();
        const answersDown = pageOwner([{ actionId: "nav.down" }]);
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
        expect(claimNavigationConfirm(root, SLOTTED, confirm)).toBe(false);
        runNavigationDefaults({ gameRoot: root, owner: pageOwner(), ...press(pad("D-pad Down")) });
        expect(claimNavigationConfirm(root, SLOTTED, confirm)).toBe(true);
        // `a` answers no Enter of its own, so the press clicks it.
        expect(clicked).toHaveBeenCalledTimes(1);
    });
});

describe("on the stage", () => {
    function mountStage() {
        document.body.innerHTML = `
            <div ${GAME_ROOT_ATTRIBUTE} ${NAV_ENABLED_ATTRIBUTE}>
                <div class="ui-editor-surface" data-ui-surface-id="dialogue" data-ui-nav-scope="controls">
                    <div id="advance-area" data-ui-element-id="advance-area" data-ui-nav-focusable="press" tabindex="0" data-box="0,0,1920,640"></div>
                </div>
                <div class="ui-editor-surface" data-ui-surface-id="quick" data-ui-nav-scope="controls">
                    <div id="auto" role="button" tabindex="0" data-box="0,500,60,20"></div>
                    <div id="save" role="button" tabindex="0" data-box="70,500,60,20"></div>
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
    const DIALOGUE: UISurface = { ...PAGE, id: "dialogue" };
    const ADVANCE: UIInputActionDef = {
        id: "advance",
        name: "Advance",
        bindings: [{ kind: "key", key: "Space" }, { kind: "gamepad", button: "A" }],
    };
    function stageOwner(answers: UISurface["actions"], advance: () => void, knownToAdvance: string[] = []): KeyboardOwner {
        return {
            stage: [{ surface: { ...DIALOGUE, actions: answers }, hostAdapter: {} as never, runtimeScopeId: "dialogue" }],
            storyAdvance: { actionIds: new Set(knownToAdvance), advance },
        };
    }

    it("reads the story on for a Confirm nothing on the stage answers, as a click on it would", async () => {
        const { root } = mountStage();
        const advance = vi.fn();
        // The project has an Advance bound to A that nothing answers - the press still reads on.
        expect(runNavigationDefaults({ gameRoot: root, owner: stageOwner([], advance), ...press(pad("A"), { advance: ADVANCE }) })).toBe(true);
        expect(runNavigationDefaults({ gameRoot: root, owner: stageOwner([], advance), ...press(key(" ")) })).toBe(true);
        await Promise.resolve();
        await Promise.resolve();
        expect(advance).toHaveBeenCalledTimes(2);
    });

    it("leaves reading on to the dialogue box that answers the press, or to an action known to read on", async () => {
        const { root } = mountStage();
        const advance = vi.fn();
        const answered = stageOwner([{ actionId: ADVANCE.id }], advance);
        expect(runNavigationDefaults({ gameRoot: root, owner: answered, ...press(pad("A"), { advance: ADVANCE }) })).toBe(false);
        const known = stageOwner([], advance, [ADVANCE.id]);
        expect(runNavigationDefaults({ gameRoot: root, owner: known, ...press(pad("A"), { advance: ADVANCE }) })).toBe(false);
        await Promise.resolve();
        expect(advance).not.toHaveBeenCalled();
    });

    it("steps into the stage's controls with Menu, presses one with Confirm, and leaves with Cancel", async () => {
        const { root, by } = mountStage();
        const advance = vi.fn();
        const owner = stageOwner([], advance);
        // The D-pad does not wander onto the quick menu during dialogue.
        expect(runNavigationDefaults({ gameRoot: root, owner, ...press(pad("D-pad Right")) })).toBe(false);
        expect(runNavigationDefaults({ gameRoot: root, owner, ...press(pad("Y")) })).toBe(true);
        // Not the dialogue box's click-to-read-on area at the top of the screen: the quick menu.
        expect(document.activeElement).toBe(by("auto"));
        runNavigationDefaults({ gameRoot: root, owner, ...press(pad("D-pad Right")) });
        expect(document.activeElement).toBe(by("save"));
        const clicked = vi.fn();
        by("save").addEventListener("click", clicked);
        expect(claimNavigationConfirm(root, SLOTTED, press(pad("A")).actionIds)).toBe(true);
        expect(clicked).toHaveBeenCalledTimes(1);
        expect(runNavigationDefaults({ gameRoot: root, owner, ...press(pad("B")) })).toBe(true);
        expect(document.activeElement).toBe(document.body);
        // Out again, A reads the story on.
        expect(claimNavigationConfirm(root, SLOTTED, press(pad("A")).actionIds)).toBe(false);
        runNavigationDefaults({ gameRoot: root, owner, ...press(pad("A")) });
        await Promise.resolve();
        await Promise.resolve();
        expect(advance).toHaveBeenCalledTimes(1);
    });
});
