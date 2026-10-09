/**
 * What a navigation action does when nothing on screen answers it.
 *
 * The navigation actions (`nl.nav.*`, see `@shared/types/ui-editor/navigation`) are input actions: a
 * key or a pad button raises them by the bindings the vocabulary gives them, the global blueprint
 * hears them like any other, and a surface can answer one with a graph of its own. That last is what
 * makes them the author's to change - a gallery whose arrows page through pictures answers Left and
 * Right itself. When the surfaces that hold the keys answer nothing a press raised, the press is
 * navigation's, and it does what a menu does: moves the focus, steps it along like Tab, or goes back.
 *
 * "Answer nothing" is every action the press raised, not only the navigation ones. A page that binds
 * its own action to the Right arrow means the Right arrow on that page; navigation stepping in as
 * well would answer one key twice. The global blueprint does not take a press from navigation: it
 * listens to everything, as its key heads always have, and answers on top of whatever is on screen.
 *
 * Confirm is the exception, and comes first. A control the focus is on takes Confirm for itself, the
 * way a focused button takes Enter (`keyInputClaimedByControl`): A on a focused Start button starts
 * the game and does not also advance the line behind the menu. So Confirm on a focused control is a
 * claim - the press presses that control and raises nothing else - whoever would have answered.
 *
 * Comments in English per project convention.
 */

import type { UIInputActionDef } from "@shared/types/ui-editor/inputAction";
import { readUINavigationActionIntent, type UINavigationIntent } from "@shared/types/ui-editor/navigation";
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

/** The navigation intents among the actions a press raised. */
export function raisedNavigationIntents(actionIds: readonly string[]): Set<UINavigationIntent> {
    const intents = new Set<UINavigationIntent>();
    for (const actionId of actionIds) {
        const intent = readUINavigationActionIntent(actionId);
        if (intent) {
            intents.add(intent);
        }
    }
    // Shift+Tab is also Tab: a key binding without modifiers matches a press with them. The one that
    // names Shift is the one the player meant.
    if (intents.has("previous")) {
        intents.delete("next");
    }
    return intents;
}

/**
 * Whether a focused control takes this press as its Confirm. When it does, the control has been
 * pressed by the time this returns, and the press must raise nothing else.
 */
export function claimNavigationConfirm(gameRoot: Element | null, actionIds: readonly string[]): boolean {
    if (!gameRoot || !raisedNavigationIntents(actionIds).has("confirm")) {
        return false;
    }
    return confirmNavigationFocus(gameRoot);
}

/**
 * Do what the press's navigation intents ask, unless what holds the keys answers the press itself.
 * Returns whether navigation did something, so a key it used can keep its browser default from also
 * running (Tab moving the focus a second time, an arrow scrolling).
 */
/**
 * Whether Back has somewhere to go from what holds the keys: a page or layer, unless it is the page
 * the game starts on. The page stack can hold more under the title - a Title button on a menu that
 * opened the title again rather than closing the menu - but backing out of the title into that menu
 * is not a step back anywhere a player recognises. The hint bar asks the same question.
 */
export function ownerCanGoBack(owner: KeyboardOwner | null, isEntrySurface: ((surfaceId: string) => boolean) | undefined): boolean {
    return Boolean(owner && !("stage" in owner) && !isEntrySurface?.(owner.surface.id));
}

export function runNavigationDefaults(input: {
    gameRoot: Element | null;
    owner: KeyboardOwner | null;
    /** Whether a surface is the one the game starts on, where Back goes nowhere (`ownerCanGoBack`). */
    isEntrySurface?: (surfaceId: string) => boolean;
    vocabulary: Readonly<Record<string, UIInputActionDef>> | undefined;
    signal: UIInputSignal;
    actionIds: readonly string[];
    /** A key held down and repeating: only the moves repeat, as an arrow held in a list does. */
    repeat?: boolean;
}): boolean {
    const { gameRoot, owner } = input;
    if (!gameRoot || !owner) {
        return false;
    }
    const intents = raisedNavigationIntents(input.actionIds);
    if (intents.size === 0) {
        return false;
    }
    const answered = ownerSurfaces(owner).some(({ surface }) => resolveSurfaceInputActionHits({
        vocabulary: input.vocabulary,
        enablements: surface.actions,
        signal: input.signal,
    }).length > 0);
    if (answered) {
        return false;
    }
    let handled = false;
    for (const intent of intents) {
        switch (intent) {
            case "up":
            case "down":
            case "left":
            case "right":
                handled = moveNavigationFocus(gameRoot, intent) || handled;
                break;
            case "next":
            case "previous":
                handled = stepNavigationFocus(gameRoot, intent === "next" ? 1 : -1) || handled;
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
                if (!ownerCanGoBack(owner, input.isEntrySurface)) {
                    break;
                }
                const navigation = owner.host.hostAdapter.blueprintRuntime?.hostApi?.navigation;
                if (navigation) {
                    void navigation.pageBack().catch(() => undefined);
                    handled = true;
                }
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
