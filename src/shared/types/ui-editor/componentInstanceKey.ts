/**
 * The key that tells two placements of the same component apart at runtime.
 *
 * A component instance runs the definition's blueprints, so `componentId` and every inner element id
 * are shared by all of its placements; the instance key is the only thing that is not. It is built
 * from the instance element's id and nests, because a component can contain a component.
 *
 * Build and parse live together on purpose. They were a single expression inside the element tree
 * and a second one would have been needed the moment anything downstream wanted the instance back -
 * two spellings of one format, drifting the first time either changed.
 *
 * Comments in English per project convention.
 */

const SEGMENT_PREFIX = "component:";
const SEPARATOR = "\0";

/** `outer` is the key of the component this one sits inside, or empty at the top level. */
export function buildUIComponentInstanceKey(
  outer: string | undefined,
  instanceElementId: string
): string {
  const segment = `${SEGMENT_PREFIX}${instanceElementId}`;
  return outer ? `${outer}${SEPARATOR}${segment}` : segment;
}

/**
 * The innermost instance element id in a key, or null when the key names no component.
 *
 * Innermost because that is the instance whose values an inner element should read: a component
 * placed inside another takes its own params, not its host's.
 */
export function readUIComponentInstanceElementId(instanceKey: string | undefined): string | null {
  if (!instanceKey) {
    return null;
  }
  const segments = instanceKey.split(SEPARATOR);
  for (let i = segments.length - 1; i >= 0; i--) {
    const segment = segments[i]!;
    if (segment.startsWith(SEGMENT_PREFIX)) {
      const id = segment.slice(SEGMENT_PREFIX.length);
      return id.length > 0 ? id : null;
    }
  }
  return null;
}
