/**
 * Which drawing of which element a running graph is talking about.
 *
 * An element id names a place in the document. It does not name a thing on screen, because one
 * element can be drawn many times: every row of a list is the same template, and every placement of
 * a component is the same definition. Anything a graph *writes* therefore needs both - the element
 * and the drawing - or the writes of one drawing land on all of them.
 *
 * That is not hypothetical. It is what a component with parameters did before this existed: six save
 * slots, one definition, six graphs each setting its own slot number, and all six cards showing the
 * sixth. The read side already knew (`useWidgetRuntimeElementKey` has appended the instance since
 * lists gained rows); it was only the write side that addressed the template.
 *
 * The pairing travels as one string so it can pass through the whole element-addressing path -
 * every node's `elementId` argument, and the host API's - without thirty-odd signatures learning a
 * second parameter. Build and parse live together for the reason they do in
 * `componentInstanceKey.ts`: a format spelled in two places stops matching the first time either is
 * touched.
 *
 * An address with no drawing is just the element id, byte for byte. That is what everything outside
 * a list row or a component instance produces, so those paths keep the keys they always had.
 *
 * Comments in English per project convention.
 */

const SEPARATOR = "\0";

/** The address of `elementId` as drawn by `instanceKey`, or of the element itself when there is none. */
export function buildUIWidgetAddress(elementId: string, instanceKey?: string | null): string {
    return instanceKey ? `${elementId}${SEPARATOR}${instanceKey}` : elementId;
}

/**
 * The element and the drawing an address names.
 *
 * Anything that has to reach the *document* - reading the authored props, measuring the node in the
 * DOM, checking the element still exists - wants `elementId` and must not be handed the address:
 * the document knows nothing about drawings.
 */
export function readUIWidgetAddress(address: string): { elementId: string; instanceKey?: string } {
    const at = address.indexOf(SEPARATOR);
    if (at < 0) {
        return { elementId: address };
    }
    const instanceKey = address.slice(at + SEPARATOR.length);
    return { elementId: address.slice(0, at), instanceKey: instanceKey.length > 0 ? instanceKey : undefined };
}

/** Just the element, for the many callers that only ever want that. */
export function readUIWidgetAddressElementId(address: string): string {
    return readUIWidgetAddress(address).elementId;
}
