/**
 * The focus a running game moves between its controls, and the operations that move it.
 *
 * One focus for every device (see `@shared/types/ui-editor/navigation`). It is the browser's own
 * keyboard focus - so a focused button already hears Enter, a list row already knows it is the row,
 * and the focus and blur heads already fire - with three things the browser does not give a game:
 *
 *  - **Where navigation happens.** The surface that owns the keyboard (`keyboardOwner`) is the
 *    scope, marked on its shell as {@link NAV_SCOPE_ATTRIBUTE} `owner`. With nothing owning the keys
 *    and the story on screen, the stage's choice menu is the scope (`stage`). Nothing else is ever
 *    reachable: a page under a modal layer is not, and neither is the quick menu during dialogue.
 *  - **Moving by direction**, by where the controls are drawn (`spatialNavigation`), within the groups
 *    an author made and past the overrides an author named.
 *  - **Where the pointer is.** A pointer resting on a control makes it the control the next direction
 *    starts from, and takes the focus away from wherever the keys left it, so there is one selected
 *    control on screen rather than a hovered one and a focused one. It does not take the browser's
 *    focus itself: a control the mouse merely passes over must not start answering Space - click
 *    Auto on the quick menu, press Space, and the story reads on (see `pointerKeyboardFocus`).
 *
 * The controls are found, not registered: anything matching {@link GAME_CONTROL_SELECTOR} is one,
 * the way the keyboard always found them, less what an author took out (`data-ui-nav-focusable`
 * `never`, on it or around it) and plus what an author put in (`always`, on an element's own box).
 *
 * The ring is drawn by `styles.css` while the game root's {@link NAV_MODALITY_ATTRIBUTE} says the
 * player is moving by keys or pad, and not while they are pointing - one rule for both, where
 * `:focus-visible` would be the browser's guess about a pad it cannot see.
 *
 * Comments in English per project convention.
 */

import type {
    UIElementNavigation,
    UINavigationAutoFocus,
    UINavigationDirection,
    UISurfaceNavigation,
} from "@shared/types/ui-editor/navigation";
import { GAME_ROOT_ATTRIBUTE } from "../input/keyboardFocusHandover";
import { pressLikeEnter } from "../input/syntheticKeyPress";
import {
    findNavigationTarget,
    firstInReadingOrder,
    type NavigationCandidate,
    type NavigationRect,
    type NavigationRegionRef,
} from "./spatialNavigation";

// === What the DOM says ====================================================================

/**
 * On a surface's shell: `owner` while it owns the keyboard, `stage` on the choice menu, `controls` on
 * the stage's other surfaces - reachable only once the player steps into them (`toggleStageControls`).
 */
export const NAV_SCOPE_ATTRIBUTE = "data-ui-nav-scope";
/** On a surface's shell: the element the focus starts on. */
export const NAV_DEFAULT_ATTRIBUTE = "data-ui-nav-default";
/** On a surface's shell: `UISurfaceNavigation.autoFocus`, when it is not the default. */
export const NAV_AUTO_FOCUS_ATTRIBUTE = "data-ui-nav-autofocus";
/** On a surface's shell or a group's box: moving past the edge comes back round. */
export const NAV_WRAP_ATTRIBUTE = "data-ui-nav-wrap";
/** On an element's box: `always` or `never`. */
export const NAV_FOCUSABLE_ATTRIBUTE = "data-ui-nav-focusable";
/** On an element's box: it is a group. */
export const NAV_REGION_ATTRIBUTE = "data-ui-nav-region";
/** On a group's box: coming back in lands where the player left. */
export const NAV_REMEMBER_ATTRIBUTE = "data-ui-nav-remember";
/** On an element's box: where the focus starts unless the surface names one. */
export const NAV_PREFERRED_ATTRIBUTE = "data-ui-nav-preferred";
/** On an element's box: it has a look of its own for being hovered (`uiElementHasHoverLook`). */
export const HOVER_LOOK_ATTRIBUTE = "data-ui-hover-look";
/**
 * On a focused control: it is drawn with its own hover look rather than the ring. Set as the focus
 * arrives (`noteFocusInGame`), whichever way it arrived.
 */
export const FOCUS_SHOWS_HOVER_ATTRIBUTE = "data-nl-nav-hover";
/** On the game root: `keys` while the player moves by keyboard or pad, `pointer` while pointing. */
export const NAV_MODALITY_ATTRIBUTE = "data-nl-nav-modality";

export function navNeighborAttribute(direction: UINavigationDirection): string {
    return `data-ui-nav-${direction}`;
}

const ELEMENT_ID_ATTRIBUTE = "data-ui-element-id";
const SURFACE_ID_ATTRIBUTE = "data-ui-surface-id";
const LIST_ROW_ATTRIBUTE = "data-ui-list-item-index";

/**
 * The controls a game draws: a button, a switch, a list row. The keyboard's focus ring, the pointer
 * press that does not focus (`pointerKeyboardFocus`) and the Enter a focused control takes for itself
 * (`keyInputClaimedByControl`) all name these.
 */
export const GAME_CONTROL_SELECTOR = [
    '[role="button"][tabindex]',
    '[role="switch"][tabindex]',
    '[role="slider"][tabindex]',
    "[data-ui-list-item-index][tabindex]",
].join(", ");

/**
 * Raised on the focused control before a direction moves the focus away from it, cancelable. A
 * control that has a use for the direction itself - a slider for the arrows along its track -
 * prevents it and does that instead, so moving across a settings page and nudging a volume are the
 * same buttons, as they are in every console menu. `detail.direction` says which way.
 */
export const NAVIGATE_EVENT = "nl-navigate";

export type NavigateEventDetail = { direction: UINavigationDirection };

/** Let the focused control have the direction first. True when it took it. */
function offerDirectionToControl(target: HTMLElement, direction: UINavigationDirection): boolean {
    const view = target.ownerDocument.defaultView;
    const CustomEventCtor = view?.CustomEvent ?? CustomEvent;
    const event = new CustomEventCtor<NavigateEventDetail>(NAVIGATE_EVENT, { detail: { direction }, cancelable: true });
    target.dispatchEvent(event);
    return event.defaultPrevented;
}

/**
 * The controls, and the boxes an author made reachable: everything navigation lands on that a click
 * must not leave the focus on (`pointerKeyboardFocus`), and that answers Enter itself.
 */
export const CONTROL_TARGET_SELECTOR = `${GAME_CONTROL_SELECTOR}, [${NAV_FOCUSABLE_ATTRIBUTE}="always"]`;

/** A field the player types into. Reachable, and never taken from the player by a passing pointer. */
const TEXT_ENTRY_SELECTOR = 'input:not([type="hidden"]):not([disabled]), textarea:not([disabled])';

/**
 * Everything navigation can land on: the controls, the text fields - which a click does focus, so
 * they are not among the controls above - and what an author made reachable.
 */
export const NAVIGATION_TARGET_SELECTOR = `${CONTROL_TARGET_SELECTOR}, ${TEXT_ENTRY_SELECTOR}`;

/**
 * What an element's navigation record puts on its box. Only what differs from the default is
 * written, so an element nobody touched carries none of these.
 */
export function elementNavigationAttributes(navigation: UIElementNavigation | null): Record<string, string> {
    const attributes: Record<string, string> = {};
    if (!navigation) {
        return attributes;
    }
    if (navigation.focusable === "always" || navigation.focusable === "never") {
        attributes[NAV_FOCUSABLE_ATTRIBUTE] = navigation.focusable;
    }
    for (const [direction, elementId] of Object.entries(navigation.neighbors ?? {})) {
        if (elementId) {
            attributes[navNeighborAttribute(direction as UINavigationDirection)] = elementId;
        }
    }
    if (navigation.region) {
        attributes[NAV_REGION_ATTRIBUTE] = "";
        if (navigation.region.wrap) {
            attributes[NAV_WRAP_ATTRIBUTE] = "";
        }
        if (navigation.region.rememberLast) {
            attributes[NAV_REMEMBER_ATTRIBUTE] = "";
        }
    }
    if (navigation.preferredOnEntry) {
        attributes[NAV_PREFERRED_ATTRIBUTE] = "";
    }
    return attributes;
}

/** What a surface's navigation record puts on its shell. */
export function surfaceNavigationAttributes(navigation: UISurfaceNavigation): Record<string, string> {
    const attributes: Record<string, string> = {};
    if (navigation.defaultFocusElementId) {
        attributes[NAV_DEFAULT_ATTRIBUTE] = navigation.defaultFocusElementId;
    }
    if (navigation.autoFocus && navigation.autoFocus !== "device") {
        attributes[NAV_AUTO_FOCUS_ATTRIBUTE] = navigation.autoFocus;
    }
    if (navigation.wrap) {
        attributes[NAV_WRAP_ATTRIBUTE] = "";
    }
    return attributes;
}

// === Per game =============================================================================

type GameNavigationState = {
    /** The control the pointer last rested on, which the next direction starts from. */
    pointerTarget: HTMLElement | null;
    /** For each group that remembers: the control the player was last on inside it. */
    regionMemory: WeakMap<Element, HTMLElement>;
    /** Where the pointer last was, so a page scrolling under a still pointer is not a hover. */
    lastPointer: { x: number; y: number } | null;
    /**
     * For each surface, the control the focus was last on: its element, and its row in a list.
     *
     * By surface id rather than by drawing, because a page the player goes back to is drawn again
     * from nothing - the Title under a Config page is unmounted while Config is up - and the control
     * it is drawn with is a new element. Going back lands where the player left.
     */
    lastFocus: Map<string, { elementId: string; row: string | null }>;
    /** Whether the player has stepped into the stage's controls (`toggleStageControls`). */
    stageControls: boolean;
};

const gameStates = new WeakMap<Element, GameNavigationState>();

function stateOf(gameRoot: Element): GameNavigationState {
    let state = gameStates.get(gameRoot);
    if (!state) {
        state = { pointerTarget: null, regionMemory: new WeakMap(), lastPointer: null, lastFocus: new Map(), stageControls: false };
        gameStates.set(gameRoot, state);
    }
    return state;
}

function gameRootOf(element: Element): Element | null {
    return element.closest(`[${GAME_ROOT_ATTRIBUTE}]`);
}

function setModality(gameRoot: Element, modality: "keys" | "pointer"): void {
    if (gameRoot.getAttribute(NAV_MODALITY_ATTRIBUTE) !== modality) {
        gameRoot.setAttribute(NAV_MODALITY_ATTRIBUTE, modality);
    }
}

// === Scope and targets ====================================================================

/**
 * The surface navigation happens on right now, or null.
 *
 * The owner's shell when an entry owns the keyboard - the last one in the document if two claim it
 * in the instant one hands over to the next, since the later one is drawn above - else a stage menu.
 */
export function resolveNavigationScope(gameRoot: Element): HTMLElement | null {
    const pick = (value: string): HTMLElement | null => {
        const shells = Array.from(gameRoot.querySelectorAll<HTMLElement>(`[${NAV_SCOPE_ATTRIBUTE}="${value}"]`))
            .filter(shell => shell.closest("[inert]") === null);
        return shells[shells.length - 1] ?? null;
    };
    const owner = pick("owner");
    const state = stateOf(gameRoot);
    if (owner) {
        // Something opened over the story took the keys; the story's controls are not where the
        // player will be when it closes.
        state.stageControls = false;
        return owner;
    }
    const choice = pick("stage");
    if (choice) {
        state.stageControls = false;
        return choice;
    }
    // The controls on the stage - the quick menu, the dialogue box's own buttons - only while the
    // player has asked for them (`toggleStageControls`). Several surfaces at once, so the scope is
    // the game root and the targets are the ones inside a `controls` shell.
    return state.stageControls && gameRoot instanceof HTMLElement ? gameRoot : null;
}

/** Whether `scope` is the stage's controls, which are spread over several surfaces. */
function isStageControlsScope(scope: HTMLElement): boolean {
    return scope.hasAttribute(GAME_ROOT_ATTRIBUTE);
}

/** The stage's controls, while the player has stepped into them. */
function stageControlTargets(gameRoot: HTMLElement): HTMLElement[] {
    return collectNavigationTargets(gameRoot);
}

/**
 * Step into the controls on the stage - the quick menu, the buttons on the dialogue box - or back
 * out of them. During dialogue the D-pad does not wander onto the quick menu: a press meant to read
 * on must not land on Save. So the controls are a place the player goes to on purpose, and leaves
 * the same way or with Cancel.
 *
 * Returns whether anything changed. Nothing does while a page or a choice holds the navigation, or
 * when the stage has no controls to go to.
 */
export function toggleStageControls(gameRoot: Element): boolean {
    if (!(gameRoot instanceof HTMLElement)) {
        return false;
    }
    const state = stateOf(gameRoot);
    if (state.stageControls) {
        return leaveStageControls(gameRoot);
    }
    if (resolveNavigationScope(gameRoot)) {
        return false;
    }
    state.stageControls = true;
    const targets = stageControlTargets(gameRoot);
    const entry = targets.length > 0 ? navigationEntryTarget(gameRoot, targets) : null;
    if (!entry || !focusNavigationTarget(entry)) {
        state.stageControls = false;
        return false;
    }
    return true;
}

/** Leave the stage's controls, if the player is in them. The next press is the story's again. */
export function leaveStageControls(gameRoot: Element): boolean {
    const state = stateOf(gameRoot);
    if (!state.stageControls) {
        return false;
    }
    state.stageControls = false;
    const active = gameRoot.ownerDocument.activeElement;
    if (active instanceof HTMLElement && active.closest(`[${NAV_SCOPE_ATTRIBUTE}="controls"]`)) {
        active.blur();
    }
    return true;
}

function isDrawn(element: HTMLElement): boolean {
    const rect = element.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) {
        return false;
    }
    const style = element.ownerDocument.defaultView?.getComputedStyle(element);
    return style?.visibility !== "hidden";
}

/** Whether `element` may hold the focus as a navigation target inside `scope`. */
export function isNavigationTarget(element: Element, scope: HTMLElement): element is HTMLElement {
    if (!(element instanceof HTMLElement) || !scope.contains(element) || !element.matches(NAVIGATION_TARGET_SELECTOR)) {
        return false;
    }
    if (isStageControlsScope(scope)
        && element.closest(`[${NAV_SCOPE_ATTRIBUTE}]`)?.getAttribute(NAV_SCOPE_ATTRIBUTE) !== "controls") {
        return false;
    }
    if (element.closest("[inert]") !== null || element.getAttribute("aria-disabled") === "true") {
        return false;
    }
    // `never` takes out the element it is on and everything inside it.
    const excluded = element.closest(`[${NAV_FOCUSABLE_ATTRIBUTE}="never"]`);
    if (excluded && scope.contains(excluded)) {
        return false;
    }
    return isDrawn(element);
}

/** Every control navigation can reach in `scope`, in document order. */
export function collectNavigationTargets(scope: HTMLElement): HTMLElement[] {
    return Array.from(scope.querySelectorAll(NAVIGATION_TARGET_SELECTOR))
        .filter((element): element is HTMLElement => isNavigationTarget(element, scope));
}

/** The groups `target` is inside within `scope`, outermost first. */
function regionsOf(target: HTMLElement, scope: HTMLElement, keys: Map<Element, string>): NavigationRegionRef[] {
    const regions: NavigationRegionRef[] = [];
    let node: Element | null = target.parentElement;
    while (node && node !== scope) {
        if (node.hasAttribute(NAV_REGION_ATTRIBUTE)) {
            let key = keys.get(node);
            if (!key) {
                key = `region:${keys.size}`;
                keys.set(node, key);
            }
            regions.unshift({ key, wrap: node.hasAttribute(NAV_WRAP_ATTRIBUTE) });
        }
        node = node.parentElement;
    }
    return regions;
}

function rectOf(element: Element): NavigationRect {
    const rect = element.getBoundingClientRect();
    return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}

function candidatesOf(scope: HTMLElement, targets: readonly HTMLElement[]): NavigationCandidate<HTMLElement>[] {
    const keys = new Map<Element, string>();
    return targets.map(target => ({ target, rect: rectOf(target), regions: regionsOf(target, scope, keys) }));
}

/** The box of the element a target belongs to: its own for an element's box, its widget's otherwise. */
function owningElementBox(target: HTMLElement): HTMLElement | null {
    return target.closest<HTMLElement>(`[${ELEMENT_ID_ATTRIBUTE}]`);
}

/** The targets that are, or are inside, the element with this id. */
function targetsOfElement(targets: readonly HTMLElement[], elementId: string): HTMLElement[] {
    return targets.filter(target => {
        for (let node: Element | null = target; node; node = node.parentElement) {
            if (node.getAttribute(ELEMENT_ID_ATTRIBUTE) === elementId) {
                return true;
            }
        }
        return false;
    });
}

/** Of several targets, the one to land on: a list's selected row, else the first in reading order. */
function preferredAmong(targets: readonly HTMLElement[], scope: HTMLElement): HTMLElement | null {
    if (targets.length === 0) {
        return null;
    }
    const selected = targets.find(target => target.getAttribute("tabindex") === "0" && target.hasAttribute("data-ui-list-item-index"));
    if (selected && targets.length > 1 && targets.every(target => target.hasAttribute("data-ui-list-item-index"))) {
        return selected;
    }
    return firstInReadingOrder(candidatesOf(scope, targets))?.target ?? null;
}

// === Where the focus is ===================================================================

/**
 * The control the next move starts from, and whether the browser's focus is on it.
 *
 * The focused control if the focus is on one in the scope; else the one the pointer rests on.
 */
export function currentNavigationTarget(scope: HTMLElement): { target: HTMLElement; focused: boolean } | null {
    const active = scope.ownerDocument.activeElement;
    if (active && isNavigationTarget(active, scope)) {
        return { target: active, focused: true };
    }
    const gameRoot = gameRootOf(scope);
    const pointed = gameRoot ? stateOf(gameRoot).pointerTarget : null;
    if (pointed && pointed.isConnected && isNavigationTarget(pointed, scope)) {
        return { target: pointed, focused: false };
    }
    return null;
}

/** The control a Confirm would press: one the focus is on, never one the pointer only rests on. */
export function focusedNavigationTarget(gameRoot: Element): HTMLElement | null {
    const scope = resolveNavigationScope(gameRoot);
    const current = scope ? currentNavigationTarget(scope) : null;
    return current?.focused ? current.target : null;
}

/** Scroll the nearest scrolling box around `target` just far enough to show it. Never the page. */
function reveal(target: HTMLElement, scope: HTMLElement): void {
    const view = target.ownerDocument.defaultView;
    let node: HTMLElement | null = target.parentElement;
    while (node && node !== scope) {
        const style = view?.getComputedStyle(node);
        const scrollsY = (style?.overflowY === "auto" || style?.overflowY === "scroll") && node.scrollHeight > node.clientHeight;
        const scrollsX = (style?.overflowX === "auto" || style?.overflowX === "scroll") && node.scrollWidth > node.clientWidth;
        if (scrollsY || scrollsX) {
            const box = node.getBoundingClientRect();
            const rect = target.getBoundingClientRect();
            if (scrollsY) {
                if (rect.top < box.top) {
                    node.scrollTop -= box.top - rect.top;
                } else if (rect.bottom > box.bottom) {
                    node.scrollTop += Math.min(rect.bottom - box.bottom, rect.top - box.top);
                }
            }
            if (scrollsX) {
                if (rect.left < box.left) {
                    node.scrollLeft -= box.left - rect.left;
                } else if (rect.right > box.right) {
                    node.scrollLeft += Math.min(rect.right - box.right, rect.left - box.left);
                }
            }
            return;
        }
        node = node.parentElement;
    }
}

/** Put the focus on `target`, as a move by keys or pad (or the game itself) does. */
export function focusNavigationTarget(target: HTMLElement): boolean {
    const gameRoot = gameRootOf(target);
    const scope = target.closest<HTMLElement>(`[${NAV_SCOPE_ATTRIBUTE}]`);
    target.focus({ preventScroll: true });
    if (target.ownerDocument.activeElement !== target) {
        return false;
    }
    if (scope) {
        reveal(target, scope);
    }
    if (gameRoot) {
        const state = stateOf(gameRoot);
        state.pointerTarget = null;
        setModality(gameRoot, "keys");
        const surfaceId = scope?.getAttribute(SURFACE_ID_ATTRIBUTE);
        const elementId = owningElementBox(target)?.getAttribute(ELEMENT_ID_ATTRIBUTE);
        if (surfaceId && elementId) {
            state.lastFocus.set(surfaceId, { elementId, row: target.getAttribute(LIST_ROW_ATTRIBUTE) });
        }
        let node: Element | null = target.parentElement;
        while (node && node !== scope) {
            if (node.hasAttribute(NAV_REMEMBER_ATTRIBUTE)) {
                state.regionMemory.set(node, target);
            }
            node = node.parentElement;
        }
    }
    return true;
}

/**
 * The control a scope starts on: the surface's named element, else one marked preferred, else the
 * first in reading order.
 */
export function navigationEntryTarget(scope: HTMLElement, targets = collectNavigationTargets(scope)): HTMLElement | null {
    const remembered = rememberedTarget(scope, targets);
    if (remembered) {
        return remembered;
    }
    const named = scope.getAttribute(NAV_DEFAULT_ATTRIBUTE);
    if (named) {
        const found = preferredAmong(targetsOfElement(targets, named), scope);
        if (found) {
            return found;
        }
    }
    const preferred = targets.filter(target => target.closest(`[${NAV_PREFERRED_ATTRIBUTE}]`) !== null);
    return preferredAmong(preferred.length > 0 ? preferred : targets, scope);
}

/** The control the player last left this surface from, if it is still there to land on. */
function rememberedTarget(scope: HTMLElement, targets: readonly HTMLElement[]): HTMLElement | null {
    const gameRoot = gameRootOf(scope);
    const surfaceId = scope.getAttribute(SURFACE_ID_ATTRIBUTE);
    // A choice menu is a new question every time it appears; the option picked last time is not
    // where the next one starts.
    if (scope.getAttribute(NAV_SCOPE_ATTRIBUTE) === "stage") {
        return null;
    }
    const last = gameRoot && surfaceId ? stateOf(gameRoot).lastFocus.get(surfaceId) : undefined;
    if (!last) {
        return null;
    }
    const ofElement = targets.filter(target => owningElementBox(target)?.getAttribute(ELEMENT_ID_ATTRIBUTE) === last.elementId);
    return ofElement.find(target => target.getAttribute(LIST_ROW_ATTRIBUTE) === last.row) ?? ofElement[0] ?? null;
}

// === The operations =======================================================================

/** The groups `target` is in that `from` is not, outermost first. */
function enteredRegions(target: HTMLElement, from: HTMLElement, scope: HTMLElement): Element[] {
    const entered: Element[] = [];
    let node: Element | null = target.parentElement;
    while (node && node !== scope) {
        if (node.hasAttribute(NAV_REGION_ATTRIBUTE) && !node.contains(from)) {
            entered.unshift(node);
        }
        node = node.parentElement;
    }
    return entered;
}

/**
 * Where `direction` goes from `current`: an author's override when the move leaves the element the
 * override is on, a remembered control when it enters a group that remembers, the layout otherwise.
 */
function resolveMove(scope: HTMLElement, current: HTMLElement, direction: UINavigationDirection): HTMLElement | null {
    const targets = collectNavigationTargets(scope);
    const candidates = candidatesOf(scope, targets.includes(current) ? targets : [...targets, current]);
    const self = candidates.find(candidate => candidate.target === current);
    if (!self) {
        return null;
    }
    let next = findNavigationTarget({
        current: self,
        candidates,
        direction,
        wrap: scope.hasAttribute(NAV_WRAP_ATTRIBUTE),
    })?.target ?? null;

    // An override names where the player goes on leaving this element, so a move that stays inside
    // it - one row of a list to the next - is the layout's to answer.
    const box = owningElementBox(current);
    const override = box?.getAttribute(navNeighborAttribute(direction));
    if (box && override && !(next && box.contains(next))) {
        const named = preferredAmong(targetsOfElement(targets, override).filter(target => target !== current), scope);
        if (named) {
            next = named;
        }
    }
    if (!next) {
        return null;
    }
    const gameRoot = gameRootOf(scope);
    if (gameRoot) {
        const memory = stateOf(gameRoot).regionMemory;
        for (const region of enteredRegions(next, current, scope)) {
            if (!region.hasAttribute(NAV_REMEMBER_ATTRIBUTE)) {
                continue;
            }
            const remembered = memory.get(region);
            if (remembered && remembered.isConnected && region.contains(remembered) && isNavigationTarget(remembered, scope)) {
                return remembered;
            }
            break;
        }
    }
    return next;
}

/**
 * Move the focus one way. With nothing to start from, the first press lands on the scope's entry
 * control instead - the press that tells the game the player has picked up a pad.
 *
 * Returns whether the press did anything, so a key that moved nothing can still be the page's.
 */
export function moveNavigationFocus(gameRoot: Element, direction: UINavigationDirection): boolean {
    const scope = resolveNavigationScope(gameRoot);
    if (!scope) {
        return false;
    }
    const current = currentNavigationTarget(scope);
    if (!current) {
        const entry = navigationEntryTarget(scope);
        return entry ? focusNavigationTarget(entry) : false;
    }
    if (current.focused && offerDirectionToControl(current.target, direction)) {
        setModality(gameRoot, "keys");
        return true;
    }
    const next = resolveMove(scope, current.target, direction);
    if (!next) {
        // Nowhere to go, but a control the pointer rested on still becomes the focused one: the
        // player pressed a direction, and now sees where they are.
        return current.focused ? false : focusNavigationTarget(current.target);
    }
    return focusNavigationTarget(next);
}

/**
 * Move the focus to the next or previous control in reading order, as Tab does.
 *
 * Only the controls the browser's Tab would stop on: a list is one stop, on the row it would enter
 * on, however many rows it has. Comes back round at either end, as Tab inside a dialog does.
 */
export function stepNavigationFocus(gameRoot: Element, delta: 1 | -1): boolean {
    const scope = resolveNavigationScope(gameRoot);
    if (!scope) {
        return false;
    }
    const current = currentNavigationTarget(scope);
    const stops = collectNavigationTargets(scope).filter(target => target.tabIndex >= 0 || target === current?.target);
    if (stops.length === 0) {
        return false;
    }
    const index = current ? stops.indexOf(current.target) : -1;
    const next = index < 0
        ? stops[delta > 0 ? 0 : stops.length - 1]
        : stops[(index + delta + stops.length) % stops.length];
    return focusNavigationTarget(next);
}

/**
 * Press the focused control, as Enter on it would. Only the browser's focus counts: the pointer
 * resting on a control does not make Confirm press it.
 */
export function confirmNavigationFocus(gameRoot: Element): boolean {
    const target = focusedNavigationTarget(gameRoot);
    if (!target) {
        return false;
    }
    pressLikeEnter(target);
    return true;
}

// === Entering a scope =====================================================================

/** Whether the focus belongs to the game and may be moved without taking it from the player. */
function focusIsTheGames(scope: HTMLElement): boolean {
    const document = scope.ownerDocument;
    const active = document.activeElement;
    if (!active || active === document.body || active === document.documentElement || active === scope) {
        return true;
    }
    const gameRoot = gameRootOf(scope);
    return gameRoot !== null && gameRoot.contains(active) && !active.matches(`${TEXT_ENTRY_SELECTOR}, [contenteditable]`);
}

/**
 * Put the focus on a scope's entry control as it opens, when the surface asks for that and the
 * player's device needs it. A focus already inside the scope - the control a layer gives back as it
 * closes - is left where it is.
 */
export function enterNavigationScope(
    scope: HTMLElement,
    device: "pointer" | "key" | "gamepad" | "touch",
): "focused" | "skipped" | "empty" {
    const mode = (scope.getAttribute(NAV_AUTO_FOCUS_ATTRIBUTE) ?? "device") as UINavigationAutoFocus;
    if (mode === "never" || (mode === "device" && device !== "key" && device !== "gamepad")) {
        return "skipped";
    }
    const active = scope.ownerDocument.activeElement;
    if (active && active !== scope && scope.contains(active)) {
        return "skipped";
    }
    if (!focusIsTheGames(scope)) {
        return "skipped";
    }
    const entry = navigationEntryTarget(scope);
    if (!entry) {
        return "empty";
    }
    return focusNavigationTarget(entry) ? "focused" : "empty";
}

/** How long a scope that has opened with nothing to focus yet keeps asking: its rows may still be on their way. */
const ENTRY_RETRY_MS = 50;
const ENTRY_RETRIES = 20;

/**
 * {@link enterNavigationScope}, asked again for a little while if the scope has nothing to focus
 * yet - a choice menu is mounted before its rows are, a page before its list has its items. Returns
 * a function that stops asking.
 */
export function scheduleNavigationEntry(
    scope: HTMLElement,
    readDevice: () => "pointer" | "key" | "gamepad" | "touch",
): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let attempts = 0;
    const attempt = () => {
        timer = null;
        if (!scope.isConnected) {
            return;
        }
        if (enterNavigationScope(scope, readDevice()) === "empty" && attempts < ENTRY_RETRIES) {
            attempts += 1;
            timer = setTimeout(attempt, ENTRY_RETRY_MS);
        }
    };
    attempt();
    return () => {
        if (timer) {
            clearTimeout(timer);
        }
    };
}

// === The pointer ==========================================================================

/**
 * The pointer moved over the game: the control under it becomes the one the next direction starts
 * from, and a focus the keys left elsewhere goes, so one control looks selected.
 *
 * Only real movement counts. A list scrolling under a pointer that has not moved, or a page arriving
 * under it, is not the player choosing anything.
 */
export function notePointerOverGame(gameRoot: Element, event: Pick<PointerEvent, "clientX" | "clientY" | "target" | "pointerType">): void {
    const state = stateOf(gameRoot);
    const moved = !state.lastPointer || state.lastPointer.x !== event.clientX || state.lastPointer.y !== event.clientY;
    state.lastPointer = { x: event.clientX, y: event.clientY };
    if (!moved || event.pointerType === "touch") {
        return;
    }
    const scope = resolveNavigationScope(gameRoot);
    const under = event.target instanceof Element ? event.target.closest(NAVIGATION_TARGET_SELECTOR) : null;
    if (!scope || !under || !isNavigationTarget(under, scope) || under === state.pointerTarget) {
        return;
    }
    state.pointerTarget = under;
    setModality(gameRoot, "pointer");
    const active = scope.ownerDocument.activeElement;
    if (active instanceof HTMLElement && active !== under && isNavigationTarget(active, scope)
        && !active.matches(TEXT_ENTRY_SELECTOR)) {
        // Back to the scope itself, which is where an owner holds the keys from; a stage menu's
        // shell takes no focus, and the focus simply leaves.
        if (scope.tabIndex >= 0 || scope.hasAttribute("tabindex")) {
            scope.focus({ preventScroll: true });
        } else {
            active.blur();
        }
    }
}

/** A press anywhere is pointing: the ring goes until the keys move the focus again. */
export function notePointerPressOnGame(gameRoot: Element): void {
    setModality(gameRoot, "pointer");
    // A player who reaches for the mouse has left the stage's controls by the keys.
    stateOf(gameRoot).stageControls = false;
}

/**
 * Whether a control is drawn with an author's hover look when it has the focus: its own element, or
 * something inside it - a button's label, a list row's template - has one.
 */
function focusShowsHoverLook(target: HTMLElement): boolean {
    const selector = `[${HOVER_LOOK_ATTRIBUTE}]`;
    if (target.matches(selector) || target.querySelector(selector)) {
        return true;
    }
    if (target.hasAttribute(LIST_ROW_ATTRIBUTE)) {
        return false;
    }
    const box = owningElementBox(target);
    if (box && (box.matches(selector) || box.querySelector(selector))) {
        return true;
    }
    // A box around the control that holds no other control is part of it - a save slot around its
    // hit area - and lights up with it (`setFocusWithin`). A box that holds others is the page's.
    for (let node = box?.parentElement ?? null; node; node = node.parentElement) {
        if (node.hasAttribute(NAV_SCOPE_ATTRIBUTE) || node.querySelectorAll(NAVIGATION_TARGET_SELECTOR).length > 1) {
            return false;
        }
        if (node.matches(selector)) {
            return true;
        }
    }
    return false;
}

/**
 * The focus arrived on something in the game - by navigation, by a page giving it back, by a list's
 * Home key. A control the author gave a hover look is drawn with that look instead of the ring; one
 * with nothing of its own falls back to the ring, so a focused control is never invisible.
 */
export function noteFocusInGame(target: EventTarget | null): void {
    if (typeof HTMLElement === "undefined" || !(target instanceof HTMLElement) || !target.matches(CONTROL_TARGET_SELECTOR)) {
        return;
    }
    target.toggleAttribute(FOCUS_SHOWS_HOVER_ATTRIBUTE, focusShowsHoverLook(target));
}

/** What navigation looks like right now, for the hint bar to say what the buttons do. */
export type NavigationStateSummary = {
    /** Where the focus moves: a page or layer, the choice menu, the stage's controls, or nowhere. */
    scope: "owner" | "choice" | "controls" | null;
    /** How many controls the focus can land on there. */
    targets: number;
    /** Whether the stage has controls the player could step into (`toggleStageControls`). */
    stageControlsAvailable: boolean;
};

export function describeNavigationState(gameRoot: Element): NavigationStateSummary {
    const scope = resolveNavigationScope(gameRoot);
    const kind = !scope
        ? null
        : isStageControlsScope(scope)
            ? "controls"
            : scope.getAttribute(NAV_SCOPE_ATTRIBUTE) === "owner" ? "owner" : "choice";
    return {
        scope: kind,
        targets: scope ? collectNavigationTargets(scope).length : 0,
        stageControlsAvailable: kind === null && gameRoot instanceof HTMLElement && stageControlTargets(gameRoot).length > 0,
    };
}
