import type { BlueprintGraphKind } from "@shared/types/blueprint/graph";
import { normalizeUIElementRefSurfaceId } from "@shared/types/ui-editor/componentInstanceKey";
import {
    ELEMENT_REF_PARAM_ELEMENT_ID,
    ELEMENT_REF_PARAM_ELEMENT_TYPE,
    ELEMENT_REF_PARAM_SURFACE_ID,
} from "@/lib/ui-editor/blueprint-nodes/built-in/elementRefUtils";

export type BlueprintElementBindingSession = {
    id: string;
    blueprintId: string;
    blueprintTabId: string;
    graphKind: BlueprintGraphKind;
    graphId: string;
    nodeId: string;
    surfaceId: string;
};

export type BlueprintElementBindingTarget = {
    surfaceId: string;
    elementId: string;
    elementType: string;
};

/**
 * A node's params once the element picker has answered for it.
 *
 * An element is picked on the surface it is shown on, and inside a component definition that is the
 * component editor's own surface. The reference is stored under the definition's surface instead
 * (`buildUIComponentSurfaceId`, by way of `normalizeUIElementRefSurfaceId`), the one every check at
 * runtime compares a reference against.
 */
export function withPickedElement(
    params: Record<string, unknown> | undefined,
    target: BlueprintElementBindingTarget,
): Record<string, unknown> {
    return {
        ...(params ?? {}),
        [ELEMENT_REF_PARAM_SURFACE_ID]: normalizeUIElementRefSurfaceId(target.surfaceId),
        [ELEMENT_REF_PARAM_ELEMENT_ID]: target.elementId,
        [ELEMENT_REF_PARAM_ELEMENT_TYPE]: target.elementType,
    };
}

export type BlueprintElementBindingCompletion = {
    session: BlueprintElementBindingSession;
    target: BlueprintElementBindingTarget;
};

let activeSession: BlueprintElementBindingSession | null = null;
let completion: BlueprintElementBindingCompletion | null = null;
const listeners = new Set<() => void>();

function notify(): void {
    for (const listener of [...listeners]) {
        listener();
    }
}

export function subscribeElementBindingSession(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

export function readElementBindingSession(): BlueprintElementBindingSession | null {
    return activeSession;
}

export function readElementBindingCompletion(): BlueprintElementBindingCompletion | null {
    return completion;
}

export function startElementBindingSession(session: BlueprintElementBindingSession): void {
    activeSession = session;
    completion = null;
    notify();
}

export function completeElementBindingSession(target: BlueprintElementBindingTarget): void {
    if (!activeSession) {
        return;
    }
    completion = { session: activeSession, target };
    activeSession = null;
    notify();
}

export function completeElementBindingSessionForSession(
    session: BlueprintElementBindingSession,
    target: BlueprintElementBindingTarget,
): void {
    if (activeSession && activeSession.id !== session.id) {
        return;
    }
    completion = { session, target };
    activeSession = activeSession?.id === session.id ? null : activeSession;
    notify();
}

export function cancelElementBindingSession(): void {
    activeSession = null;
    notify();
}

export function cancelElementBindingSessionById(sessionId: string): void {
    if (activeSession?.id !== sessionId) {
        return;
    }
    activeSession = null;
    notify();
}

export function clearElementBindingCompletion(): void {
    completion = null;
    notify();
}
