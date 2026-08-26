/**
 * The input a project names, and how one interface answers it.
 *
 * A player's click on the dialogue box means "advance". Before this that sentence had no home: it
 * was a mouse-click head on whichever element happened to cover the box, repeated on every surface
 * that wanted the same gesture, and silently different on the one where somebody had put a
 * decorative image on top. The three records below split it into the two halves it always was:
 *
 *  - **The project says what the gestures mean.** {@link UIInputActionDef} is one entry of a
 *    vocabulary the whole project shares - an id, a name an author reads, and the bindings a
 *    surface gets unless it says otherwise.
 *  - **A surface says which of them it answers.** {@link UISurfaceActionEnablement} is that
 *    surface's reply for one action: extra bindings, or a set that replaces the project's, plus
 *    whether firing it ends the walk and what it does over a control the player can operate.
 *  - **A surface says whether input reaches it at all.** {@link UISurfaceInputMode}.
 *
 * Kept pure and in `shared` for the reason `structLibrary.ts` is: the editor writes through it, the
 * build reads it, and a test can drive it with no workspace behind it.
 *
 * Comments in English per project convention.
 */

import { formatBlueprintKeyboardBinding } from "../blueprint/graph";
import type { UIDocument } from "./document";
import type { UIInputActionSource } from "./inputActionEvent";
import { getWidgetLogicApi } from "./widgetLogic";

/**
 * The pointer gestures an action may be bound to.
 *
 * A tuple rather than a bare union so the list has one spelling: the type below is derived from it,
 * which is what stops a gesture being addable to the type and then missing from every picker that
 * enumerates them. Deliberately coarse - these are gestures a *panel* can mean something by, not
 * the full pointer event set an element still gets through its own heads. Hover and movement are
 * absent because a panel-wide "the pointer passed over here" is not an action anybody declares.
 *
 * **A gesture's name says what happened, not which piece of hardware did it.** `click` is a mouse
 * button and a finger tapping; the four `wheel` directions are a wheel, a trackpad's two fingers
 * and a finger dragging a touch screen, which are one gesture with one set of directions rather
 * than three. Which devices reach a gesture is a separate question, answered by
 * {@link inputBindingDevices} - and it is a question about the binding, not a second axis an author
 * has to choose along.
 *
 * `longPress` stays in this family rather than opening a `kind` of its own for two reasons. The web
 * platform's own "pointer" already means the family of devices that aim at a point - mouse, pen,
 * finger - so a press held on one of them is a pointer gesture whatever produced it. And
 * `resolveSurfaceInputActionHits` decides whether a binding stands down over an operable control by
 * asking `signal.kind === "pointer"`: a long press landing on a button must give way exactly as a
 * click does, and a separate kind would silently walk past that test.
 *
 * Appended to, never reordered - the binding picker enumerates the tuple in order.
 */
export const UI_INPUT_POINTER_GESTURES = [
    "click",
    "doubleClick",
    "rightClick",
    "wheelUp",
    "wheelDown",
    "wheelLeft",
    "wheelRight",
    "longPress",
] as const;

export type UIInputPointerGesture = (typeof UI_INPUT_POINTER_GESTURES)[number];

export function isUIInputPointerGesture(value: unknown): value is UIInputPointerGesture {
    return typeof value === "string" && (UI_INPUT_POINTER_GESTURES as readonly string[]).includes(value);
}

/**
 * One way an action can be triggered.
 *
 * A `key` is spelled exactly as the `On Key Down` / `On Key Up` heads spell theirs - "Escape",
 * "Space", "Ctrl+S" - because it is the same vocabulary, parsed and matched by the same code in
 * `@shared/types/blueprint/graph`. {@link normalizeUIInputBinding} runs a stored key through
 * `formatBlueprintKeyboardBinding`, so an author who typed "esc" and a head that says "Escape" are
 * the one binding rather than two that look alike.
 */
export type UIInputBinding =
    | { kind: "pointer"; gesture: UIInputPointerGesture }
    | { kind: "key"; key: string };

/** One entry of the project's action vocabulary. */
export type UIInputActionDef = {
    id: string;
    /** Author-facing name. */
    name: string;
    /** The bindings a surface gets unless it overrides them. */
    bindings: UIInputBinding[];
};

/** How a surface answers one action from the project vocabulary. */
export type UISurfaceActionEnablement = {
    actionId: string;
    /** Extra bindings on top of the project defaults. */
    addBindings?: UIInputBinding[];
    /** Replaces the project defaults entirely when present. */
    overrideBindings?: UIInputBinding[];
    /** Whether firing this action stops the lane walk. Default true. */
    consume?: boolean;
    /** Whether a pointer binding stands down over an operable control. Default "skip". */
    overControls?: "skip" | "fire";
};

/** What a surface does with input that lands on it at all. */
export type UISurfaceInputMode = "capture" | "pass" | "none";

export const UI_SURFACE_INPUT_MODES = ["capture", "pass", "none"] as const;

/**
 * What a surface with nothing written down does.
 *
 * `capture`, because that is what every surface authored before this record existed already did -
 * the pointer stopped at the topmost one. A document that predates the field therefore loads
 * behaving exactly as it did.
 */
export const UI_SURFACE_DEFAULT_INPUT_MODE: UISurfaceInputMode = "capture";

/** An action fired without saying otherwise ends the walk. */
export const UI_SURFACE_ACTION_DEFAULT_CONSUME = true;

/** A pointer binding stands down over a control the player can operate, unless told to fire anyway. */
export const UI_SURFACE_ACTION_DEFAULT_OVER_CONTROLS: NonNullable<UISurfaceActionEnablement["overControls"]> = "skip";

export function isUISurfaceInputMode(value: unknown): value is UISurfaceInputMode {
    return typeof value === "string" && (UI_SURFACE_INPUT_MODES as readonly string[]).includes(value);
}

/** The key a binding is the same as another one by. */
function bindingIdentity(binding: UIInputBinding): string {
    return binding.kind === "pointer" ? `pointer:${binding.gesture}` : `key:${binding.key}`;
}

/**
 * A stored binding, or null when this build cannot make sense of it.
 *
 * A key is canonicalised rather than trusted: the spelling is what the match runs against, and a
 * binding stored as "esc" would sit beside one stored as "Escape" in every list that de-duplicates.
 */
export function normalizeUIInputBinding(value: unknown): UIInputBinding | null {
    if (!value || typeof value !== "object") {
        return null;
    }
    const raw = value as Partial<UIInputBinding> & Record<string, unknown>;
    if (raw.kind === "pointer") {
        return isUIInputPointerGesture(raw.gesture) ? { kind: "pointer", gesture: raw.gesture } : null;
    }
    if (raw.kind === "key") {
        const key = formatBlueprintKeyboardBinding(raw.key);
        return key ? { kind: "key", key } : null;
    }
    return null;
}

/** A stored binding list, unreadable entries dropped and duplicates collapsed. */
export function normalizeUIInputBindings(value: unknown): UIInputBinding[] {
    const seen = new Set<string>();
    const out: UIInputBinding[] = [];
    for (const entry of Array.isArray(value) ? value : []) {
        const binding = normalizeUIInputBinding(entry);
        if (!binding || seen.has(bindingIdentity(binding))) {
            continue;
        }
        seen.add(bindingIdentity(binding));
        out.push(binding);
    }
    return out;
}

/** The same list with every binding named once, first occurrence winning. */
export function dedupeUIInputBindings(bindings: readonly UIInputBinding[]): UIInputBinding[] {
    const seen = new Set<string>();
    const out: UIInputBinding[] = [];
    for (const binding of bindings) {
        const identity = bindingIdentity(binding);
        if (seen.has(identity)) {
            continue;
        }
        seen.add(identity);
        out.push(binding);
    }
    return out;
}

/**
 * The bindings one surface answers one action with.
 *
 * `overrideBindings` wins **by being present**, not by being non-empty: a surface that lists an
 * action and overrides it with nothing is saying "here, this action has no gesture", which is a
 * different statement from "here, use the project's" and has to survive a round trip as one.
 */
export function resolveSurfaceActionBindings(
    def: Pick<UIInputActionDef, "bindings"> | null | undefined,
    enablement?: UISurfaceActionEnablement | null,
): UIInputBinding[] {
    if (enablement?.overrideBindings) {
        return dedupeUIInputBindings(enablement.overrideBindings);
    }
    return dedupeUIInputBindings([...(def?.bindings ?? []), ...(enablement?.addBindings ?? [])]);
}

/**
 * Which devices can produce each pointer gesture.
 *
 * A full `Record` rather than a `Partial<Record>` on purpose: a gesture added to the tuple without
 * an entry here has to be a compile error. The alternative fails quietly - the new gesture reads as
 * belonging to no device at all, so every author-facing device marking simply omits it and nobody
 * finds out until a player on the missing device cannot trigger the action.
 *
 * Two of the rulings are worth stating outright, because both look like oversights:
 *
 *  - **`doubleClick` is pointer only.** The shell and the web export both set `touch-action` so that
 *    a double tap does not become a zoom or a synthetic double click, deliberately - so there is no
 *    touch gesture left to map onto it.
 *  - **`rightClick` is pointer only.** Android raises `contextmenu` from a held finger, which would
 *    make right click reachable by touch by accident; that stream belongs to `longPress` instead,
 *    where an author who wanted a held finger asked for one.
 */
const POINTER_GESTURE_DEVICES: Record<UIInputPointerGesture, readonly UIInputActionSource[]> = {
    click: ["pointer", "touch"],
    doubleClick: ["pointer"],
    rightClick: ["pointer"],
    wheelUp: ["pointer", "touch"],
    wheelDown: ["pointer", "touch"],
    wheelLeft: ["pointer", "touch"],
    wheelRight: ["pointer", "touch"],
    longPress: ["touch"],
};

/**
 * The devices one binding can be triggered from.
 *
 * **A set, not a single device**, and that is the load-bearing part of the whole model. A `click`
 * is a mouse button *and* the click a finger's tap synthesises; the four wheel directions are a
 * wheel, a trackpad and a finger dragging a touch screen. Bindings that belong to two devices at
 * once are why a "control scheme" cannot be an axis beside the binding: an axis needs every binding
 * to sit in exactly one scheme, and these sit in two. So the device is read off the binding itself,
 * and neither {@link UIInputActionDef} nor {@link UISurfaceActionEnablement} stores anything about
 * it.
 */
export function inputBindingDevices(binding: UIInputBinding): ReadonlySet<UIInputActionSource> {
    return new Set(binding.kind === "pointer" ? POINTER_GESTURE_DEVICES[binding.gesture] : ["key"]);
}

/** Whether a player on this device can trigger this binding. */
export function inputBindingReachesDevice(binding: UIInputBinding, device: UIInputActionSource): boolean {
    return inputBindingDevices(binding).has(device);
}

/**
 * Whether the player operates elements of this type directly.
 *
 * This is the question `overControls: "skip"` asks. A panel-wide "click advances" must not fire
 * when the click landed on the Back button inside the panel, and the only way to know is whether
 * the thing under the pointer is a control or scenery.
 *
 * **Declared on the widget logic table, not derived from it**, and that is a deliberate retreat
 * from the obvious derivation. "Has an interaction event of its own beyond the shared displayable
 * set" reads like the right predicate and is wrong twice: `nl.button` declares exactly the
 * displayable set and nothing else, so it would come out scenery, and `nl.frame` declares
 * `pageEvent`, so a page host would come out a control. Nothing else in that entry separates a
 * Button from a Container either - same events, same commands shape, same readable state - because
 * a Button's controlness lives in how it is drawn and what the runtime does with a click on it,
 * neither of which the logic API describes. So `WidgetLogicApi.operable` says it outright, next to
 * the rest of what a widget type can do, and `inputAction.test.ts` pins every built-in answer.
 */
export function isOperableWidgetType(elementType: string | null | undefined): boolean {
    return getWidgetLogicApi(elementType)?.operable === true;
}

/** A stored vocabulary entry, or null when this build cannot make sense of it. */
export function normalizeUIInputActionDef(value: unknown): UIInputActionDef | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const raw = value as Partial<UIInputActionDef>;
    const id = typeof raw.id === "string" ? raw.id.trim() : "";
    if (!id) {
        return null;
    }
    const name = typeof raw.name === "string" ? raw.name.trim() : "";
    return {
        id,
        name,
        bindings: normalizeUIInputBindings(raw.bindings),
    };
}

/**
 * Read a stored vocabulary, dropping entries this build cannot make sense of.
 *
 * Keyed by the table's key rather than by the entry's own id, exactly as the struct library is: the
 * key is what a surface's enablement stores, and an entry whose id had drifted from its key would
 * be unreachable while still looking present in the panel.
 */
export function normalizeUIInputActionLibrary(value: unknown): Record<string, UIInputActionDef> {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return {};
    }
    const out: Record<string, UIInputActionDef> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
        const action = normalizeUIInputActionDef(entry);
        if (!action) {
            continue;
        }
        out[key] = action.id === key ? action : { ...action, id: key };
    }
    return out;
}

/** A stored surface mode, falling back to what a surface without one has always done. */
export function normalizeUISurfaceInputMode(value: unknown): UISurfaceInputMode {
    return isUISurfaceInputMode(value) ? value : UI_SURFACE_DEFAULT_INPUT_MODE;
}

/** A stored enablement, or null when it names no action. */
export function normalizeUISurfaceActionEnablement(value: unknown): UISurfaceActionEnablement | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
        return null;
    }
    const raw = value as Partial<UISurfaceActionEnablement>;
    const actionId = typeof raw.actionId === "string" ? raw.actionId.trim() : "";
    if (!actionId) {
        return null;
    }
    const out: UISurfaceActionEnablement = { actionId };
    if (raw.addBindings !== undefined) {
        out.addBindings = normalizeUIInputBindings(raw.addBindings);
    }
    // Presence is the statement (see `resolveSurfaceActionBindings`), so an override that
    // normalizes to nothing stays an override rather than collapsing into "use the defaults".
    if (raw.overrideBindings !== undefined) {
        out.overrideBindings = normalizeUIInputBindings(raw.overrideBindings);
    }
    if (typeof raw.consume === "boolean") {
        out.consume = raw.consume;
    }
    if (raw.overControls === "skip" || raw.overControls === "fire") {
        out.overControls = raw.overControls;
    }
    return out;
}

/** A stored enablement list, unreadable entries dropped and one entry kept per action. */
export function normalizeUISurfaceActionEnablements(value: unknown): UISurfaceActionEnablement[] {
    const seen = new Set<string>();
    const out: UISurfaceActionEnablement[] = [];
    for (const entry of Array.isArray(value) ? value : []) {
        const enablement = normalizeUISurfaceActionEnablement(entry);
        if (!enablement || seen.has(enablement.actionId)) {
            continue;
        }
        seen.add(enablement.actionId);
        out.push(enablement);
    }
    return out;
}

/** Whether this surface answers the action at all. */
export function findUISurfaceActionEnablement(
    enablements: readonly UISurfaceActionEnablement[] | undefined,
    actionId: string,
): UISurfaceActionEnablement | undefined {
    return enablements?.find(entry => entry.actionId === actionId);
}

/** Whether firing this enablement ends the walk. */
export function readUISurfaceActionConsume(enablement: UISurfaceActionEnablement | null | undefined): boolean {
    return enablement?.consume ?? UI_SURFACE_ACTION_DEFAULT_CONSUME;
}

/** What a pointer binding of this enablement does over a control the player can operate. */
export function readUISurfaceActionOverControls(
    enablement: UISurfaceActionEnablement | null | undefined,
): NonNullable<UISurfaceActionEnablement["overControls"]> {
    return enablement?.overControls ?? UI_SURFACE_ACTION_DEFAULT_OVER_CONTROLS;
}

/**
 * Every action id a surface in this document still names.
 *
 * Walks surfaces rather than the vocabulary, because that is the direction the reference runs: a
 * vocabulary entry nothing answers is still an entry the author typed, and only an enablement can
 * be orphaned.
 */
export function collectReferencedUIInputActionIds(
    document: Pick<UIDocument, "surfaces">,
): Set<string> {
    const out = new Set<string>();
    for (const surface of document.surfaces ?? []) {
        for (const enablement of surface.actions ?? []) {
            out.add(enablement.actionId);
        }
    }
    return out;
}

/**
 * The enablement list with every entry naming an action outside `actionIds` removed.
 *
 * The caller decides when to run it. Deleting a vocabulary entry does, in the same transaction, so
 * that undo restores both halves - a surface left answering an action nothing defines would show a
 * row with no name and no bindings, which is the state this drops.
 */
export function pruneUISurfaceActionEnablements(
    enablements: readonly UISurfaceActionEnablement[] | undefined,
    actionIds: ReadonlySet<string>,
): UISurfaceActionEnablement[] {
    return (enablements ?? []).filter(entry => actionIds.has(entry.actionId));
}
