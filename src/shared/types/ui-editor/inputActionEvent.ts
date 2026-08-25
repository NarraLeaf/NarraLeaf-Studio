/**
 * What reaches a surface's blueprint when one of its declared actions fires.
 *
 * The vocabulary and the per-surface answer live in `inputAction.ts`; this is the other end of the
 * same wire - the shape the runtime hands the surfaceMain blueprint once it has decided that this
 * click, wheel or key means "advance" on this surface.
 *
 * It rides the ordinary surface-event path (`dispatchSurfaceBlueprintEvent`) under the event name
 * below rather than a channel of its own, so an action head is dispatched, traced and cancelled by
 * exactly the code every other surface event already is.
 *
 * Deliberately its own file with no imports. The head node has to match on `actionId`, and the
 * matcher lives in `@shared/types/blueprint/graph` - which `inputAction.ts` already imports from, so
 * a constant placed there and read back would close a module cycle. Nothing imports anything here,
 * so both ends can read it.
 *
 * Comments in English per project convention.
 */

/** The surface event name an action is raised under. */
export const UI_SURFACE_INPUT_ACTION_EVENT = "inputAction";

/**
 * The payload key an action head filters on.
 *
 * Named here rather than spelled twice: the dispatcher writes it and the head node's matcher reads
 * it, and a head that filtered on a key the dispatcher never wrote would simply never fire.
 */
export const UI_SURFACE_INPUT_ACTION_PAYLOAD_KEY = "actionId";

/**
 * What kind of input raised the action.
 *
 * Coarser than the binding that matched it - an author asking "was this the mouse or the keyboard"
 * is asking about the device, not about which of four wheel directions it was. `gamepad` and `touch`
 * are declared here and not yet produced by any binding: the union is what a graph pin enumerates,
 * and widening it later would silently invalidate every saved graph that switched on it.
 */
export type UIInputActionSource = "pointer" | "key" | "gamepad" | "touch";

export const UI_INPUT_ACTION_SOURCES = ["pointer", "key", "gamepad", "touch"] as const;

/**
 * The event payload of one fired action.
 *
 * `x` / `y` are in the surface's own design coordinates, and are absent for anything but a pointer -
 * a key press happens nowhere in particular, and reporting the last known pointer position for it
 * would be a plausible-looking lie.
 */
export type UIInputActionEventPayload = {
    actionId: string;
    source: UIInputActionSource;
    x?: number;
    y?: number;
};

export function isUIInputActionSource(value: unknown): value is UIInputActionSource {
    return typeof value === "string" && (UI_INPUT_ACTION_SOURCES as readonly string[]).includes(value);
}
