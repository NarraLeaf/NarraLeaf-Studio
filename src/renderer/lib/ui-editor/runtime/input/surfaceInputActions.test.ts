import { describe, expect, it } from "vitest";
import type { UIElement } from "@shared/types/ui-editor/document";
import type { UIInputActionDef, UISurfaceActionEnablement } from "@shared/types/ui-editor/inputAction";
import {
    hitChainHasOperableElement,
    hitsConsumeInput,
    isOperableHitElement,
    resolveSurfaceInputActionHits,
    stopsAtLane,
    type UIInputSignal,
} from "./surfaceInputActions";

const ADVANCE: UIInputActionDef = {
    id: "advance",
    name: "Advance",
    bindings: [{ kind: "pointer", gesture: "click" }],
};

const VOCABULARY: Record<string, UIInputActionDef> = { advance: ADVANCE };

const CLICK: UIInputSignal = { kind: "pointer", gesture: "click", device: "pointer", x: 12, y: 34 };

function element(type: string, props?: Record<string, unknown>): UIElement {
    return {
        id: `${type}-1`,
        type,
        parentId: null,
        childrenIds: [],
        layout: { x: 0, y: 0, width: 10, height: 10 },
        ...(props ? { props } : {}),
    };
}

function hits(input: {
    enablements: UISurfaceActionEnablement[];
    signal?: UIInputSignal;
    hitChain?: UIElement[];
    vocabulary?: Record<string, UIInputActionDef>;
}) {
    return resolveSurfaceInputActionHits({
        vocabulary: input.vocabulary ?? VOCABULARY,
        enablements: input.enablements,
        signal: input.signal ?? CLICK,
        hitChain: input.hitChain ?? [],
    });
}

describe("isOperableHitElement", () => {
    it("reads the widget type's own answer", () => {
        expect(isOperableHitElement(element("nl.button"))).toBe(true);
        expect(isOperableHitElement(element("nl.container"))).toBe(false);
    });

    it("treats a video showing its control bar as a control", () => {
        // The one case the type table cannot answer: the same widget is scenery with the strip off
        // and something the player scrubs with it on, and only the instance knows which.
        expect(isOperableHitElement(element("nl.video", { controls: true }))).toBe(true);
        expect(isOperableHitElement(element("nl.video", { controls: false }))).toBe(false);
        expect(isOperableHitElement(element("nl.video"))).toBe(false);
    });

    it("treats an unknown type and an absent element as scenery", () => {
        expect(isOperableHitElement(element("nl.notAThing"))).toBe(false);
        expect(isOperableHitElement(null)).toBe(false);
    });

    it("asks the whole chain, not just the innermost", () => {
        expect(hitChainHasOperableElement([element("nl.text"), element("nl.button")])).toBe(true);
        expect(hitChainHasOperableElement([element("nl.text"), element("nl.container")])).toBe(false);
    });
});

describe("resolveSurfaceInputActionHits", () => {
    it("fires an action whose binding matches", () => {
        expect(hits({ enablements: [{ actionId: "advance" }] })).toEqual([
            {
                actionId: "advance",
                consume: true,
                payload: { actionId: "advance", source: "pointer", x: 12, y: 34 },
            },
        ]);
    });

    it("leaves an action whose binding does not match alone", () => {
        expect(hits({ enablements: [{ actionId: "advance" }], signal: { kind: "key", event: { key: "Escape" } } })).toEqual([]);
    });

    it("takes a surface's replacement bindings over the project's", () => {
        expect(
            hits({
                enablements: [{ actionId: "advance", overrideBindings: [{ kind: "key", key: "Space" }] }],
            }),
        ).toEqual([]);
        expect(
            hits({
                enablements: [{ actionId: "advance", overrideBindings: [{ kind: "key", key: "Space" }] }],
                signal: { kind: "key", event: { key: " " } },
            }),
        ).toHaveLength(1);
    });

    it("stands a pointer binding down over a control", () => {
        expect(hits({ enablements: [{ actionId: "advance" }], hitChain: [element("nl.button")] })).toEqual([]);
        expect(hits({ enablements: [{ actionId: "advance" }], hitChain: [element("nl.container")] })).toHaveLength(1);
    });

    it("stands it down over a video that is showing controls", () => {
        expect(
            hits({ enablements: [{ actionId: "advance" }], hitChain: [element("nl.video", { controls: true })] }),
        ).toEqual([]);
        expect(
            hits({ enablements: [{ actionId: "advance" }], hitChain: [element("nl.video", { controls: false })] }),
        ).toHaveLength(1);
    });

    it("fires over a control when the surface asked it to", () => {
        expect(
            hits({
                enablements: [{ actionId: "advance", overControls: "fire" }],
                hitChain: [element("nl.button")],
            }),
        ).toHaveLength(1);
    });

    it("does not ask where the pointer was for a key", () => {
        // Standing a key binding down because the mouse happened to be resting on a button would
        // make the keyboard's behaviour depend on where somebody left the mouse.
        const keyAction: Record<string, UIInputActionDef> = {
            advance: { id: "advance", name: "Advance", bindings: [{ kind: "key", key: "Space" }] },
        };
        expect(
            hits({
                vocabulary: keyAction,
                enablements: [{ actionId: "advance" }],
                signal: { kind: "key", event: { key: " " } },
                hitChain: [element("nl.button")],
            }),
        ).toEqual([{ actionId: "advance", consume: true, payload: { actionId: "advance", source: "key" } }]);
    });

    it("reports the device the signal came from rather than assuming a mouse", () => {
        // The same gesture reaches routing from both hands: a `click` is a mouse button and the
        // click a tap synthesises. An author asking "was this a finger" is asking about the device,
        // and the answer has to come off the signal rather than off the gesture's name.
        const source = (signal: UIInputSignal) => hits({ enablements: [{ actionId: "advance" }], signal })[0]?.payload.source;

        expect(source(CLICK)).toBe("pointer");
        expect(source({ ...CLICK, device: "touch" })).toBe("touch");
    });

    it("reports a key as a key whatever else is happening", () => {
        const keyAction: Record<string, UIInputActionDef> = {
            advance: { id: "advance", name: "Advance", bindings: [{ kind: "key", key: "Space" }] },
        };
        expect(
            hits({
                vocabulary: keyAction,
                enablements: [{ actionId: "advance" }],
                signal: { kind: "key", event: { key: " " } },
            })[0]?.payload.source,
        ).toBe("key");
    });

    it("ignores an action this project does not define", () => {
        // What a surface pasted in from another project leaves behind. It is inert, a lint rule
        // reports it where the author can see it, and routing steps over it without a word.
        expect(hits({ enablements: [{ actionId: "somebodyElsesAction" }] })).toEqual([]);
        expect(hits({ enablements: [{ actionId: "advance" }], vocabulary: {} })).toEqual([]);
    });
});

describe("hitsConsumeInput", () => {
    it("is true when any action asked for the input", () => {
        expect(hitsConsumeInput(hits({ enablements: [{ actionId: "advance" }] }))).toBe(true);
    });

    it("is false when every action declined it", () => {
        expect(hitsConsumeInput(hits({ enablements: [{ actionId: "advance", consume: false }] }))).toBe(false);
    });

    it("is false when nothing fired", () => {
        expect(hitsConsumeInput([])).toBe(false);
    });
});

describe("stopsAtLane", () => {
    it("stops a capturing surface whether or not it answered", () => {
        expect(stopsAtLane("capture", false)).toBe("capture");
        expect(stopsAtLane("capture", true)).toBe("consume");
    });

    it("lets a passing surface hand the input on until an action consumes it", () => {
        expect(stopsAtLane("pass", false)).toBeNull();
        expect(stopsAtLane("pass", true)).toBe("consume");
    });

    // `none` is click-through, so nothing is ever aimed at it and this branch is unreachable on
    // screen. Pinned anyway: it is the one mode whose answer cannot be read off a running game.
    it("never stops an input at a surface that takes none", () => {
        expect(stopsAtLane("none", false)).toBeNull();
    });
});
