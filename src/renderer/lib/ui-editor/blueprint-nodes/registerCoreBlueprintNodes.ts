/**
 * Registers all built-in blueprint nodes (single entry; definitions live under ./built-in).
 * Comments in English per project convention.
 */

import { setBehaviorDataPinResolver } from "../behavior-graph/dataPinResolver";
import { allBuiltinBlueprintNodes } from "./built-in";
import { resolveDataPinValue } from "./built-in/graphParamResolvers";
import { blueprintNodeRegistry } from "./BlueprintNodeRegistry";
import { defineBlueprintNode } from "./defineBlueprintNode";

/**
 * Installed here rather than imported by the executor: `graphParamResolvers`
 * depends on `behavior-graph`, so a direct import would close a module cycle.
 * This function is the one entry every execution environment already calls.
 */
function installDataPinResolver(): void {
    setBehaviorDataPinResolver((ctx, pinId) =>
        resolveDataPinValue(ctx.graph, ctx.node.id, pinId, ctx.params, ctx.blueprintLocals, 0, {
            hostAdapter: ctx.hostAdapter,
            eventPayload: ctx.eventPayload,
            listItemScope: ctx.listItemScope,
            instanceKey: ctx.instanceKey,
            executionOwner: ctx.executionOwner,
            valueExecution: ctx.valueExecution,
        }),
    );
}

export function registerCoreBlueprintNodes(): void {
    installDataPinResolver();
    for (const def of allBuiltinBlueprintNodes) {
        if (!blueprintNodeRegistry.get(def.type)) {
            defineBlueprintNode(def);
        }
    }
}
