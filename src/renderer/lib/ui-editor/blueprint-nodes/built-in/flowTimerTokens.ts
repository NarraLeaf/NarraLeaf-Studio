/**
 * Runtime tokens for skippable flow timers.
 * Comments in English per project convention.
 */

import {
    normalizeBlueprintTimerToken,
    toBlueprintTimerToken,
    type BlueprintTimerToken,
} from "@shared/types/blueprint/valueTypes";

export const BLUEPRINT_FLOW_DELAY_TOKEN_PIN_ID = "token";
const BLUEPRINT_FLOW_DELAY_TOKEN_PREFIX = "delay:";

type DelayTimerTokenInput = {
    graphId?: string;
    nodeId: string;
    instanceKey?: string;
    executionOwner?: {
        surfaceId?: string;
        elementId?: string;
        blueprintId?: string;
        componentId?: string;
    };
};

type DelayTimerSkipHandler = () => void;

const pendingDelayTimers = new Map<string, Set<DelayTimerSkipHandler>>();

function cleanTokenPart(value: string | undefined): string {
    return value?.trim() || "-";
}

function encodeTokenPart(value: string): string {
    return encodeURIComponent(value);
}

export function createDelayTimerToken(input: DelayTimerTokenInput): BlueprintTimerToken {
    const owner = input.executionOwner;
    const parts = [
        "delay",
        cleanTokenPart(owner?.blueprintId),
        cleanTokenPart(owner?.surfaceId),
        cleanTokenPart(owner?.elementId),
        cleanTokenPart(owner?.componentId),
        cleanTokenPart(input.instanceKey),
        cleanTokenPart(input.graphId),
        cleanTokenPart(input.nodeId),
    ];
    const token = toBlueprintTimerToken(parts.map(encodeTokenPart).join(":"));
    if (!token) {
        throw new Error("Failed to create Delay timer token");
    }
    return token;
}

export function normalizeDelayTimerToken(value: unknown): BlueprintTimerToken | null {
    const token = normalizeBlueprintTimerToken(value);
    if (!token || !token.id.startsWith(BLUEPRINT_FLOW_DELAY_TOKEN_PREFIX)) {
        return null;
    }
    return token;
}

export function registerPendingDelayTimer(token: BlueprintTimerToken, skip: DelayTimerSkipHandler): () => void {
    const delayToken = normalizeDelayTimerToken(token);
    if (!delayToken) {
        return () => undefined;
    }
    let timers = pendingDelayTimers.get(delayToken.id);
    if (!timers) {
        timers = new Set<DelayTimerSkipHandler>();
        pendingDelayTimers.set(delayToken.id, timers);
    }
    timers.add(skip);

    return () => {
        timers?.delete(skip);
        if (timers?.size === 0) {
            pendingDelayTimers.delete(delayToken.id);
        }
    };
}

export function skipDelayTimerToken(value: unknown): boolean {
    const token = normalizeDelayTimerToken(value);
    if (!token) {
        return false;
    }
    const timers = pendingDelayTimers.get(token.id);
    if (!timers || timers.size === 0) {
        return false;
    }
    for (const skip of Array.from(timers)) {
        skip();
    }
    return true;
}
