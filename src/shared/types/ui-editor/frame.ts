import type { UIDocument, UIElement, UIElementId, UISurface, UISurfaceId } from "./document";

export const UI_FRAME_ELEMENT_TYPE = "nl.frame" as const;

export type UIFrameNavigationMode = "static";

export type UIFrameWidgetProps = {
    targetSurfaceId: UISurfaceId | null;
    params: Record<string, unknown>;
    navigationMode: UIFrameNavigationMode;
    animation?: {
        enter?: string;
        exit?: string;
    };
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
    const animation = isRecord(input.animation)
        ? {
              enter: typeof input.animation.enter === "string" ? input.animation.enter : undefined,
              exit: typeof input.animation.exit === "string" ? input.animation.exit : undefined,
          }
        : undefined;
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

function collectSurfaceFrameTargets(
    document: UIDocument,
    surfaceId: UISurfaceId,
    ignoredFrameElementId: UIElementId | null,
): UISurfaceId[] {
    const rootId = getSurface(document, surfaceId)?.rootElementId;
    if (!rootId) {
        return [];
    }
    const out: UISurfaceId[] = [];
    const visit = (elementId: UIElementId) => {
        const element = document.elements[elementId];
        if (!element) {
            return;
        }
        if (element.type === UI_FRAME_ELEMENT_TYPE && element.id !== ignoredFrameElementId) {
            const target = getUIFrameWidgetProps(element).targetSurfaceId;
            if (target) {
                out.push(target);
            }
        }
        for (const childId of element.childrenIds ?? []) {
            visit(childId);
        }
    };
    visit(rootId);
    return out;
}

function surfaceCanReachSurface(
    document: UIDocument,
    startSurfaceId: UISurfaceId,
    targetSurfaceId: UISurfaceId,
    ignoredFrameElementId: UIElementId | null,
    seen: Set<UISurfaceId>,
): boolean {
    if (startSurfaceId === targetSurfaceId) {
        return true;
    }
    if (seen.has(startSurfaceId)) {
        return false;
    }
    seen.add(startSurfaceId);
    for (const nextSurfaceId of collectSurfaceFrameTargets(document, startSurfaceId, ignoredFrameElementId)) {
        if (surfaceCanReachSurface(document, nextSurfaceId, targetSurfaceId, ignoredFrameElementId, seen)) {
            return true;
        }
    }
    return false;
}

export function getUIFrameTargetInvalidReason(input: {
    document: UIDocument;
    sourceSurfaceId: UISurfaceId;
    frameElementId: UIElementId | null;
    targetSurfaceId: UISurfaceId | null | undefined;
}): UIFrameTargetInvalidReason | null {
    const target = getSurface(input.document, input.targetSurfaceId);
    if (!target) {
        return input.targetSurfaceId ? "missing" : null;
    }
    if (target.kind !== "appSurface") {
        return "not_page";
    }
    if (target.id === input.sourceSurfaceId) {
        return "self";
    }
    if (
        surfaceCanReachSurface(
            input.document,
            target.id,
            input.sourceSurfaceId,
            input.frameElementId,
            new Set(),
        )
    ) {
        return "cycle";
    }
    return null;
}

export function isValidUIFrameTarget(input: {
    document: UIDocument;
    sourceSurfaceId: UISurfaceId;
    frameElementId: UIElementId | null;
    targetSurfaceId: UISurfaceId | null | undefined;
}): boolean {
    return getUIFrameTargetInvalidReason(input) === null;
}
