/**
 * What a navigation slot does when nothing on screen answers the press that filled it.
 *
 * A slot (`@shared/types/ui-editor/navigation`) is filled by one of the project's own intents, and a
 * press raises that intent by its bindings like any other: the global blueprint hears it, and a
 * surface can answer it with a graph of its own. That last is what keeps it the author's - a gallery
 * whose arrows page through pictures answers Move Left and Move Right itself. When the surfaces that
 * hold the keys answer nothing a press raised, the press is navigation's, and it does what a menu
 * does: moves the focus, steps it along like Tab, or goes back. A project whose intents fill no slot
 * has no navigation, and every press is the graphs' alone.
 *
 * "Answer nothing" is every action the press raised, not only the navigation ones, and every graph
 * that names the key or button itself. A page that binds its own action to the Right arrow, or has an
 * `On Key Down` set to Escape, means that key on that page; navigation stepping in as well would
 * answer one key twice - two pages closing for one Escape. The same goes for a global graph that
 * names the key: it is the game's own meaning for that key, wherever the player is. A global graph
 * that hears an intent is different - it listens to everything, as it always has, and answers on
 * top of whatever is on screen - except that the stage's Confirm does not read the story on when the
 * global blueprint answers another intent the press raised, which is how a project that reads on from
 * its global blueprint already does it.
 *
 * Confirm is the exception, and comes first. A control the focus is on takes Confirm for itself, the
 * way a focused button takes Enter (`keyInputClaimedByControl`): A on a focused Start button starts
 * the game and does not also advance the line behind the menu. So Confirm on a focused control is a
 * claim - the press presses that control and raises nothing else - whoever would have answered.
 *
 * Comments in English per project convention.
 */

import type { BlueprintDocument } from "@shared/types/blueprint/document";
import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import {
    blueprintNamesInputPress,
    globalBlueprintAnswersInputAction,
} from "@/lib/ui-editor/blueprint-runtime/BlueprintDispatcher";
import { raisedUINavigationSlots, resolveUINavigationSlots } from "@shared/types/ui-editor/navigation";
import { resolveSurfaceInputActionHits, type UIInputSignal } from "@/lib/ui-editor/runtime/input/surfaceInputActions";
import {
    confirmNavigationFocus,
    leaveStageControls,
    moveNavigationFocus,
    stepNavigationFocus,
    toggleStageControls,
} from "@/lib/ui-editor/runtime/navigation/focusNavigation";
import type { AmbientSurfaceTarget } from "./ambientSurfaceEvents";
import type { KeyboardOwner } from "./keyboardOwner";

function ownerSurfaces(owner: KeyboardOwner): readonly AmbientSurfaceTarget[] {
    if ("stage" in owner) {
        return owner.stage;
    }
    return [{ surface: owner.surface, hostAdapter: owner.host.hostAdapter, runtimeScopeId: owner.host.runtimeScopeId }];
}

/**
 * Whether a focused control takes this press as its Confirm. When it does, the control has been
 * pressed by the time this returns, and the press must raise nothing else.
 */
export function claimNavigationConfirm(
    gameRoot: Element | null,
    vocabulary: Readonly<Record<string, UIInputActionDef>> | undefined,
    actionIds: readonly string[],
): boolean {
    if (!gameRoot || !raisedUINavigationSlots(vocabulary, actionIds).has("confirm")) {
        return false;
    }
    return confirmNavigationFocus(gameRoot);
}

/**
 * Where the Back slot goes from a page or a layer, as the game that holds the stacks answers it: a
 * modal layer that may be dismissed closes, a page goes back to a different page under it, and
 * anything else is where Back ends (see `GameApp`'s `navigationBack`).
 */
export type NavigationBack = {
    canGoBack: () => boolean;
    goBack: () => void;
};

/**
 * Whether Back has somewhere to go from what holds the keys. Never from the stage, where the story
 * on screen is where Back ends. The hint bar asks the same question.
 */
export function ownerCanGoBack(owner: KeyboardOwner | null, back: NavigationBack | undefined): boolean {
    return Boolean(owner && !("stage" in owner) && back?.canGoBack());
}

/**
 * Do what the slots the press filled ask, unless what holds the keys answers the press itself.
 * Returns whether navigation did something, so a key it used can keep its browser default from also
 * running (Tab moving the focus a second time, an arrow scrolling).
 */
/** Whether a graph on what holds the keys, or on the global blueprint, names this key or button. */
function pressNamedByGraphs(blueprintDocument: BlueprintDocument, owner: KeyboardOwner, signal: UIInputSignal): boolean {
    const press = signal.kind === "key"
        ? { eventName: "keyDown", eventPayload: signal.event as Record<string, unknown> }
        : signal.kind === "gamepad"
            ? { eventName: "gamepadButtonDown", eventPayload: { button: signal.button } as Record<string, unknown> }
            : null;
    if (!press) {
        return false;
    }
    const surfaceIds: (string | null)[] = [null, ...ownerSurfaces(owner).map(({ surface }) => surface.id)];
    return surfaceIds.some(surfaceId => blueprintNamesInputPress({ blueprintDocument, surfaceId, ...press }));
}

export function runNavigationDefaults(input: {
    gameRoot: Element | null;
    owner: KeyboardOwner | null;
    /** Where Back goes from a page or a layer (`ownerCanGoBack`). Absent, it goes nowhere. */
    back?: NavigationBack;
    vocabulary: Readonly<Record<string, UIInputActionDef>> | undefined;
    signal: UIInputSignal;
    actionIds: readonly string[];
    /** A key held down and repeating: only the moves repeat, as an arrow held in a list does. */
    repeat?: boolean;
    /**
     * The game's graphs, to tell whether one of them names this key or button (see the module
     * comment). Absent in a test of the routing alone, which then has no graphs to defer to.
     */
    blueprintDocument?: BlueprintDocument;
}): boolean {
    const { gameRoot, owner } = input;
    if (!gameRoot || !owner) {
        return false;
    }
    const slots = raisedUINavigationSlots(input.vocabulary, input.actionIds);
    if (slots.size === 0) {
        return false;
    }
    const answered = ownerSurfaces(owner).some(({ surface }) => resolveSurfaceInputActionHits({
        vocabulary: input.vocabulary,
        enablements: surface.actions,
        signal: input.signal,
    }).length > 0);
    if (answered || (input.blueprintDocument && pressNamedByGraphs(input.blueprintDocument, owner, input.signal))) {
        return false;
    }
    let handled = false;
    for (const slot of slots) {
        switch (slot) {
            case "up":
            case "down":
            case "left":
            case "right":
                handled = moveNavigationFocus(gameRoot, slot) || handled;
                break;
            case "next":
            case "previous":
                handled = stepNavigationFocus(gameRoot, slot === "next" ? 1 : -1) || handled;
                break;
            case "cancel": {
                // Back out of the page or layer that holds the keys. On the stage there is only the
                // stage's controls to back out of: a story on screen is where Back ends.
                if (input.repeat) {
                    break;
                }
                if ("stage" in owner) {
                    handled = leaveStageControls(gameRoot) || handled;
                    break;
                }
                if (!ownerCanGoBack(owner, input.back)) {
                    break;
                }
                input.back?.goBack();
                handled = true;
                break;
            }
            case "confirm": {
                // A focused control claimed it before the press's actions ran (see
                // `claimNavigationConfirm`). What is left is the stage with nothing focused: the
                // press reads the story on, as a click on the stage does - unless one of the
                // actions it raised is already known to.
                const story = "stage" in owner ? owner.storyAdvance : null;
                if (!story || input.repeat || input.actionIds.some(actionId => story.actionIds.has(actionId))) {
                    break;
                }
                const blueprintDocument = input.blueprintDocument;
                const confirmActionId = resolveUINavigationSlots(input.vocabulary).confirm;
                if (blueprintDocument && input.actionIds.some(actionId =>
                    actionId !== confirmActionId && globalBlueprintAnswersInputAction(blueprintDocument, actionId))) {
                    break;
                }
                void Promise.resolve()
                    .then(() => story.advance())
                    .catch(() => undefined);
                handled = true;
                break;
            }
            case "menu":
                if (!input.repeat && "stage" in owner) {
                    handled = toggleStageControls(gameRoot) || handled;
                }
                break;
        }
    }
    return handled;
}
