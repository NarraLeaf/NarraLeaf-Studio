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
export function buildUIComponentInstanceKey(outer: string | undefined, instanceElementId: string): string {
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

/**
 * Step one component boundary outwards: the placement, and the key of whatever encloses it.
 *
 * An event that has walked to the top of a definition's own tree has not finished - the instance is
 * a widget on a page, and the container it was placed in is still entitled to hear a click over it.
 * The definition cannot name that container, but the key already names the element that placed it,
 * which is where the walk carries on from.
 *
 * Returns null when the key names no component, which is how the caller knows the walk really has
 * reached the top. The innermost segment is the one that goes, so a component inside a component
 * surfaces one level at a time.
 */
export function popUIComponentInstanceKey(
    instanceKey: string | undefined,
): { instanceElementId: string; outerKey: string } | null {
    if (!instanceKey) {
        return null;
    }
    const segments = instanceKey.split(SEPARATOR);
    for (let i = segments.length - 1; i >= 0; i--) {
        const segment = segments[i]!;
        if (!segment.startsWith(SEGMENT_PREFIX)) {
            continue;
        }
        const instanceElementId = segment.slice(SEGMENT_PREFIX.length);
        if (instanceElementId.length === 0) {
            return null;
        }
        return { instanceElementId, outerKey: segments.slice(0, i).join(SEPARATOR) };
    }
    return null;
}

/**
 * The surface id a component definition's own tree is laid out under.
 *
 * A definition is rendered inside a virtual surface of its own (see `SurfaceElementTree`), because
 * everything downstream of a render wants a surface and a definition has none of its own. Element
 * references written inside its blueprint therefore name this rather than whichever surface an
 * instance ended up on - which the definition cannot know, and which differs between two placements
 * of the same component.
 *
 * Here rather than inlined at each of the two ends, for the ordinary reason: one is minted by the
 * renderer and the other is compared against by every node that targets an element, and a format
 * spelled twice is a format that stops matching the first time either side is touched.
 */
export function buildUIComponentSurfaceId(componentId: string): string {
    return `component:${componentId}`;
}

/**
 * Whether an element reference is allowed to name this surface from this execution.
 *
 * A graph may reach the surface it runs on, and a component definition's graph may reach its own
 * tree. Nothing else: reaching into another surface is the thing the check exists to stop, and it
 * still is. An execution that cannot say where it is running answers yes, which is what the check
 * did before there was anything to compare against.
 */
export function isUIElementRefInScope(
    refSurfaceId: string | undefined,
    owner: { surfaceId?: string; componentId?: string } | undefined,
): boolean {
    if (!owner?.surfaceId) {
        return true;
    }
    if (refSurfaceId === owner.surfaceId) {
        return true;
    }
    return Boolean(owner.componentId) && refSurfaceId === buildUIComponentSurfaceId(owner.componentId!);
}
