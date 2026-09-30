import {
    getUIComponentLink,
    type UIComponentDefinition,
    type UIComponentId,
    type UIDocument,
    type UIElement,
    type UIElementId,
    type UISurface,
    type UISurfaceId,
} from "./document";
import { normalizeOptionalUIPageAnimationSettings, type UIPageAnimationSettings } from "./pageAnimation";

export const UI_FRAME_ELEMENT_TYPE = "nl.frame" as const;

export type UIFrameNavigationMode = "static";

export type UIFrameWidgetProps = {
    targetSurfaceId: UISurfaceId | null;
    params: Record<string, unknown>;
    navigationMode: UIFrameNavigationMode;
    /** Undefined means this Page component inherits the target Page animation settings. */
    animation?: UIPageAnimationSettings;
};

export type UIFrameTargetInvalidReason = "missing" | "not_page" | "self" | "cycle";

export const DEFAULT_UI_FRAME_WIDGET_PROPS: UIFrameWidgetProps = {
    targetSurfaceId: null,
    params: {},
    navigationMode: "static",
};

function isRecord(value: unknown): value is Record<string, unknown> {
    return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function normalizeUIFrameWidgetProps(raw: unknown): UIFrameWidgetProps {
    const input = isRecord(raw) ? raw : {};
    const target =
        typeof input.targetSurfaceId === "string" && input.targetSurfaceId.trim().length > 0
            ? input.targetSurfaceId.trim()
            : null;
    const params = isRecord(input.params) ? input.params : {};
    const animation = normalizeOptionalUIPageAnimationSettings(input.animation);
    return {
        targetSurfaceId: target,
        params,
        navigationMode: "static",
        ...(animation ? { animation } : {}),
    };
}

export function getUIFrameWidgetProps(element: Pick<UIElement, "props">): UIFrameWidgetProps {
    return normalizeUIFrameWidgetProps(element.props);
}

function getSurface(document: UIDocument, surfaceId: UISurfaceId | null | undefined): UISurface | undefined {
    return surfaceId ? document.surfaces.find(surface => surface.id === surfaceId) : undefined;
}

export function findUIElementSurfaceId(
    document: UIDocument,
    elementId: UIElementId | null | undefined,
): UISurfaceId | null {
    let current = elementId ? document.elements[elementId] : undefined;
    while (current) {
        const currentElement = current;
        const surface = document.surfaces.find(item => item.rootElementId === currentElement.id);
        if (surface) {
            return surface.id;
        }
        current = currentElement.parentId ? document.elements[currentElement.parentId] : undefined;
    }
    return null;
}

/**
 * Where a Page widget sits: on a surface, or inside a component definition.
 *
 * A definition's elements are on no page - they are drawn wherever the component is placed - so a
 * Page widget in one belongs to the definition, and every question about it (what it embeds, whether
 * that leads back to it) is asked of the definition rather than of any one page that places it.
 */
export type UIFrameHost =
    | { kind: "surface"; surfaceId: UISurfaceId }
    | { kind: "component"; componentId: UIComponentId };

/** One Page widget and where it sits. */
export type UIFrameSite = {
    host: UIFrameHost;
    element: UIElement;
};

/**
 * What draws what, in one document: each page and each component definition, and the pages and
 * definitions drawn inside it.
 *
 * Two kinds of edge, because two things draw something else inside a tree: a Page widget draws the
 * page it names, and a linked placement draws its definition. Following only the first - which is
 * all this module did while a Page widget inside a component could not draw anything - misses every
 * loop that runs through a component: a card whose Page widget names the page the card is placed on
 * is page -> card -> page, and it has no page-to-page edge at all.
 *
 * List rows need no edge of their own: a row template is an ordinary child of its list, so a
 * placement or a Page widget in a row is in the tree the walk already covers - drawn once per row,
 * which changes how often a loop is drawn, not whether there is one.
 */
type FrameGraphNode = {
    /** Page widgets in this tree that name a page, in tree order. */
    frames: { elementId: UIElementId; target: UISurfaceId }[];
    /** The definitions placed in this tree. */
    components: UIComponentId[];
};

/** A key no surface id and no component id can collide on: the prefix tells the two tables apart. */
function frameHostKey(host: UIFrameHost): string {
    return host.kind === "surface" ? `s:${host.surfaceId}` : `c:${host.componentId}`;
}

function findComponent(document: UIDocument, componentId: UIComponentId): UIComponentDefinition | undefined {
    return (document.components ?? []).find(component => component.id === componentId);
}

/**
 * Every element of a host's tree, depth first from its root.
 *
 * A node already visited is not descended into again: a cycle in `childrenIds` is a malformed
 * document, and every caller here has to survive one rather than hang on it.
 */
function walkFrameHost(document: UIDocument, host: UIFrameHost, visit: (element: UIElement) => void): void {
    let elements: Record<UIElementId, UIElement>;
    let rootId: UIElementId | undefined;
    if (host.kind === "surface") {
        elements = document.elements;
        rootId = getSurface(document, host.surfaceId)?.rootElementId;
    } else {
        const component = findComponent(document, host.componentId);
        elements = component?.elements ?? {};
        rootId = component?.rootElementId;
    }
    if (!rootId) {
        return;
    }
    const seen = new Set<UIElementId>();
    const walk = (elementId: UIElementId) => {
        const element = elements[elementId];
        if (!element || seen.has(elementId)) {
            return;
        }
        seen.add(elementId);
        visit(element);
        for (const childId of element.childrenIds ?? []) {
            walk(childId);
        }
    };
    walk(rootId);
}

/** Every host the document has: its surfaces in order, then its component definitions. */
function listFrameHosts(document: UIDocument): UIFrameHost[] {
    const surfaces = document.surfaces.map((surface): UIFrameHost => ({ kind: "surface", surfaceId: surface.id }));
    const components = (document.components ?? []).map(
        (component): UIFrameHost => ({ kind: "component", componentId: component.id }),
    );
    return [...surfaces, ...components];
}

/**
 * Every Page widget in the document - on every surface, and inside every component definition -
 * each with the host it sits in.
 *
 * A definition's Page widget is listed once, however many times the component is placed: it is one
 * widget the author wrote once, and whatever is wrong with it is wrong in the definition.
 */
export function listUIFrameSites(document: UIDocument): UIFrameSite[] {
    const sites: UIFrameSite[] = [];
    for (const host of listFrameHosts(document)) {
        walkFrameHost(document, host, element => {
            if (element.type === UI_FRAME_ELEMENT_TYPE) {
                sites.push({ host, element });
            }
        });
    }
    return sites;
}

/**
 * Which host an element is in - a surface's tree first, then a component definition's.
 *
 * For a caller that has an element and not the place it sits. A component editor selects inside a
 * view of its own, whose surface is not one of the document's, so the document is asked instead.
 */
export function findUIFrameHost(document: UIDocument, elementId: UIElementId | null | undefined): UIFrameHost | null {
    if (!elementId) {
        return null;
    }
    const surfaceId = findUIElementSurfaceId(document, elementId);
    if (surfaceId) {
        return { kind: "surface", surfaceId };
    }
    for (const component of document.components ?? []) {
        if (!component.elements?.[elementId]) {
            continue;
        }
        const host: UIFrameHost = { kind: "component", componentId: component.id };
        let found = false;
        walkFrameHost(document, host, element => {
            found ||= element.id === elementId;
        });
        if (found) {
            return host;
        }
    }
    return null;
}

/**
 * The document's frame graph, built once and asked as many times as a caller likes.
 *
 * A picker asks about every page in the project for one Page widget, and lint asks about every Page
 * widget in the project. The edges out of a page or a definition are read the first time something
 * asks for them and kept, so neither pays for walking the same tree again per question.
 */
export type UIFrameGraph = {
    /** Why `targetSurfaceId` cannot be the page this Page widget draws, or null when it can. */
    targetInvalidReason(input: {
        host: UIFrameHost;
        frameElementId: UIElementId | null;
        targetSurfaceId: UISurfaceId | null | undefined;
    }): UIFrameTargetInvalidReason | null;
};

export function buildUIFrameGraph(document: UIDocument): UIFrameGraph {
    const nodes = new Map<string, FrameGraphNode>();
    const nodeOf = (host: UIFrameHost): FrameGraphNode => {
        const key = frameHostKey(host);
        const known = nodes.get(key);
        if (known) {
            return known;
        }
        const node: FrameGraphNode = { frames: [], components: [] };
        walkFrameHost(document, host, element => {
            if (element.type === UI_FRAME_ELEMENT_TYPE) {
                const target = getUIFrameWidgetProps(element).targetSurfaceId;
                if (target) {
                    node.frames.push({ elementId: element.id, target });
                }
            }
            const componentId = getUIComponentLink(element)?.componentId;
            if (componentId) {
                node.components.push(componentId);
            }
        });
        nodes.set(key, node);
        return node;
    };

    /**
     * Whether drawing `from` draws `to` somewhere inside it, not counting the Page widget `ignored`.
     *
     * The widget being asked about is left out: the question is where its new target would lead,
     * and its current target is the answer being replaced. Only a page that can be drawn is followed
     * - a Page widget naming a missing page or a Game UI draws a placeholder, not that surface, so
     * nothing past it is drawn either - and only a definition the library has.
     */
    const reaches = (
        from: UIFrameHost,
        to: UIFrameHost,
        ignored: { hostKey: string; elementId: UIElementId } | null,
    ): boolean => {
        const targetKey = frameHostKey(to);
        const seen = new Set<string>();
        const queue: UIFrameHost[] = [from];
        while (queue.length > 0) {
            const host = queue.shift()!;
            const key = frameHostKey(host);
            if (key === targetKey) {
                return true;
            }
            if (seen.has(key)) {
                continue;
            }
            seen.add(key);
            const node = nodeOf(host);
            const skip = ignored?.hostKey === key ? ignored.elementId : null;
            for (const frame of node.frames) {
                if (frame.elementId === skip || getSurface(document, frame.target)?.kind !== "appSurface") {
                    continue;
                }
                queue.push({ kind: "surface", surfaceId: frame.target });
            }
            for (const componentId of node.components) {
                if (findComponent(document, componentId)) {
                    queue.push({ kind: "component", componentId });
                }
            }
        }
        return false;
    };

    return {
        targetInvalidReason: ({ host, frameElementId, targetSurfaceId }) => {
            const target = getSurface(document, targetSurfaceId);
            if (!target) {
                return targetSurfaceId ? "missing" : null;
            }
            if (target.kind !== "appSurface") {
                return "not_page";
            }
            if (host.kind === "surface" && target.id === host.surfaceId) {
                return "self";
            }
            const ignored = frameElementId ? { hostKey: frameHostKey(host), elementId: frameElementId } : null;
            return reaches({ kind: "surface", surfaceId: target.id }, host, ignored) ? "cycle" : null;
        },
    };
}

/**
 * Why a page cannot be the one a Page widget draws, or null when it can.
 *
 * `document` is the project's document: every page with its elements, and every component
 * definition. `cycle` means the page leads back to the widget - it shows the page the widget is on,
 * or places the component the widget is in, directly or through pages and placements of its own -
 * so drawing it would draw the widget again inside itself, and the runtime would stop at "Page loop
 * blocked" instead.
 */
export function getUIFrameTargetInvalidReason(input: {
    document: UIDocument;
    host: UIFrameHost;
    frameElementId: UIElementId | null;
    targetSurfaceId: UISurfaceId | null | undefined;
}): UIFrameTargetInvalidReason | null {
    return buildUIFrameGraph(input.document).targetInvalidReason(input);
}

export function isValidUIFrameTarget(input: {
    document: UIDocument;
    host: UIFrameHost;
    frameElementId: UIElementId | null;
    targetSurfaceId: UISurfaceId | null | undefined;
}): boolean {
    return getUIFrameTargetInvalidReason(input) === null;
}
