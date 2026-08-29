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
 *  - A control under the pointer has already spoken for the input, so the action stands down. A
 *    panel-wide "click advances" must not fire when the click landed on the Back button inside the
 *    panel. See {@link pointerInputClaimedByControl} for the one gesture a control can be under and
 *    still not want.
 *  - `consume` (default true) decides whether the input stops here.
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
    resolveSurfaceActionBindings,
    type UIInputActionDef,
    type UIInputBinding,
    type UIInputPointerGesture,
    type UISurfaceActionEnablement,
} from "@shared/types/ui-editor/inputAction";
import type { UIInputActionEventPayload, UIInputActionSource } from "@shared/types/ui-editor/inputActionEvent";
import { isWheelPointerGesture } from "./wheelGesture";
import { normalizeVideoProps, UI_VIDEO_ELEMENT_TYPE } from "@shared/types/ui-editor/video";

/**
 * The devices a pointer gesture can come from.
 *
 * A pen counts as `pointer`: it aims at a single point the way a mouse does, and everything an
 * interface would phrase differently for one it phrases the same way for the other. What separates
 * `touch` from both is that a fingertip covers its target rather than aiming at it.
 */
export type UIPointerInputDevice = Extract<UIInputActionSource, "pointer" | "touch">;

/** One input, in the terms the bindings are written in. */
export type UIInputSignal =
    | {
          kind: "pointer";
          gesture: UIInputPointerGesture;
          /**
           * Which pointing device produced it.
           *
           * Carried on the signal rather than assumed, because the same gesture reaches here from
           * both: a `click` is a mouse button and a finger's tap, and the four wheel directions are
           * a wheel, a trackpad and a finger dragging. Required rather than defaulted, so a new
           * route into routing has to say which of them it is instead of quietly reporting a mouse.
           */
          device: UIPointerInputDevice;
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

/** One element under the pointer, with what its own scroller can still do. */
export type UIInputHitNode = {
    element: Pick<UIElement, "type" | "props"> | null | undefined;
    /**
     * Whether this node's own scroller can still travel the way the gesture asks.
     *
     * Read off the DOM by the caller, because scroll position is not in the document. False for a
     * node that does not scroll, and for every gesture that is not a scroll.
     */
    scrollerCanTravel?: boolean;
};

/**
 * Whether something under the pointer has already spoken for this input.
 *
 * An action declared on a surface is what the surface does with an input **nothing on it wanted**.
 * A click on a Back button is the button's; a panel-wide "click advances" firing as well would
 * spend a line on a player who was aiming at the button. So a control in the chain takes the input
 * and the action stands down - and there is no setting for it, because this is a fact about what
 * the player hit rather than a policy an author picks.
 *
 * **A scroll is the one input a control can be under and still not want.** A list scrolls until it
 * reaches its end; past that the wheel is doing nothing, and an action bound to it - "one more pull
 * at the bottom closes the log" - is the only thing left that can answer. So a scroller claims a
 * scroll while it can still travel that way and lets it go when it cannot. Every other gesture is
 * claimed by any control it lands on: a button does not run out of clicks.
 */
export function pointerInputClaimedByControl(
    chain: readonly UIInputHitNode[],
    gesture: UIInputPointerGesture,
): boolean {
    const scrolling = isWheelPointerGesture(gesture);
    for (const node of chain) {
        if (!isOperableHitElement(node.element)) {
            continue;
        }
        if (!scrolling || node.scrollerCanTravel) {
            return true;
        }
    }
    return false;
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
    hitChain?: readonly UIInputHitNode[];
}): UISurfaceInputActionHit[] {
    const { vocabulary, enablements, signal } = input;
    if (!enablements?.length) {
        return [];
    }
    const claimed = signal.kind === "pointer"
        && pointerInputClaimedByControl(input.hitChain ?? [], signal.gesture);

    const hits: UISurfaceInputActionHit[] = [];
    for (const enablement of enablements) {
        const def = vocabulary?.[enablement.actionId];
        if (!def) {
            // An action this build does not know. Cross-project paste leaves these; a lint rule
            // reports them where the author can see them, and routing simply steps over them.
            continue;
        }
        const bindings = resolveSurfaceActionBindings(def);
        if (!bindings.some(binding => bindingMatchesSignal(binding, signal))) {
            continue;
        }
        if (claimed) {
            continue;
        }
        hits.push({
            actionId: enablement.actionId,
            consume: readUISurfaceActionConsume(enablement),
            payload:
                signal.kind === "pointer"
                    ? { actionId: enablement.actionId, source: signal.device, x: signal.x, y: signal.y }
                    : { actionId: enablement.actionId, source: "key" },
        });
    }
    return hits;
}

/** Whether any of these hits takes the input off the lane walk. */
export function hitsConsumeInput(hits: readonly UISurfaceInputActionHit[]): boolean {
    return hits.some(hit => hit.consume);
}

/**
 * Whether the input stops at a lane that has just answered.
 *
 * A surface is drawn over what is behind it, and an input that lands on its content stops there.
 * The one thing that sends it further is an action saying so: firing with `consume` off means "this
 * was mine, and there is still something in it for whatever is behind". Input nothing answered does
 * not pass, because a surface that let it through would be a hole in the interface that nothing on
 * screen accounts for.
 */
export function stopsAtLane(hits: readonly UISurfaceInputActionHit[]): boolean {
    return hits.length === 0 || hits.some(hit => hit.consume);
}
