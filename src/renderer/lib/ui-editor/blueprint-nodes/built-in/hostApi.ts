/**
 * Host API access for built-in nodes that require Dev Mode / blueprint runtime.
 * Comments in English per project convention.
 */

import { translate } from "@/lib/i18n";
import { BlueprintGraphExecutionError } from "../../behavior-graph/GraphExecutionError";
import type { BehaviorNodeDefinition } from "../../behavior-graph/BehaviorNodeRegistry";

export function requireHostApi(ctx: Parameters<BehaviorNodeDefinition["execute"]>[0]) {
    const api = ctx.hostAdapter.blueprintRuntime?.hostApi;
    if (!api) {
        throw new BlueprintGraphExecutionError(translate("blueprint.runtimeError.needsHost"), ctx.node.id);
    }
    return api;
}
