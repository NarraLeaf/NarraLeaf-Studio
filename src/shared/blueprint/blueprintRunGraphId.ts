/**
 * The id a blueprint graph runs under.
 *
 * `adaptBlueprintGraphIr` needs a `UIGraphId` for the graph it hands the executor, and every call
 * site builds one out of the same three facts: what is being run, which blueprint owns it, and
 * which of that blueprint's graphs it is. The strings used to be written by hand at each of the
 * nine call sites, which was fine while nothing read them back. The debugger reads them back - a
 * paused frame only knows its run graph id, and has to recover the blueprint and graph to look up
 * breakpoints and to draw the graph - so the format is a contract now and lives in one place.
 *
 * Blueprint ids and graph ids are opaque, so the parse splits on the FIRST separator only for the
 * kind and treats the rest as `blueprintId + separator + graphId` split at the next one; ids that
 * contain the separator themselves would break this, which is why `buildBlueprintRunGraphId`
 * is the only supported way to make one.
 */

export type BlueprintRunGraphKind =
    /** A blueprint event graph dispatched on its owner (surface main, global main, widget…). */
    | "blueprintEvent"
    | "widgetEvent"
    | "surfaceEvent"
    | "globalEvent"
    | "broadcastEvent"
    | "elementFlush"
    | "elementClick"
    /** A blueprint fn invoked from another graph. */
    | "fnCall"
    /** A value graph backing a widget property binding. */
    | "blueprintValue"
    /** A story action blueprint's "On Call" graph. */
    | "storyAction"
    /** A story action blueprint's "On Call" graph evaluated synchronously (inline value / condition). */
    | "storyActionValue"
    /** A fn invoked from a story action graph. */
    | "storyActionFn"
    /** Editor-side validation run; never executes host effects. */
    | "validate";

const SEPARATOR = ":";

export type BlueprintRunGraphRef = {
    kind: BlueprintRunGraphKind;
    blueprintId: string;
    /** The graph's own id inside the blueprint - an event graph id or a function graph id. */
    graphId: string;
};

export function buildBlueprintRunGraphId(kind: BlueprintRunGraphKind, blueprintId: string, graphId: string): string {
    return `${kind}${SEPARATOR}${blueprintId}${SEPARATOR}${graphId}`;
}

/**
 * Recover the three parts of a run graph id. Returns null for anything this module did not build,
 * which callers must treat as "not attributable to an authored graph" rather than guessing.
 */
export function parseBlueprintRunGraphId(runGraphId: string | undefined): BlueprintRunGraphRef | null {
    if (!runGraphId) {
        return null;
    }
    const firstSeparator = runGraphId.indexOf(SEPARATOR);
    if (firstSeparator <= 0) {
        return null;
    }
    const secondSeparator = runGraphId.indexOf(SEPARATOR, firstSeparator + 1);
    if (secondSeparator <= firstSeparator + 1 || secondSeparator === runGraphId.length - 1) {
        return null;
    }
    return {
        kind: runGraphId.slice(0, firstSeparator) as BlueprintRunGraphKind,
        blueprintId: runGraphId.slice(firstSeparator + 1, secondSeparator),
        graphId: runGraphId.slice(secondSeparator + 1),
    };
}

/**
 * Whether a graph of this kind can stop at a breakpoint.
 *
 * `storyActionValue` runs through `executeGraphSync` - an inline interpolation or a control-flow
 * condition has to produce its value in the same tick the story asks for it, so there is no await
 * to suspend on. Breakpoints inside those graphs are shown but never hit, the same way DevTools
 * shows a breakpoint it cannot honour rather than pretending it is not there.
 */
export function isPausableBlueprintRunGraphKind(kind: BlueprintRunGraphKind): boolean {
    return kind !== "storyActionValue" && kind !== "validate";
}
