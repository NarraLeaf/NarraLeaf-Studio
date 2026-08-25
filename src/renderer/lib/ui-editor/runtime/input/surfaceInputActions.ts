/**
 * What one lane does with one input: which of a surface's declared actions it fires, and whether the
 * input travels any further.
 *
 * The second half of a lane's answer. The first is the element walk - every element from the hit
 * element up to the surface root that declares a head for this event. This is what happens after
 * it: the surface's own reply to the project's action vocabulary, resolved once per input, and then
 * {@link stopsAtLane} on the way back out.
 *
 * There is no walk in here, and no list of lanes to walk, because on screen there is none to have.
 * The lanes under a pointer are whatever the browser's own hit test carries the event through; each
 * surface shell asks {@link stopsAtLane} about itself as the event goes past, and a surface that
 * passes hands a copy to whatever is painted behind it (`handOffInputToLaneBehind`). That is also
 * why the order between the two hosts is nowhere written as a number: the app page stack is in front
 * of the stage slots because that is what the composite paints, and a layering number pretending the
 * two shared a stacking context would be unimplementable.
 *
 * Four rules decide which actions fire, and all four are the reason that is a function rather than a
 * condition inlined at the call site:
 *
 *  - A binding matches or it does not. Pointer gestures compare by name; keys compare by the
 *    canonical spelling `normalizeUIInputBinding` already put them in, which is the same spelling
 *    the `On Key Down` heads use.
 *  - `overControls: "skip"` (the default) stands a pointer binding down over a control the player
 *    operates. A panel-wide "click advances" must not fire when the click landed on the Back button
 *    inside the panel.
 *  - `consume` (default true) decides whether the lane walk stops here.
 *  - An enablement naming an action the project does not define is ignored, silently. Copying a
 *    surface between projects leaves exactly that, it is inert, and refusing to load the surface
 *    over it would be a far worse answer than doing nothing.
 *
 * Comments in English per project convention.
 */

import {
    blueprintKeyboardBindingMatchesEvent,
    type BlueprintKeyboardEventLike,
} from "@shared/types/blueprint/graph";
import type { UIElement } from "@shared/types/ui-editor/document";
import {
    isOperableWidgetType,
    readUISurfaceActionConsume,
    readUISurfaceActionOverControls,
    resolveSurfaceActionBindings,
    type UIInputActionDef,
    type UIInputBinding,
    type UIInputPointerGesture,
    type UISurfaceActionEnablement,
    type UISurfaceInputMode,
} from "@shared/types/ui-editor/inputAction";
import type { UIInputActionEventPayload } from "@shared/types/ui-editor/inputActionEvent";
import { normalizeVideoProps, UI_VIDEO_ELEMENT_TYPE } from "@shared/types/ui-editor/video";

/** One input, in the terms the bindings are written in. */
export type UIInputSignal =
    | {
          kind: "pointer";
          gesture: UIInputPointerGesture;
          /** Where it landed, in the surface's design coordinates. */
          x: number;
          y: number;
      }
    | {
          kind: "key";
          /**
           * The keyboard payload, exactly as the `On Key Down` heads are handed it.
           *
           * The whole payload rather than a key name, because a binding is "Ctrl+S" as often as it
           * is "Escape" and the modifiers are what tell those apart. Matched by the same function
           * the heads are matched by, so a binding and a head spelled alike behave alike.
           */
          event: BlueprintKeyboardEventLike;
      };

/** One action this surface answers for this input. */
export type UISurfaceInputActionHit = {
    actionId: string;
    /** Whether firing it ends the lane walk. */
    consume: boolean;
    payload: UIInputActionEventPayload;
};

/**
 * Whether the player operates this element directly.
 *
 * `isOperableWidgetType` answers it for the widget type, which is where it belongs for everything
 * whose controlness is a property of the type. `nl.video` is the one case it cannot answer: the same
 * widget is scenery with `controls: false` and a control strip the player scrubs with `controls:
 * true`, and the difference is a prop on the instance rather than anything the logic table can say.
 * So it is asked here, where the instance is in hand, instead of forcing the type table to lie one
 * way or the other.
 */
export function isOperableHitElement(element: Pick<UIElement, "type" | "props"> | null | undefined): boolean {
    if (!element) {
        return false;
    }
    if (isOperableWidgetType(element.type)) {
        return true;
    }
    if (element.type !== UI_VIDEO_ELEMENT_TYPE) {
        return false;
    }
    return normalizeVideoProps(element.props).controls;
}

/** Whether anything in the chain under the pointer is a control. */
export function hitChainHasOperableElement(
    hitChain: readonly (Pick<UIElement, "type" | "props"> | null | undefined)[],
): boolean {
    return hitChain.some(element => isOperableHitElement(element));
}

function bindingMatchesSignal(binding: UIInputBinding, signal: UIInputSignal): boolean {
    if (binding.kind === "pointer") {
        return signal.kind === "pointer" && binding.gesture === signal.gesture;
    }
    return signal.kind === "key" && blueprintKeyboardBindingMatchesEvent(binding.key, signal.event);
}

/**
 * The actions this surface fires for this input, in the order the surface declares them.
 *
 * The chain is only consulted for pointer bindings. A key press happens nowhere, so "was the pointer
 * over a control" is not a question about it - standing an action down because the mouse happened to
 * be resting on a button would make the keyboard's behaviour depend on where the mouse was left.
 */
export function resolveSurfaceInputActionHits(input: {
    /** The project's vocabulary, keyed as `UIDocument.actions` is. */
    vocabulary: Readonly<Record<string, UIInputActionDef>> | undefined;
    /** This surface's answers. */
    enablements: readonly UISurfaceActionEnablement[] | undefined;
    signal: UIInputSignal;
    /** The elements under the pointer, innermost first. Empty for a key. */
    hitChain?: readonly (Pick<UIElement, "type" | "props"> | null | undefined)[];
}): UISurfaceInputActionHit[] {
    const { vocabulary, enablements, signal } = input;
    if (!enablements?.length) {
        return [];
    }
    const overControl = signal.kind === "pointer" && hitChainHasOperableElement(input.hitChain ?? []);

    const hits: UISurfaceInputActionHit[] = [];
    for (const enablement of enablements) {
        const def = vocabulary?.[enablement.actionId];
        if (!def) {
            // An action this build does not know. Cross-project paste leaves these; a lint rule
            // reports them where the author can see them, and routing simply steps over them.
            continue;
        }
        const bindings = resolveSurfaceActionBindings(def, enablement);
        if (!bindings.some(binding => bindingMatchesSignal(binding, signal))) {
            continue;
        }
        if (overControl && readUISurfaceActionOverControls(enablement) === "skip") {
            continue;
        }
        hits.push({
            actionId: enablement.actionId,
            consume: readUISurfaceActionConsume(enablement),
            payload:
                signal.kind === "pointer"
                    ? { actionId: enablement.actionId, source: "pointer", x: signal.x, y: signal.y }
                    : { actionId: enablement.actionId, source: "key" },
        });
    }
    return hits;
}

/** Whether any of these hits takes the input off the lane walk. */
export function hitsConsumeInput(hits: readonly UISurfaceInputActionHit[]): boolean {
    return hits.some(hit => hit.consume);
}

/** What stopped an input at a lane. */
export type UIInputLaneStop = "capture" | "consume";

/**
 * Whether the input stops at a lane that has just answered, and what stopped it.
 *
 * The whole stopping rule, in one place, so that the two things able to end an input's travel are
 * read off one function rather than two conditions that could drift:
 *
 *  - `capture` (the default, `UI_SURFACE_DEFAULT_INPUT_MODE`) stops it whether or not anything on
 *    the surface listened - which is exactly what every surface authored before input modes existed
 *    already did, so a document that predates them behaves as it always has.
 *  - `pass` lets it carry on to whatever is behind.
 *  - An action that fired with `consume` stops it either way. An element head firing does not: a
 *    head is "I want this", not "this is mine", and a lane that stopped because a decorative panel
 *    happened to listen would be the ownership rule back under another name.
 *
 * `none` never reaches here. A surface out of input is click-through, so the browser aims nothing at
 * it in the first place.
 */
export function stopsAtLane(input: UISurfaceInputMode, consumed: boolean): UIInputLaneStop | null {
    if (consumed) {
        return "consume";
    }
    return input === "capture" ? "capture" : null;
}
