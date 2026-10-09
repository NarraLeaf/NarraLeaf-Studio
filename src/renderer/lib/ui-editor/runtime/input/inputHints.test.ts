/**
 * What the hint bar lists: the moves while there is something to move between, the actions the
 * screen answers by their own names, Advance and Stage controls on the stage, Back where there is
 * somewhere to go back to - and each button once.
 *
 * Comments in English per project convention.
 */
import { describe, expect, it } from "vitest";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import { resolveRuntimeInputVocabulary } from "@shared/types/ui-editor/navigation";
import { resolveInputHints, type InputHintContext } from "./inputHints";

const DISMISS: UIInputActionDef = { id: "dismiss", name: "Close", bindings: [{ kind: "key", key: "Escape" }, { kind: "gamepad", button: "B" }] };
const BACKLOG: UIInputActionDef = { id: "backlog", name: "Log", bindings: [{ kind: "gamepad", button: "LB" }] };
const ADVANCE: UIInputActionDef = { id: "advance", name: "Read on", bindings: [{ kind: "key", key: "Space" }, { kind: "gamepad", button: "A" }] };

function context(overrides: Partial<InputHintContext>): InputHintContext {
    return {
        device: "gamepad",
        vocabulary: resolveRuntimeInputVocabulary({ dismiss: DISMISS, backlog: BACKLOG, advance: ADVANCE }),
        lane: "page",
        answered: [],
        navigation: { scope: "owner", targets: 4, stageControlsAvailable: false },
        canGoBack: true,
        storyAdvances: false,
        ...overrides,
    };
}

const summary = (hints: ReturnType<typeof resolveInputHints>) =>
    hints.map(hint => `${hint.label.kind === "word" ? hint.label.word : hint.label.name}:${hint.bindings.map(b => (b.kind === "gamepad" ? b.button : b.kind === "key" ? b.key : b.gesture)).join("/")}`);

describe("the hints on a page", () => {
    it("lists moving, confirming and going back", () => {
        expect(summary(resolveInputHints(context({})))).toEqual(["select:D-pad Up", "confirm:A", "back:B"]);
    });

    it("names Back by the page's own action when the page answers it", () => {
        expect(summary(resolveInputHints(context({ answered: ["dismiss"] })))).toEqual(["select:D-pad Up", "confirm:A", "Close:B"]);
    });

    it("says nothing about going back from the page the game starts on", () => {
        expect(summary(resolveInputHints(context({ canGoBack: false })))).toEqual(["select:D-pad Up", "confirm:A"]);
    });

    it("lists the keyboard's keys for a keyboard player", () => {
        expect(summary(resolveInputHints(context({ device: "key", answered: ["dismiss"] })))).toEqual([
            "select:ArrowUp",
            "confirm:Enter/Space",
            "Close:Escape",
        ]);
    });
});

describe("the hints on the stage", () => {
    const stage = { lane: "stage" as const, canGoBack: false, navigation: { scope: null, targets: 0, stageControlsAvailable: true } };

    it("reads on with Confirm and steps into the stage's controls when nothing answers", () => {
        expect(summary(resolveInputHints(context({ ...stage, storyAdvances: true })))).toEqual(["advance:A", "stageControls:Y"]);
    });

    it("names the dialogue box's own actions, and does not list A twice", () => {
        expect(summary(resolveInputHints(context({ ...stage, storyAdvances: true, answered: ["advance", "backlog"] })))).toEqual([
            "Read on:A",
            "Log:LB",
            "stageControls:Y",
        ]);
    });

    it("moves, confirms and leaves while the player is in the stage's controls", () => {
        const controls = { ...stage, navigation: { scope: "controls" as const, targets: 6, stageControlsAvailable: false } };
        expect(summary(resolveInputHints(context({ ...controls, storyAdvances: true })))).toEqual(["select:D-pad Up", "confirm:A", "back:B"]);
    });
});
