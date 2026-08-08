/**
 * Where a fetched response body lives between Fetch and a reader node.
 *
 * In the execution's own `blueprintLocals`, under a key no pin can name. That object is created by
 * `executeGraph` per run and dropped when the run ends, which gives the bodies exactly the lifetime
 * the design calls for - scoped to one execution chain, unreachable from any other, and freed
 * without a release node, a cleanup hook or anything for an author to remember.
 *
 * What the handle buys, given the bytes are in `blueprintLocals` either way, is that the *pin*
 * carries an id instead of the body: nothing copies a megabyte of JSON into a node output, onto a
 * data edge, or into a local variable an author wired it to by mistake.
 *
 * Comments in English per project convention.
 */

import { BLUEPRINT_NETWORK_MAX_LIVE_BODIES } from "@shared/types/blueprint/network";
import {
    toBlueprintResponseBody,
    type BlueprintResponseBody,
} from "@shared/types/blueprint/valueTypes";

/**
 * Deliberately not a valid node id, so it cannot collide with the node output values that share
 * this object (`writeBlueprintNodeOutputValues` keys by node id).
 */
const RESPONSE_BODY_STORE_KEY = "@network/responseBodies";

type ResponseBodyStore = {
    bodies: Map<string, string>;
    /** Monotonic within one execution; ids only ever have to be unique inside this store. */
    nextId: number;
};

function readStore(blueprintLocals: Record<string, unknown>): ResponseBodyStore {
    const existing = blueprintLocals[RESPONSE_BODY_STORE_KEY] as ResponseBodyStore | undefined;
    if (existing) {
        return existing;
    }
    const created: ResponseBodyStore = { bodies: new Map(), nextId: 1 };
    blueprintLocals[RESPONSE_BODY_STORE_KEY] = created;
    return created;
}

/** How many bodies this execution is already holding. Fetch refuses past the cap. */
export function countLiveResponseBodies(blueprintLocals: Record<string, unknown>): number {
    return readStore(blueprintLocals).bodies.size;
}

export function isResponseBodyLimitReached(blueprintLocals: Record<string, unknown>): boolean {
    return countLiveResponseBodies(blueprintLocals) >= BLUEPRINT_NETWORK_MAX_LIVE_BODIES;
}

/** Take ownership of a fetched body and return the handle that addresses it. */
export function storeResponseBody(
    blueprintLocals: Record<string, unknown>,
    nodeId: string,
    body: string,
): BlueprintResponseBody {
    const store = readStore(blueprintLocals);
    const id = `${nodeId}#${store.nextId}`;
    store.nextId += 1;
    store.bodies.set(id, body);
    // Non-null: the id above is always a non-empty string.
    return toBlueprintResponseBody(id)!;
}

/**
 * The text behind a handle, or null when this execution never held it.
 *
 * Null is reachable two ways: a handle minted by a different execution chain, and a handle from an
 * execution that has since ended. Callers report both as the graph being wired wrong, which is what
 * they are - a response cannot outlive its own run by design.
 */
export function readResponseBody(
    blueprintLocals: Record<string, unknown>,
    handle: BlueprintResponseBody,
): string | null {
    return readStore(blueprintLocals).bodies.get(handle.id) ?? null;
}
