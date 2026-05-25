/**
 * Host API access for built-in nodes that require Dev Mode / blueprint runtime.
 * Comments in English per project convention.
 */

import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BehaviorNodeDefinition } from "../../behavior-graph/BehaviorNodeRegistry";

export function requireHostApi(ctx: Parameters<BehaviorNodeDefinition["execute"]>[0]) {
    const api = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!api) {
        throw new BlueprintGraphExecutionError("Host API unavailable (use Dev Mode)", ctx.node.id);
    }
    return api;
}
