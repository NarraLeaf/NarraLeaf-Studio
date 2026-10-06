import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import { isImeKeyEvent } from "@/lib/utils/imeComposition";
import { useHostWindow } from "./hostWindow";
import { useDismissWhenHidden } from "./hostVisibility";

/**
 * How a floating layer treats keyboard focus.
 *
 * Every layer Studio draws over the page - a dropdown, a picker, a menu, a dialog - answers the same
 * four questions, and each one used to answer them for itself, which is how most of them came to not
 * answer them at all: a picker opened and left focus on the trigger behind it, so the arrow keys went
 * on scrolling the inspector underneath; Escape closed the dialog the picker was opened from instead
 * of the picker; picking something unmounted the focused row and dropped focus to `<body>`, so the
 * next Tab started from the top of the window. This is the one definition:
 *
 * 1. **Opening moves focus in** - to the search field when there is one, else the current choice,
 *    else the first item, else the panel itself.
 * 2. **Escape closes the topmost layer and only it.** A dropdown inside a dialog closes; the dialog
 *    stays, and so does the inspector or editor the dropdown was portalled out of. A control inside
 *    the layer that answers Escape itself says so (`FLOATING_OWN_KEYS_ATTRIBUTE`); see
 *    `onCaptureKeyDown` for why that has to be explicit.
 * 3. **Closing gives focus back** to whatever had it when the layer opened - unless the layer closed
 *    because the author clicked somewhere else, which is where focus is going instead.
 * 4. **Focus leaving closes a popover; a dialog keeps it.** Tab out of a dropdown and it closes, with
 *    focus landing on the control after its trigger, as if the dropdown had been drawn in place
 *    rather than portalled to the end of the document. Tab inside a dialog cycles within it.
 */
export type FloatingFocusScope =
    /** A popover: focus leaving it closes it. */
    | "dismiss"
    /** A dialog: Tab cycles inside it, and nothing behind it can be reached. */
    | "trap"
    /** Escape only. For a layer whose focus is managed by something else, such as an input it is attached to. */
    | "none";

export interface FloatingLayerOptions {
    open: boolean;
    /** Called for Escape, for focus leaving a `dismiss` layer, and when its tab or panel is put away. */
    onClose: () => void;
    /** The layer's own box. Without it the layer still owns Escape, but cannot manage focus. */
    panelRef?: RefObject<HTMLElement | null>;
    /**
     * Elements that belong to the layer without being inside its box - the trigger, or the input an
     * autocomplete hangs off. Focus moving onto them does not close a `dismiss` layer, and focus
     * returns to them on close when it did not come from inside them.
     */
    ownerRefs?: ReadonlyArray<RefObject<HTMLElement | null>>;
    /** Default `"dismiss"`. */
    scope?: FloatingFocusScope;
    /**
     * Where focus goes when the layer opens. `true` (the default when there is a panel) picks as
     * described above; `false` leaves focus where it is, for a layer attached to a text input the
     * author is still typing in; a ref names the element outright.
     */
    initialFocus?: boolean | RefObject<HTMLElement | null>;
    /** Give focus back on close. Default `true`. */
    restoreFocus?: boolean;
    /** Default `true`. A layer that must not be escaped right now - a dialog mid-save - says `false`. */
    closeOnEscape?: boolean;
    /**
     * Selector for the layer's items. When set, ArrowUp/ArrowDown/Home/End move focus between them,
     * ArrowDown from the layer's search field enters the list and ArrowUp from its first item goes
     * back, and Enter activates an item that is not a button of its own.
     */
    itemSelector?: string;
    /** Close when the editor tab or panel holding the layer is put away. Default `true`. */
    dismissWhenHidden?: boolean;
}

interface Layer {
    doc: Document;
    scope: FloatingFocusScope;
    panel: () => HTMLElement | null;
    owners: () => HTMLElement[];
    closeOnEscape: () => boolean;
    itemSelector: () => string | undefined;
    close: () => void;
    /** The element focus goes back to on close; see `returnTarget` in the hook. */
    returnTarget: () => HTMLElement | null;
    /** Close without giving focus back, because focus is being sent somewhere on purpose. */
    closeWithoutRestore: () => void;
}

/** How many frames an opening layer keeps trying to take focus; see the retry in the hook. */
const FOCUS_RETRY_FRAMES = 20;

/** Every open layer in every window, oldest first. A window only ever consults its own. */
const layers: Layer[] = [];

const TABBABLE_SELECTOR = [
    "a[href]",
    "button:not([disabled])",
    "input:not([disabled]):not([type=\"hidden\"])",
    "select:not([disabled])",
    "textarea:not([disabled])",
    "[tabindex]",
    "[contenteditable=\"true\"]",
    "[contenteditable=\"\"]",
].join(", ");

const TEXT_FIELD_SELECTOR = [
    "input:not([type]):not([disabled])",
    "input[type=\"text\"]:not([disabled])",
    "input[type=\"search\"]:not([disabled])",
    "textarea:not([disabled])",
].join(", ");

function isShown(element: HTMLElement): boolean {
    // `checkVisibility` sees through hidden ancestors, which the element's own computed style does
    // not. jsdom has neither layout nor the method, and is answered "shown".
    const check = (element as HTMLElement & { checkVisibility?: () => boolean }).checkVisibility;
    return typeof check === "function" ? check.call(element) : true;
}

function tabbablesIn(container: ParentNode): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(TABBABLE_SELECTOR)).filter(element =>
        element.tabIndex >= 0 && !element.closest("[inert]") && isShown(element));
}

function focusables(container: ParentNode, selector: string): HTMLElement[] {
    return Array.from(container.querySelectorAll<HTMLElement>(selector)).filter(element =>
        !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true" && isShown(element));
}

/**
 * Tags a layer's items for the one focus style they share (`[data-floating-item]` in `styles.css`).
 *
 * Moving focus along a list is only half of keyboard navigation; the author also has to see where
 * it is. Most of these rows are buttons, and the stylesheet strips every button's focus outline -
 * with good reason elsewhere - so each menu would otherwise need a focus style of its own, and none
 * had one. Tagging them here gives every list walked through this module the same highlight.
 */
function markItems(items: HTMLElement[]): HTMLElement[] {
    for (const item of items) {
        if (!item.hasAttribute("data-floating-item")) item.setAttribute("data-floating-item", "");
    }
    return items;
}

function topLayerOf(doc: Document): Layer | undefined {
    for (let index = layers.length - 1; index >= 0; index -= 1) {
        if (layers[index].doc === doc) return layers[index];
    }
    return undefined;
}

/** True when `node` is inside `layer` or any layer opened after it - a menu opened from a popover is part of it. */
function isWithinLayerOrAbove(layer: Layer, node: Node | null): boolean {
    if (!node) return false;
    const start = layers.indexOf(layer);
    for (let index = Math.max(start, 0); index < layers.length; index += 1) {
        const candidate = layers[index];
        if (candidate.doc !== layer.doc) continue;
        if (candidate.panel()?.contains(node)) return true;
        if (candidate.owners().some(owner => owner.contains(node))) return true;
    }
    return false;
}

function focusElement(element: HTMLElement | null | undefined): boolean {
    if (!element || !element.isConnected) return false;
    element.focus({ preventScroll: true });
    return element.ownerDocument.activeElement === element;
}

/** Move focus to the tabbable after (or before) `from` in `container`, skipping everything in `skip`. */
function focusAdjacentTabbable(container: ParentNode, from: HTMLElement, backwards: boolean, skip: HTMLElement | null): boolean {
    const order = tabbablesIn(container).filter(element => element === from || !skip?.contains(element));
    const index = order.indexOf(from);
    if (index < 0) return false;
    const next = order[index + (backwards ? -1 : 1)];
    return focusElement(next);
}

function handleTab(event: KeyboardEvent, top: Layer): void {
    const doc = top.doc;
    const panel = top.panel();
    const active = doc.activeElement as HTMLElement | null;

    if (top.scope === "trap") {
        if (!panel) return;
        const order = tabbablesIn(panel);
        if (order.length === 0) {
            event.preventDefault();
            return;
        }
        const first = order[0];
        const last = order[order.length - 1];
        const inside = !!active && panel.contains(active);
        if (!inside) {
            event.preventDefault();
            focusElement(event.shiftKey ? last : first);
        } else if (event.shiftKey && active === first) {
            event.preventDefault();
            focusElement(last);
        } else if (!event.shiftKey && active === last) {
            event.preventDefault();
            focusElement(first);
        }
        return;
    }

    if (top.scope !== "dismiss" || !panel || !active || !panel.contains(active)) return;
    // Tab inside the popover walks its own controls; only leaving it needs a hand. The popover is
    // portalled to the end of the document, so the browser's next stop would be whatever follows
    // it there - usually nothing, and focus would fall out of the window. It goes where it would
    // have gone had the popover been drawn after its trigger: to the trigger's neighbour.
    const order = tabbablesIn(panel);
    // A list is one stop, walked with the arrows: Tab from any of its items leaves, rather than
    // stepping through forty options one by one on the way out.
    const selector = top.itemSelector();
    const onItem = !!selector && !active.matches(TEXT_FIELD_SELECTOR) && !!active.closest(selector);
    const leaving = onItem
        || order.length === 0
        || (event.shiftKey ? active === order[0] || active === panel : active === order[order.length - 1]);
    if (!leaving) return;
    const trigger = top.returnTarget();
    event.preventDefault();
    top.closeWithoutRestore();
    if (!trigger || !trigger.isConnected) return;
    // Within the dialog underneath, if there is one: Tab must not walk out of a trapped layer.
    const below = layers.slice(0, layers.indexOf(top)).reverse().find(layer => layer.doc === doc && layer.scope === "trap");
    const container = below?.panel() ?? doc.body;
    if (!focusAdjacentTabbable(container, trigger, event.shiftKey, panel)) {
        focusElement(trigger);
    }
}

function handleListKey(event: KeyboardEvent, top: Layer): void {
    const selector = top.itemSelector();
    const panel = top.panel();
    if (!selector || !panel) return;
    const target = event.target as HTMLElement | null;
    if (!target || !panel.contains(target)) return;

    const items = markItems(focusables(panel, selector));
    const index = items.findIndex(item => item === target || item.contains(target));
    const onItem = index >= 0 && (items[index] === target || !target.matches(TEXT_FIELD_SELECTOR));

    if (!onItem) {
        if (event.key === "ArrowDown" && target.matches(TEXT_FIELD_SELECTOR) && items.length > 0) {
            event.preventDefault();
            focusElement(items[0]);
            items[0].scrollIntoView?.({ block: "nearest" });
        }
        return;
    }

    let next: HTMLElement | undefined;
    switch (event.key) {
        case "ArrowDown":
            next = items[(index + 1) % items.length];
            break;
        case "ArrowUp": {
            if (index === 0) {
                const field = panel.querySelector<HTMLElement>(TEXT_FIELD_SELECTOR);
                next = field ?? items[items.length - 1];
            } else {
                next = items[index - 1];
            }
            break;
        }
        case "Home":
            next = items[0];
            break;
        case "End":
            next = items[items.length - 1];
            break;
        case "Enter": {
            const item = items[index];
            // A button or link activates itself on Enter; a row that is only a div with a click
            // handler does not, and is clicked here.
            if (item === target && !item.matches("button, a[href], input, select, textarea")) {
                event.preventDefault();
                item.click();
            }
            return;
        }
        default:
            return;
    }
    event.preventDefault();
    focusElement(next);
    next?.scrollIntoView?.({ block: "nearest" });
}

/**
 * Marks a control inside a layer that answers its own keys - Escape cancelling an inline rename,
 * the arrows stepping a value. Keys pressed in it reach it first, and the layer only acts on what it
 * leaves alone.
 */
export const FLOATING_OWN_KEYS_ATTRIBUTE = "data-floating-own-keys";

function isListKey(event: KeyboardEvent): boolean {
    if (event.altKey || event.ctrlKey || event.metaKey) return false;
    return event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Home"
        || event.key === "End" || event.key === "Enter";
}

/** The topmost layer whose box holds `node`, if any. */
function layerHolding(doc: Document, node: Node | null): Layer | undefined {
    if (!node) return undefined;
    for (let index = layers.length - 1; index >= 0; index -= 1) {
        const layer = layers[index];
        if (layer.doc === doc && layer.panel()?.contains(node)) return layer;
    }
    return undefined;
}

function ownsKeys(target: EventTarget | null): boolean {
    return target instanceof Element && !!target.closest(`[${FLOATING_OWN_KEYS_ATTRIBUTE}]`);
}

/**
 * Keys pressed inside a layer, heard on the document's capture phase - before anything else in the
 * page, React included.
 *
 * It has to be this early because of portals. A popover is portalled out of the panel it was opened
 * from, but React still bubbles its events up through the component tree it was rendered in, so an
 * Escape pressed in a dropdown inside the story action inspector reached the inspector's own Escape
 * handler - which closed the inspector - and an arrow pressed in it reached the scene editor's row
 * navigation. Nothing listening after React can undo that. What is pressed inside a layer is the
 * layer's to answer, unless the control it was pressed in says otherwise (`data-floating-own-keys`).
 */
function onCaptureKeyDown(event: KeyboardEvent): void {
    const doc = (event.currentTarget as Document);
    const top = topLayerOf(doc);
    if (!top || event.defaultPrevented || isImeKeyEvent(event)) return;
    const target = event.target as Node | null;
    const holder = layerHolding(doc, target);
    if (ownsKeys(event.target)) return;
    if (!holder) {
        // Focus on the top layer's own trigger - left there by a click, or by a layer that leaves
        // focus where it is - is still the layer's: Escape closes it there too, before the panel the
        // trigger sits in (an inspector, a dialog) takes the key for itself.
        if (event.key === "Escape" && !!target && top.owners().some(owner => owner.contains(target))) {
            event.preventDefault();
            event.stopPropagation();
            if (top.closeOnEscape()) top.close();
        }
        return;
    }

    if (event.key === "Escape") {
        // The topmost layer even when the key was pressed in one below it: an autocomplete hanging
        // off a field in a dialog closes ahead of the dialog.
        event.preventDefault();
        event.stopPropagation();
        if (top.closeOnEscape()) top.close();
        return;
    }
    if (holder !== top) return;
    if (event.key === "Tab") {
        handleTab(event, top);
    } else if (isListKey(event)) {
        handleListKey(event, top);
    }
    if (event.defaultPrevented) event.stopPropagation();
}

/**
 * Keys pressed outside every layer while one is open - focus left on a trigger, in the field an
 * autocomplete hangs off, or on nothing at all - heard on the body's bubble phase.
 *
 * After React, so the field the key was pressed in answers first; and before the document, where
 * older whole-page Escape handlers listen, so the page underneath an open layer never hears it.
 * React's own listeners sit on the root and on each portal container - the body itself for the many
 * popovers portalled there - so this is re-added at the end of the body's list whenever a layer
 * opens, which keeps it behind a body portal mounted since.
 */
function onBubbleKeyDown(event: KeyboardEvent): void {
    const doc = (event.currentTarget as Node).ownerDocument ?? document;
    const top = topLayerOf(doc);
    // `cancelBubble` because React shares this node: its listener for a body portal is on the body
    // too, and a handler there that stopped the key cannot stop a listener on the same node.
    if (!top || event.defaultPrevented || event.cancelBubble || isImeKeyEvent(event)) return;
    if (layerHolding(doc, event.target as Node | null) && !ownsKeys(event.target)) return;

    if (event.key === "Escape") {
        if (!top.closeOnEscape()) return;
        event.preventDefault();
        event.stopPropagation();
        top.close();
        return;
    }
    if (event.key === "Tab") {
        handleTab(event, top);
    }
}

function retain(doc: Document): void {
    doc.removeEventListener("keydown", onCaptureKeyDown, true);
    doc.addEventListener("keydown", onCaptureKeyDown, true);
    const body = doc.body;
    if (!body) return;
    body.removeEventListener("keydown", onBubbleKeyDown);
    body.addEventListener("keydown", onBubbleKeyDown);
}

function release(doc: Document): void {
    if (layers.some(layer => layer.doc === doc)) return;
    doc.removeEventListener("keydown", onCaptureKeyDown, true);
    doc.body?.removeEventListener("keydown", onBubbleKeyDown);
}

/** Pick the element a newly opened layer should focus; see `FloatingLayerOptions.initialFocus`. */
function initialTarget(panel: HTMLElement, scope: FloatingFocusScope, itemSelector: string | undefined): HTMLElement {
    const items = itemSelector ? markItems(focusables(panel, itemSelector)) : [];
    const explicit = panel.querySelector<HTMLElement>("[data-autofocus]");
    if (explicit) return explicit;
    const field = focusables(panel, TEXT_FIELD_SELECTOR)[0];
    if (field) return field;
    if (scope === "dismiss") {
        const current = items.find(item => item.matches(
            "[aria-selected=\"true\"], [aria-current=\"true\"], [aria-checked=\"true\"], [data-selected=\"true\"]"));
        if (current) return current;
        if (items[0]) return items[0];
        const first = tabbablesIn(panel)[0];
        if (first) return first;
    }
    // A dialog does not start on its first button: that is often the one that deletes something,
    // and Enter would press it. The panel itself takes focus, and Tab goes from there.
    return panel;
}

/**
 * Make a floating panel behave like one; see {@link FloatingFocusScope} for the contract.
 *
 * Call it in the component that owns the open state, with the panel's ref. It needs nothing else
 * from the panel - no wrapper, no props to spread - so a hand-built popover takes it on in one line.
 */
export function useFloatingLayer(options: FloatingLayerOptions): void {
    const {
        open,
        panelRef,
        scope = "dismiss",
        restoreFocus = true,
        dismissWhenHidden = true,
    } = options;
    // Through the window rather than `useHostDocument`: under a server render (some component tests
    // run in a node environment) there is no window, and the hook must render without one. Effects
    // never run there, so nothing below needs the document.
    const doc = useHostWindow()?.document as Document | undefined;
    const latest = useRef(options);
    latest.current = options;

    useDismissWhenHidden(() => latest.current.onClose(), open && dismissWhenHidden);

    useLayoutEffect(() => {
        if (!open || !doc) return;

        const owners = () => (latest.current.ownerRefs ?? [])
            .map(ref => ref.current)
            .filter((element): element is HTMLElement => !!element);
        // Where focus goes back to: whatever had focus the moment the layer opened - for a layer opened
        // by a button, that button - unless it lies outside the owners, in which case the owners'
        // first focusable control (an owner is often a wrapper around the trigger, not the trigger).
        const opener = doc.activeElement instanceof HTMLElement && doc.activeElement !== doc.body
            ? doc.activeElement
            : null;
        const returnTarget = (): HTMLElement | null => {
            const list = owners();
            if (opener?.isConnected && (list.length === 0 || list.some(owner => owner.contains(opener)))) {
                return opener;
            }
            for (const owner of list) {
                if (owner.matches(TABBABLE_SELECTOR) && owner.tabIndex >= 0) return owner;
                const inner = tabbablesIn(owner)[0];
                if (inner) return inner;
            }
            return opener;
        };
        let restore = restoreFocus;
        let panelAtOpen: HTMLElement | null = null;

        const layer: Layer = {
            doc,
            scope,
            panel: () => latest.current.panelRef?.current ?? null,
            owners,
            closeOnEscape: () => latest.current.closeOnEscape !== false,
            itemSelector: () => latest.current.itemSelector,
            close: () => latest.current.onClose(),
            returnTarget,
            closeWithoutRestore: () => {
                restore = false;
                latest.current.onClose();
            },
        };
        layers.push(layer);
        retain(doc);

        // Clicking elsewhere closes most layers through their own outside-click handling, and focus
        // is then going where the author clicked; giving it back to the trigger would steal it.
        const onPointerDown = (event: PointerEvent | MouseEvent) => {
            if (!isWithinLayerOrAbove(layer, event.target as Node | null)) {
                restore = false;
            }
        };
        doc.addEventListener("pointerdown", onPointerDown, true);
        doc.addEventListener("mousedown", onPointerDown, true);

        // Focus arriving anywhere outside a popover closes it: Tab is handled above, but a click on
        // a focusable control elsewhere, or a shortcut that focuses a panel, ends up here.
        const onFocusIn = (event: FocusEvent) => {
            if (layer.scope !== "dismiss") return;
            const panel = layer.panel();
            if (!panel) return;
            if (isWithinLayerOrAbove(layer, event.target as Node | null)) return;
            restore = false;
            latest.current.onClose();
        };
        doc.addEventListener("focusin", onFocusIn);

        let raf = 0;
        const wantsFocus = latest.current.initialFocus ?? !!panelRef;
        const moveFocusIn = () => {
            const panel = layer.panel();
            if (!panel) return false;
            panelAtOpen = panel;
            const active = doc.activeElement;
            if (active && active !== doc.body && panel.contains(active)) return true;
            let target: HTMLElement | null;
            if (typeof wantsFocus === "object") {
                target = wantsFocus.current;
            } else {
                target = initialTarget(panel, layer.scope, latest.current.itemSelector);
            }
            if (target === panel && !panel.hasAttribute("tabindex")) {
                panel.tabIndex = -1;
                panel.style.outline = "none";
            }
            return focusElement(target);
        };
        if (wantsFocus && !moveFocusIn()) {
            // A panel placed in a second pass is `visibility: hidden` for the first one, and a hidden
            // element refuses focus. Nor is the panel turning visible the end of it: a control inside
            // that transitions its properties inherits the change through that transition, and can
            // stay hidden - and unfocusable - for some frames after its panel shows. Measured on the
            // story inspector's channel picker the first time it opened after a load. So keep trying
            // for a short while, and give up as soon as the author has put focus somewhere else.
            const view = doc.defaultView ?? window;
            const focusedAtOpen = doc.activeElement;
            let attempts = 0;
            const retry = () => {
                const active = doc.activeElement;
                const panel = layer.panel();
                const moved = active !== focusedAtOpen && active !== doc.body && !(panel && active && panel.contains(active));
                if (moved || moveFocusIn() || ++attempts >= FOCUS_RETRY_FRAMES) return;
                raf = view.requestAnimationFrame(retry);
            };
            raf = view.requestAnimationFrame(retry);
        } else if (!wantsFocus) {
            panelAtOpen = layer.panel();
        }

        return () => {
            (doc.defaultView ?? window).cancelAnimationFrame(raf);
            doc.removeEventListener("pointerdown", onPointerDown, true);
            doc.removeEventListener("mousedown", onPointerDown, true);
            doc.removeEventListener("focusin", onFocusIn);
            const index = layers.indexOf(layer);
            if (index >= 0) layers.splice(index, 1);
            release(doc);

            if (!restore) return;
            const active = doc.activeElement;
            const panel = panelAtOpen ?? layer.panel();
            // Only when focus is lost - still inside the closing panel, or already dropped to the
            // body because the panel has been removed. Focus the author put somewhere else stays.
            const lost = !active || active === doc.body || !active.isConnected || (!!panel && panel.contains(active));
            if (lost) {
                focusElement(returnTarget());
            }
        };
        // `scope` is read once per opening on purpose: a layer does not change kind while it is open.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [open, doc]);
}

/**
 * How many layers are open in `doc`. Also how a page-wide shortcut on keys a layer would use - the
 * UI editor's arrow-key nudge - stands aside while one is open.
 */
export function openFloatingLayerCount(doc: Document): number {
    return layers.filter(layer => layer.doc === doc).length;
}
