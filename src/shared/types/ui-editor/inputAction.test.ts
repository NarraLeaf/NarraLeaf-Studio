import { describe, expect, it } from "vitest";
import { UI_DISPLAYABLE_WIDGET_TYPES } from "./displayableWidgets";
import {
    UI_INPUT_POINTER_GESTURES,
    collectReferencedUIInputActionIds,
    findUISurfaceActionEnablement,
    inputBindingDevices,
    inputBindingReachesDevice,
    isOperableWidgetType,
    isUIInputPointerGesture,
    normalizeUIInputActionLibrary,
    normalizeUIInputBinding,
    normalizeUISurfaceActionEnablements,
    normalizeUISurfaceInputMode,
    pruneUISurfaceActionEnablements,
    readUISurfaceActionConsume,
    readUISurfaceActionOverControls,
    resolveSurfaceActionBindings,
    type UIInputActionDef,
    type UIInputBinding,
    type UIInputPointerGesture,
} from "./inputAction";
import type { UIInputActionSource } from "./inputActionEvent";
import { BUILTIN_WIDGET_LOGIC_APIS } from "./widgetLogic";

const click: UIInputBinding = { kind: "pointer", gesture: "click" };
const rightClick: UIInputBinding = { kind: "pointer", gesture: "rightClick" };
const longPress: UIInputBinding = { kind: "pointer", gesture: "longPress" };
const escape: UIInputBinding = { kind: "key", key: "Escape" };
const space: UIInputBinding = { kind: "key", key: "Space" };

function action(bindings: UIInputBinding[]): UIInputActionDef {
    return { id: "advance", name: "Advance", bindings };
}

describe("resolveSurfaceActionBindings", () => {
    it("hands back the project defaults when the surface says nothing", () => {
        expect(resolveSurfaceActionBindings(action([click, escape]))).toEqual([click, escape]);
        expect(resolveSurfaceActionBindings(action([click]), { actionId: "advance" })).toEqual([click]);
    });

    it("appends the surface's own bindings after the defaults", () => {
        expect(
            resolveSurfaceActionBindings(action([click]), { actionId: "advance", addBindings: [space] }),
        ).toEqual([click, space]);
    });

    it("replaces the defaults entirely when an override is present", () => {
        expect(
            resolveSurfaceActionBindings(action([click, escape]), {
                actionId: "advance",
                overrideBindings: [space],
            }),
        ).toEqual([space]);
    });

    it("treats an override present but empty as 'no gesture here', not as 'use the defaults'", () => {
        // The distinction the record exists to carry: a surface that lists an action and binds it to
        // nothing has said something different from a surface that never overrode it.
        expect(
            resolveSurfaceActionBindings(action([click]), { actionId: "advance", overrideBindings: [] }),
        ).toEqual([]);
    });

    it("ignores additions while an override stands", () => {
        expect(
            resolveSurfaceActionBindings(action([click]), {
                actionId: "advance",
                addBindings: [rightClick],
                overrideBindings: [space],
            }),
        ).toEqual([space]);
    });

    it("names each binding once, first occurrence winning", () => {
        expect(
            resolveSurfaceActionBindings(action([click, escape]), {
                actionId: "advance",
                addBindings: [click, space, escape],
            }),
        ).toEqual([click, escape, space]);
        expect(
            resolveSurfaceActionBindings(null, { actionId: "advance", overrideBindings: [space, space] }),
        ).toEqual([space]);
    });

    it("survives a missing definition", () => {
        expect(resolveSurfaceActionBindings(undefined, null)).toEqual([]);
    });
});

/**
 * Every built-in widget type, pinned.
 *
 * Written as a table rather than as a rule so the answer is a decision somebody made, and so a
 * widget type added to `BUILTIN_WIDGET_LOGIC_APIS` or to the insert palette fails here until it is
 * classified - which is the whole point of the flag being declared instead of derived.
 */
const OPERABLE_BY_TYPE: Record<string, boolean> = {
    "nl.root": false,
    "nl.container": false,
    "nl.text": false,
    "nl.dialog.sentence": false,
    "nl.nvl.texts": false,
    "nl.image": false,
    "nl.video": false,
    "nl.puppet": false,
    "nl.frame": false,
    "nl.button": true,
    "nl.switch": true,
    "nl.slider": true,
    "nl.textInput": true,
    "nl.list": true,
    "nl.notification.list": true,
    "nl.choice.list": true,
    "nl.nvl.list": true,
};

describe("isOperableWidgetType", () => {
    it("covers every type the logic table and the insert palette know about", () => {
        const known = new Set([...Object.keys(BUILTIN_WIDGET_LOGIC_APIS), ...UI_DISPLAYABLE_WIDGET_TYPES]);
        expect([...known].sort()).toEqual(Object.keys(OPERABLE_BY_TYPE).sort());
    });

    for (const [type, operable] of Object.entries(OPERABLE_BY_TYPE)) {
        it(`answers ${operable} for ${type}`, () => {
            expect(isOperableWidgetType(type)).toBe(operable);
        });
    }

    it("treats an unknown or absent type as scenery", () => {
        expect(isOperableWidgetType("nl.notAThing")).toBe(false);
        expect(isOperableWidgetType(null)).toBe(false);
        expect(isOperableWidgetType(undefined)).toBe(false);
    });
});

describe("pointer gestures", () => {
    it("recognises every gesture in the tuple and nothing else", () => {
        for (const gesture of UI_INPUT_POINTER_GESTURES) {
            expect(isUIInputPointerGesture(gesture)).toBe(true);
        }
        expect(isUIInputPointerGesture("hover")).toBe(false);
        expect(isUIInputPointerGesture(undefined)).toBe(false);
    });

    it("stores and reads back a long press with no branch of its own", () => {
        // It is a pointer gesture like the rest, so being in the tuple is the whole of what makes it
        // storable - there is no second place a new gesture has to be admitted.
        expect(normalizeUIInputBinding({ kind: "pointer", gesture: "longPress" })).toEqual(longPress);
    });
});

function devicesOf(binding: UIInputBinding): UIInputActionSource[] {
    return [...inputBindingDevices(binding)].sort();
}

function pointer(gesture: UIInputPointerGesture): UIInputBinding {
    return { kind: "pointer", gesture };
}

describe("inputBindingDevices", () => {
    // Written out one gesture at a time rather than generated from the same table the answer comes
    // from: a loop over the source of truth would agree with any answer it gave, and pinning each
    // ruling separately is the only reason this test exists.
    it("reads a click as mouse and finger alike", () => {
        expect(devicesOf(pointer("click"))).toEqual(["pointer", "touch"]);
    });

    it("reads a double click as pointer only", () => {
        expect(devicesOf(pointer("doubleClick"))).toEqual(["pointer"]);
    });

    it("reads a right click as pointer only", () => {
        expect(devicesOf(pointer("rightClick"))).toEqual(["pointer"]);
    });

    it("reads each scroll direction as mouse and finger alike", () => {
        expect(devicesOf(pointer("wheelUp"))).toEqual(["pointer", "touch"]);
        expect(devicesOf(pointer("wheelDown"))).toEqual(["pointer", "touch"]);
        expect(devicesOf(pointer("wheelLeft"))).toEqual(["pointer", "touch"]);
        expect(devicesOf(pointer("wheelRight"))).toEqual(["pointer", "touch"]);
    });

    it("reads a long press as touch only", () => {
        expect(devicesOf(pointer("longPress"))).toEqual(["touch"]);
    });

    it("reads a key binding as the keyboard", () => {
        expect(devicesOf(escape)).toEqual(["key"]);
        expect(devicesOf(space)).toEqual(["key"]);
    });

    it("leaves no gesture reachable from nowhere", () => {
        for (const gesture of UI_INPUT_POINTER_GESTURES) {
            expect(inputBindingDevices(pointer(gesture)).size).toBeGreaterThan(0);
        }
    });

    it("gives no binding to the gamepad yet", () => {
        // The pad is declared in the source union and produced by nothing. Whoever wires one up
        // turns this red, which is the reminder to say in the table above which gestures it reaches.
        const bindings: UIInputBinding[] = [...UI_INPUT_POINTER_GESTURES.map(pointer), escape, space];
        for (const binding of bindings) {
            expect(inputBindingReachesDevice(binding, "gamepad")).toBe(false);
        }
    });

    it("answers the same question the set does", () => {
        expect(inputBindingReachesDevice(click, "touch")).toBe(true);
        expect(inputBindingReachesDevice(click, "key")).toBe(false);
        expect(inputBindingReachesDevice(longPress, "pointer")).toBe(false);
        expect(inputBindingReachesDevice(escape, "key")).toBe(true);
    });
});

describe("normalize", () => {
    it("round-trips a vocabulary unchanged", () => {
        const stored = {
            advance: { id: "advance", name: "Advance", bindings: [click, escape] },
            skip: { id: "skip", name: "Skip", bindings: [] },
        };
        expect(normalizeUIInputActionLibrary(stored)).toEqual(stored);
    });

    it("keys a vocabulary entry by the table's key, not by the entry's own id", () => {
        const normalized = normalizeUIInputActionLibrary({
            advance: { id: "drifted", name: "Advance", bindings: [] },
        });
        expect(normalized.advance?.id).toBe("advance");
        expect(normalized.drifted).toBeUndefined();
    });

    it("drops entries with no id and bindings this build cannot read", () => {
        expect(
            normalizeUIInputActionLibrary({
                nameless: { name: "No id", bindings: [] },
                advance: { id: "advance", name: "Advance", bindings: [click, { kind: "pointer", gesture: "hover" }, 7] },
            }),
        ).toEqual({ advance: { id: "advance", name: "Advance", bindings: [click] } });
        expect(normalizeUIInputActionLibrary(null)).toEqual({});
        expect(normalizeUIInputActionLibrary([])).toEqual({});
    });

    it("spells a stored key the way the On Key heads spell it", () => {
        expect(
            normalizeUIInputActionLibrary({
                advance: { id: "advance", name: "Advance", bindings: [{ kind: "key", key: "esc" }, { kind: "key", key: " " }] },
            }).advance?.bindings,
        ).toEqual([escape, space]);
    });

    it("collapses two spellings of one key into one binding", () => {
        expect(
            normalizeUIInputActionLibrary({
                advance: {
                    id: "advance",
                    name: "Advance",
                    bindings: [{ kind: "key", key: "Escape" }, { kind: "key", key: "esc" }],
                },
            }).advance?.bindings,
        ).toEqual([escape]);
    });

    it("round-trips a surface's enablements unchanged", () => {
        const stored = [
            { actionId: "advance", addBindings: [space], consume: false, overControls: "fire" as const },
            { actionId: "skip", overrideBindings: [] },
        ];
        expect(normalizeUISurfaceActionEnablements(stored)).toEqual(stored);
    });

    it("keeps one enablement per action and drops those naming none", () => {
        expect(
            normalizeUISurfaceActionEnablements([
                { actionId: "advance", consume: false },
                { actionId: "advance", consume: true },
                { actionId: "   " },
                null,
            ]),
        ).toEqual([{ actionId: "advance", consume: false }]);
    });

    it("reads a surface with no mode as capturing", () => {
        expect(normalizeUISurfaceInputMode(undefined)).toBe("capture");
        expect(normalizeUISurfaceInputMode("nonsense")).toBe("capture");
        expect(normalizeUISurfaceInputMode("pass")).toBe("pass");
        expect(normalizeUISurfaceInputMode("none")).toBe("none");
    });

    it("reads the defaults an absent field stands for", () => {
        expect(readUISurfaceActionConsume(undefined)).toBe(true);
        expect(readUISurfaceActionConsume({ actionId: "advance", consume: false })).toBe(false);
        expect(readUISurfaceActionOverControls(undefined)).toBe("skip");
        expect(readUISurfaceActionOverControls({ actionId: "advance", overControls: "fire" })).toBe("fire");
    });
});

describe("references", () => {
    it("collects every action id the surfaces still name", () => {
        const document = {
            surfaces: [
                { actions: [{ actionId: "advance" }, { actionId: "skip" }] },
                { actions: [{ actionId: "advance" }] },
                {},
            ],
        } as unknown as Parameters<typeof collectReferencedUIInputActionIds>[0];
        expect([...collectReferencedUIInputActionIds(document)].sort()).toEqual(["advance", "skip"]);
    });

    it("finds a surface's answer to one action, or nothing when it does not answer it", () => {
        const enablements = [{ actionId: "advance", consume: false }, { actionId: "skip" }];
        expect(findUISurfaceActionEnablement(enablements, "advance")).toEqual({
            actionId: "advance",
            consume: false,
        });
        expect(findUISurfaceActionEnablement(enablements, "menu")).toBeUndefined();
        expect(findUISurfaceActionEnablement(undefined, "advance")).toBeUndefined();
    });

    it("drops the enablements naming an action outside the vocabulary", () => {
        expect(
            pruneUISurfaceActionEnablements(
                [{ actionId: "advance" }, { actionId: "gone" }],
                new Set(["advance"]),
            ),
        ).toEqual([{ actionId: "advance" }]);
        expect(pruneUISurfaceActionEnablements(undefined, new Set(["advance"]))).toEqual([]);
    });
});
