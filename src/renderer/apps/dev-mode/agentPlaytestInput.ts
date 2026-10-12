/**
 * An agent's hands on a running Dev Mode game: find an element of the interface on screen, point at
 * it and press it, or press a key.
 *
 * The rule this module keeps is that every act travels the way a player's does, so an act that works
 * here is evidence the game works. A click is the pointer events a mouse raises, dispatched on
 * whatever is on top at a point inside the element's box - the page under a modal layer is not
 * reachable, and neither is a button something transparent covers. A key is a `keydown` and a
 * `keyup` on the focused element (the page body when nothing in the game holds the focus), so it
 * reaches the game's own key listener on the window and from there the input actions bound to it,
 * the focus navigation (`nl.nav.*`) and the owner's key heads, exactly as a keyboard's would. None of
 * these events is marked as the game's own (`syntheticKeyPress`), because they are not: they stand
 * for the player's.
 *
 * Nothing here focuses the window or moves the operating system's pointer, so driving a game never
 * takes the author's keyboard or mouse away from what they are doing.
 *
 * Which elements are on screen is read off the DOM rather than the document: only the DOM knows which
 * pages and layers are drawn right now, which list rows exist, and what is on top of what. The
 * document names what is found there.
 *
 * Comments in English per project convention.
 */

import type { UIDocument, UIElement } from "@shared/types/ui-editor/document";
import { DEV_MODE_AGENT_KEYS, DEV_MODE_AGENT_POINTER_KEYS, type DevModeAgentPointerGesture } from "@shared/types/devMode";
import { uiElementPathSegments } from "@/lib/workspace/services/agent/uiElementRefs";

const ELEMENT_ID_ATTRIBUTE = "data-ui-element-id";
const SURFACE_ID_ATTRIBUTE = "data-ui-surface-id";

/** A box in the window's client coordinates. */
export type InputBox = { left: number; top: number; width: number; height: number };

/** The game as this module reads and presses it. Real DOM in Dev Mode; a stand-in under test. */
export type InputEnvironment = {
    /** The element the game draws into. */
    root: Element;
    /** The interface document it is drawing. */
    document: UIDocument;
    /** Where `node` is drawn, or null when it is not drawn at all (hidden, or no box). */
    measure(node: Element): InputBox | null;
    /** What a pointer at this client point lands on: `document.elementFromPoint`. */
    hitTest(x: number, y: number): Element | null;
};

/** One drawing of an authored element on screen. */
export type DrawnElement = {
    node: Element;
    element: UIElement;
    surfaceId: string | null;
    surfaceName: string | null;
    /** Names from the surface root down, as the `.ui` format prints them. */
    path: string;
    box: InputBox;
};

export type InputTargetRequest = {
    element: string;
    surface?: string;
    index?: number;
};

export type InputTargetResolution =
    | { kind: "found"; target: DrawnElement }
    | { kind: "refused"; message: string };

/** How many candidates a refusal lists before it says how many more there were. */
const CANDIDATE_LIST_LIMIT = 24;

/** The browser's own measure and hit test, for the Dev Mode window. */
export function browserInputEnvironment(root: Element, document: UIDocument): InputEnvironment {
    const view = root.ownerDocument.defaultView;
    return {
        root,
        document,
        measure: node => {
            if (node.getClientRects().length === 0) {
                return null;
            }
            if (view && view.getComputedStyle(node).visibility === "hidden") {
                return null;
            }
            const rect = node.getBoundingClientRect();
            return rect.width > 0 && rect.height > 0
                ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height }
                : null;
        },
        hitTest: (x, y) => root.ownerDocument.elementFromPoint(x, y),
    };
}

/** The pool an element lives in: the page elements, or the component definition that holds it. */
function findElement(document: UIDocument, elementId: string): { element: UIElement; pool: Record<string, UIElement> } | null {
    const own = document.elements[elementId];
    if (own) {
        return { element: own, pool: document.elements };
    }
    for (const component of document.components ?? []) {
        const inner = component.elements[elementId];
        if (inner) {
            return { element: inner, pool: component.elements };
        }
    }
    return null;
}

/** Every authored element drawn under the game root right now, in document order. */
export function listDrawnElements(env: InputEnvironment): DrawnElement[] {
    const out: DrawnElement[] = [];
    const surfaces = new Map(env.document.surfaces.map(surface => [surface.id, surface]));
    for (const node of Array.from(env.root.querySelectorAll(`[${ELEMENT_ID_ATTRIBUTE}]`))) {
        const elementId = node.getAttribute(ELEMENT_ID_ATTRIBUTE);
        const found = elementId ? findElement(env.document, elementId) : null;
        if (!found) {
            continue;
        }
        const box = env.measure(node);
        if (!box) {
            continue;
        }
        const surfaceId = node.closest(`[${SURFACE_ID_ATTRIBUTE}]`)?.getAttribute(SURFACE_ID_ATTRIBUTE) ?? null;
        out.push({
            node,
            element: found.element,
            surfaceId,
            surfaceName: surfaceId ? surfaces.get(surfaceId)?.name ?? null : null,
            path: uiElementPathSegments(found.pool, found.element).join(" / "),
            box,
        });
    }
    return out;
}

/** The surfaces drawn right now, by name, in the order they are drawn (bottom first). */
export function listDrawnSurfaces(env: InputEnvironment): string[] {
    const names: string[] = [];
    const surfaces = new Map(env.document.surfaces.map(surface => [surface.id, surface]));
    for (const shell of Array.from(env.root.querySelectorAll(`[${SURFACE_ID_ATTRIBUTE}]`))) {
        const surface = surfaces.get(shell.getAttribute(SURFACE_ID_ATTRIBUTE) ?? "");
        if (!surface || names.includes(surface.name) || !env.measure(shell)) {
            continue;
        }
        names.push(surface.name);
    }
    return names;
}

/** An element as a refusal lists it: where it is, its path, and its id to name it by. */
export function describeDrawnElement(drawn: DrawnElement): string {
    const where = drawn.surfaceName ? `${drawn.surfaceName}: ` : "";
    return `${where}${drawn.path} (id ${drawn.element.id})`;
}

/**
 * Whether a drawn element looks like something a player presses: a control the focus can reach, or
 * an element the game marked as answering a press. Only used to choose what a refusal lists.
 */
function looksPressable(drawn: DrawnElement): boolean {
    const node = drawn.node;
    return node.hasAttribute("tabindex")
        || node.hasAttribute("data-ui-nav-focusable")
        || /button|switch|toggle|checkbox|slider|input|list/i.test(drawn.element.type);
}

function listCandidates(drawn: readonly DrawnElement[]): string {
    const unique: DrawnElement[] = [];
    const seen = new Set<string>();
    for (const item of drawn) {
        if (!seen.has(item.element.id)) {
            seen.add(item.element.id);
            unique.push(item);
        }
    }
    const shown = unique.slice(0, CANDIDATE_LIST_LIMIT).map(item => `- ${describeDrawnElement(item)}`);
    const more = unique.length > CANDIDATE_LIST_LIMIT ? `\n- ...and ${unique.length - CANDIDATE_LIST_LIMIT} more` : "";
    return `${shown.join("\n")}${more}`;
}

function endsWithPath(path: readonly string[], segments: readonly string[]): boolean {
    if (segments.length === 0 || segments.length > path.length) {
        return false;
    }
    const offset = path.length - segments.length;
    return segments.every((segment, index) => path[offset + index] === segment);
}

/** The words an element shows, collapsed - what a player reads on a button. */
function shownText(node: Element): string {
    return (node.textContent ?? "").replace(/\s+/g, " ").trim();
}

/** Screen order: top to bottom, then left to right, so `index` counts rows the way they read. */
function byScreenOrder(a: DrawnElement, b: DrawnElement): number {
    const dy = a.box.top - b.box.top;
    return Math.abs(dy) > 1 ? dy : a.box.left - b.box.left;
}

/**
 * The element a pointer act names, among what is drawn now.
 *
 * Tried in order: an id; a path of names (` / ` between them, the surface's name allowed as the first);
 * a name; and last the words it shows, for an agent that names a button by its label. A name two
 * different elements share is refused with both listed - pressing the wrong one is worse than not
 * pressing. One element drawn several times (a list's rows) takes `index`, counted in screen order.
 */
export function resolveInputTarget(env: InputEnvironment, request: InputTargetRequest): InputTargetResolution {
    const wanted = request.element.trim();
    if (!wanted) {
        return { kind: "refused", message: "Name the element to act on (`element`): its id, its path or its name." };
    }
    let drawn = listDrawnElements(env);
    if (drawn.length === 0) {
        return { kind: "refused", message: "Nothing of the interface is drawn yet; take a playtest_screenshot to see what is showing." };
    }
    if (request.surface) {
        const surface = request.surface.trim().toLowerCase();
        const onSurface = drawn.filter(item => item.surfaceId?.toLowerCase() === surface || item.surfaceName?.toLowerCase() === surface);
        if (onSurface.length === 0) {
            const shown = listDrawnSurfaces(env);
            return {
                kind: "refused",
                message: `No surface named "${request.surface}" is on screen. On screen now: ${shown.length > 0 ? shown.map(name => `"${name}"`).join(", ") : "none"}.`,
            };
        }
        drawn = onSurface;
    }

    let matches = drawn.filter(item => item.element.id === wanted);
    if (matches.length === 0) {
        const segments = wanted.split("/").map(segment => segment.trim()).filter(Boolean);
        if (segments.length > 1) {
            matches = drawn.filter(item => {
                const path = item.path.split(" / ");
                return endsWithPath(path, segments)
                    || (item.surfaceName === segments[0] && endsWithPath(path, segments.slice(1)));
            });
        } else {
            matches = drawn.filter(item => (item.element.name ?? item.element.type) === wanted);
            if (matches.length === 0) {
                const lower = wanted.toLowerCase();
                matches = drawn.filter(item => (item.element.name ?? "").toLowerCase() === lower);
            }
            if (matches.length === 0) {
                // By the words it shows: the innermost elements that show exactly these words, so a
                // button and the box around it holding only that button count once.
                const lower = wanted.toLowerCase();
                const showing = drawn.filter(item => shownText(item.node).toLowerCase() === lower);
                matches = showing.filter(item => !showing.some(other => other !== item && item.node.contains(other.node)));
            }
        }
    }

    if (matches.length === 0) {
        const pressable = drawn.filter(looksPressable);
        const listed = pressable.length > 0 ? pressable : drawn.filter(item => item.element.name);
        return {
            kind: "refused",
            message: `No element "${wanted}" is on screen${request.surface ? ` on "${request.surface}"` : ""}. `
                + `Elements that can be pressed there now:\n${listCandidates(listed.length > 0 ? listed : drawn)}`,
        };
    }
    const elementIds = new Set(matches.map(item => item.element.id));
    if (elementIds.size > 1) {
        return {
            kind: "refused",
            message: `"${wanted}" names ${elementIds.size} different elements on screen. Name one by its id or its path:\n${listCandidates(matches)}`,
        };
    }
    const drawings = [...matches].sort(byScreenOrder);
    if (request.index !== undefined) {
        const picked = drawings[request.index - 1];
        if (!picked) {
            return {
                kind: "refused",
                message: `"${wanted}" is drawn ${drawings.length} time(s) on screen; index ${request.index} is not one of them (index is 1-based, in screen order).`,
            };
        }
        return { kind: "found", target: picked };
    }
    if (drawings.length > 1) {
        return {
            kind: "refused",
            message: `"${wanted}" is drawn ${drawings.length} times on screen (rows of a list, or copies of a component). `
                + `Pass \`index\` 1-${drawings.length}, counted top to bottom, then left to right.`,
        };
    }
    return { kind: "found", target: drawings[0] };
}

// ---------------------------------------------------------------------------------------------
// Pointer
// ---------------------------------------------------------------------------------------------

/** The client point a press aims at: `at` as shares of the box from its top-left, the centre by default. */
export function pointInBox(box: InputBox, at?: { x: number; y: number }): { x: number; y: number } {
    const share = (value: number | undefined) => (value === undefined || !Number.isFinite(value) ? 0.5 : Math.min(1, Math.max(0, value)));
    return { x: box.left + box.width * share(at?.x), y: box.top + box.height * share(at?.y) };
}

/** The element a node belongs to, for naming what is on top: the nearest authored ancestor. */
function owningDrawn(env: InputEnvironment, node: Element): DrawnElement | null {
    const owner = node.closest(`[${ELEMENT_ID_ATTRIBUTE}]`);
    if (!owner || !env.root.contains(owner)) {
        return null;
    }
    return listDrawnElements(env).find(item => item.node === owner) ?? null;
}

type PointerInit = {
    x: number;
    y: number;
    button: number;
    buttons: number;
};

function dispatchPointer(target: Element, type: string, init: PointerInit, bubbles = true): boolean {
    const view = target.ownerDocument.defaultView;
    const pointerType = type.startsWith("pointer");
    const Ctor = (pointerType ? view?.PointerEvent ?? view?.MouseEvent : view?.MouseEvent) ?? MouseEvent;
    const event = new Ctor(type, {
        bubbles,
        cancelable: bubbles,
        composed: true,
        clientX: init.x,
        clientY: init.y,
        screenX: init.x,
        screenY: init.y,
        button: init.button,
        buttons: init.buttons,
        ...(pointerType ? { pointerId: 1, pointerType: "mouse", isPrimary: true, width: 1, height: 1, pressure: init.buttons ? 0.5 : 0 } : {}),
    } as PointerEventInit);
    return target.dispatchEvent(event);
}

/**
 * The pointer's state between acts: what it rests on, so moving to another element first leaves
 * this one the way a mouse does (its hover look goes, its `On Mouse Leave` runs).
 */
export class PlaytestPointer {
    private resting: { node: Element; x: number; y: number } | null = null;

    /** Move onto `node` at the point, leaving whatever the pointer rested on before. */
    moveTo(node: Element, x: number, y: number): void {
        const previous = this.resting;
        const init = { x, y, button: 0, buttons: 0 };
        if (previous && previous.node !== node && previous.node.isConnected) {
            const leaving = { x: previous.x, y: previous.y, button: 0, buttons: 0 };
            dispatchPointer(previous.node, "pointerout", leaving);
            dispatchPointer(previous.node, "pointerleave", leaving, false);
            dispatchPointer(previous.node, "mouseout", leaving);
            dispatchPointer(previous.node, "mouseleave", leaving, false);
        }
        if (!previous || previous.node !== node) {
            dispatchPointer(node, "pointerover", init);
            dispatchPointer(node, "pointerenter", init, false);
            dispatchPointer(node, "mouseover", init);
            dispatchPointer(node, "mouseenter", init, false);
        }
        dispatchPointer(node, "pointermove", init);
        dispatchPointer(node, "mousemove", init);
        this.resting = { node, x, y };
    }

    /** A press and release of `button` where the pointer rests, and what follows it. */
    press(button: 0 | 2): void {
        const resting = this.resting;
        if (!resting) {
            return;
        }
        const { node, x, y } = resting;
        const mask = button === 2 ? 2 : 1;
        dispatchPointer(node, "pointerdown", { x, y, button, buttons: mask });
        dispatchPointer(node, "mousedown", { x, y, button, buttons: mask });
        // The release lands on whatever is under the point by now; a press that opened something
        // over it still releases on the node it started on, as a mouse's does when nothing moves.
        dispatchPointer(node, "pointerup", { x, y, button, buttons: 0 });
        dispatchPointer(node, "mouseup", { x, y, button, buttons: 0 });
        dispatchPointer(node, button === 2 ? "contextmenu" : "click", { x, y, button, buttons: 0 });
    }

    /** One notch of the wheel where the pointer rests. */
    wheel(deltaY: number): void {
        const resting = this.resting;
        if (!resting) {
            return;
        }
        const view = resting.node.ownerDocument.defaultView;
        const Ctor = view?.WheelEvent ?? WheelEvent;
        resting.node.dispatchEvent(new Ctor("wheel", {
            bubbles: true,
            cancelable: true,
            composed: true,
            clientX: resting.x,
            clientY: resting.y,
            deltaY,
            deltaMode: 0,
        }));
    }
}

export type PointerActOutcome =
    | { kind: "done"; target: DrawnElement }
    | { kind: "refused"; message: string };

/**
 * Point at `target` and click it, or rest on it. The press lands on what is on top at the point,
 * which must be the element or something inside it; anything else covering it is refused, named.
 */
export function actOnElement(
    env: InputEnvironment,
    pointer: PlaytestPointer,
    target: DrawnElement,
    gesture: DevModeAgentPointerGesture,
    at?: { x: number; y: number },
): PointerActOutcome {
    const { x, y } = pointInBox(target.box, at);
    const hit = env.hitTest(x, y) ?? target.node;
    if (hit !== target.node && !target.node.contains(hit) && !hit.contains(target.node)) {
        const cover = owningDrawn(env, hit);
        const what = cover
            ? describeDrawnElement(cover)
            : env.root.contains(hit) ? "a part of the game that is not an interface element" : "something outside the game";
        return {
            kind: "refused",
            message: `${describeDrawnElement(target)} is covered at that point by ${what}, so a player's ${gesture} there would land on that instead. `
                + "Close what is on top first, pass `at` to aim at an uncovered part, or act on the covering element.",
        };
    }
    pointer.moveTo(hit, x, y);
    if (gesture === "click") {
        pointer.press(0);
    }
    return { kind: "done", target };
}

// ---------------------------------------------------------------------------------------------
// Keys
// ---------------------------------------------------------------------------------------------

/** A key as the `KeyboardEvent` a keyboard raises for it, or null for a key this does not press. */
export function keyEventInit(key: string): { key: string; code: string } | null {
    if ((DEV_MODE_AGENT_KEYS as readonly string[]).includes(key)) {
        return key === "Space" ? { key: " ", code: "Space" } : { key, code: key };
    }
    if (/^[a-z]$/i.test(key)) {
        return { key: key.toLowerCase(), code: `Key${key.toUpperCase()}` };
    }
    if (/^[0-9]$/.test(key)) {
        return { key, code: `Digit${key}` };
    }
    return null;
}

export function isPointerKey(key: string): key is (typeof DEV_MODE_AGENT_POINTER_KEYS)[number] {
    return (DEV_MODE_AGENT_POINTER_KEYS as readonly string[]).includes(key);
}

/** Every key spelling `playtest_key` takes, for a refusal. */
export function describeKnownKeys(): string {
    return `${[...DEV_MODE_AGENT_KEYS, ...DEV_MODE_AGENT_POINTER_KEYS].join(", ")}, or a single letter or digit`;
}

/**
 * Press and release a key where a keyboard's would go: the focused element when it is in the game,
 * the page body otherwise - never a field in Dev Mode's own panels, whose keys are not the game's.
 */
export function pressKey(env: InputEnvironment, init: { key: string; code: string }, shift = false): void {
    const doc = env.root.ownerDocument;
    const active = doc.activeElement;
    const target = active && active !== doc.body && env.root.contains(active) ? active : doc.body;
    const view = doc.defaultView;
    const Ctor = view?.KeyboardEvent ?? KeyboardEvent;
    for (const type of ["keydown", "keyup"] as const) {
        target.dispatchEvent(new Ctor(type, {
            key: init.key,
            code: init.code,
            shiftKey: shift,
            bubbles: true,
            cancelable: true,
            composed: true,
        }));
    }
}

/** The middle of the game, where a gesture that names no element aims. */
export function gameCentre(env: InputEnvironment): { node: Element; x: number; y: number } | null {
    const box = env.measure(env.root);
    if (!box) {
        return null;
    }
    const { x, y } = pointInBox(box);
    const hit = env.hitTest(x, y);
    return { node: hit && env.root.contains(hit) ? hit : env.root, x, y };
}
