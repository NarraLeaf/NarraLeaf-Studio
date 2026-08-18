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

/**
 * Every kind, as a value the parse can check against.
 *
 * A union type is erased by the time a string arrives from somewhere else, so without this the
 * parse's only options are to cast (and hand back a `kind` no branch of this module has heard of)
 * or to stop reporting one at all.
 */
const RUN_GRAPH_KIND_LIST = [
  "blueprintEvent",
  "widgetEvent",
  "surfaceEvent",
  "globalEvent",
  "broadcastEvent",
  "elementFlush",
  "elementClick",
  "fnCall",
  "blueprintValue",
  "storyAction",
  "storyActionValue",
  "storyActionFn",
  "validate"
] as const;

/**
 * Adding a kind to {@link BlueprintRunGraphKind} without adding it to the list above is a type
 * error here rather than a run graph id that silently stops parsing. `never` is the passing value:
 * it means the union has nothing left over that the list does not name.
 */
type UnlistedRunGraphKind = Exclude<BlueprintRunGraphKind, (typeof RUN_GRAPH_KIND_LIST)[number]>;
const _allRunGraphKindsListed: UnlistedRunGraphKind[] = [];
void _allRunGraphKindsListed;

const RUN_GRAPH_KINDS: ReadonlySet<string> = new Set<BlueprintRunGraphKind>(RUN_GRAPH_KIND_LIST);

export type BlueprintRunGraphRef = {
  kind: BlueprintRunGraphKind;
  blueprintId: string;
  /** The graph's own id inside the blueprint - an event graph id or a function graph id. */
  graphId: string;
};

export function buildBlueprintRunGraphId(
  kind: BlueprintRunGraphKind,
  blueprintId: string,
  graphId: string
): string {
  return `${kind}${SEPARATOR}${blueprintId}${SEPARATOR}${graphId}`;
}

/**
 * Recover the three parts of a run graph id. Returns null for anything this module did not build,
 * which callers must treat as "not attributable to an authored graph" rather than guessing.
 *
 * The kind is checked against {@link RUN_GRAPH_KINDS}, not cast to it. An unrecognised kind is a
 * string this module did not write, and the difference matters downstream:
 * {@link isPausableBlueprintRunGraphKind} is a deny-list, so a kind nobody has heard of would come
 * back "pausable" and the debugger would offer to stop a frame it cannot describe.
 */
export function parseBlueprintRunGraphId(
  runGraphId: string | undefined
): BlueprintRunGraphRef | null {
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
  const kind = runGraphId.slice(0, firstSeparator);
  if (!RUN_GRAPH_KINDS.has(kind)) {
    return null;
  }
  return {
    kind: kind as BlueprintRunGraphKind,
    blueprintId: runGraphId.slice(firstSeparator + 1, secondSeparator),
    graphId: runGraphId.slice(secondSeparator + 1)
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
