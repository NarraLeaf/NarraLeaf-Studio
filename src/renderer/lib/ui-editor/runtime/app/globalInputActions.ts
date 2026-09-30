/**
 * The game's global blueprint answering an input action.
 *
 * `On Action` is offered on the global blueprint, and what an author means by putting it there is
 * plain: "this gesture means this wherever the player is". So the global blueprint hears every
 * action in the project's vocabulary - there is no list of the ones it answers, as a surface has -
 * whenever one of its bindings is performed and the input reaches the game at all:
 *
 *  - **a key**, from the one listener the running game installs (`keyboardOwner`), under the gates
 *    the game's key heads already have - not while a text field has focus, not once something
 *    stopped the event - and whoever owns the keyboard, a page or a modal layer over it;
 *  - **a pointer input**, from the first lane it lands on (`GameSurfaceRenderer`) - or, when it
 *    lands on none, from the game's drawing root (`globalPointerInput`) - as long as the gesture is
 *    not the tail of one already answered and no control under the pointer has spoken for it.
 *
 * Either way the global answers **first**, and whatever is on screen answers after it: the keyboard
 * owner's heads and actions, or the actions of the lanes the pointer landed on. That is the order the
 * global key heads have always had, and one order for both is what lets a graph on the global
 * blueprint behave the same whether a key or a click raised the action.
 *
 * Both run. The global answering an action does not stop a page that answers the same one - the
 * rule for global key heads, and there is no per-action "stop" on the global to say otherwise: that
 * option is a surface's answer about the lanes behind it, and nothing is behind the game. What does
 * stop the owner is a global handler stopping propagation on the input's event control, the one
 * stop a global key head has (`ctx.stopPropagation()` in a script).
 *
 * One function for both routes, running on the host every other global dispatch from the app uses
 * (the active page's), so neither route can drift into running the global blueprint somewhere else.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument } from "@shared/types/blueprint/document";
import { UI_SURFACE_INPUT_ACTION_EVENT, type UIInputActionEventPayload } from "@shared/types/ui-editor/inputActionEvent";
import type { PersistentVariableRuntimeTable } from "@shared/types/variables/registry";
import type { BehaviorGraphEventControl } from "@/lib/ui-editor/behavior-graph/BehaviorNodeRegistry";
import { dispatchGlobalBlueprintEvent } from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import type { BlueprintRuntimeCore } from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";
import type { HostAdapterBundle } from "./types";

/** What running the global blueprint needs, whichever route the input came by. */
export type GlobalBlueprintDispatch = {
    blueprintDocument: BlueprintDocument;
    persistentVariables: PersistentVariableRuntimeTable;
    core: Pick<BlueprintRuntimeCore, "scopeBridge" | "debug" | "executionManager">;
    /**
     * The host the global blueprint runs on: the active page's, which is the host every other global
     * dispatch from the app uses. Whoever owns the keyboard and whichever lane a click landed on, the
     * global blueprint is the game's rather than anything's on screen.
     */
    globalHost: HostAdapterBundle;
};

/**
 * Run the global blueprint's `On Action` heads for these actions, and resolve once they have run.
 *
 * Nothing starts once `eventControl` has been stopped, and a handler that stops it is what keeps
 * the input from whatever is on screen - the caller checks it before answering the input itself.
 */
export async function answerGlobalInputActions(
    input: GlobalBlueprintDispatch,
    payloads: readonly UIInputActionEventPayload[],
    eventControl: BehaviorGraphEventControl,
): Promise<void> {
    if (payloads.length === 0) {
        return;
    }
    const { blueprintDocument, persistentVariables, core, globalHost } = input;
    const store = core.scopeBridge.getSurfaceStore(globalHost.runtimeScopeId);
    await Promise.all(payloads.map(payload => dispatchGlobalBlueprintEvent({
        blueprintDocument,
        persistentVariables,
        eventName: UI_SURFACE_INPUT_ACTION_EVENT,
        eventPayload: { ...payload },
        eventControl,
        hostAdapter: globalHost.hostAdapter,
        debug: core.debug,
        getSurfaceState: key => store.get(key),
        setSurfaceState: (key, value) => store.set(key, value),
        executionManager: core.executionManager,
    })));
}
