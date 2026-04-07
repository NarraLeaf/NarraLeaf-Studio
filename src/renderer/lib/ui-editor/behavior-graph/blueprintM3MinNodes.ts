import { behaviorNodeRegistry, type BehaviorNodeDefinition } from "./BehaviorNodeRegistry";
import { BlueprintGraphExecutionError } from "./GraphExecutionError";
import { blueprintWidgetSetVariantNode } from "./blueprintWidgetSetVariantNode";

const StateSetNode: BehaviorNodeDefinition = {
    type: "blueprint.state.set",
    displayName: "Set surface state",
    execute: ({ params, hostAdapter, node }) => {
        const rt = hostAdapter.blueprintRuntime;
        if (!rt) {
            throw new BlueprintGraphExecutionError("blueprint.state.set requires blueprintRuntime on UIHostAdapter", node.id);
        }
        const key = String(params.key ?? "").trim();
        if (!key) {
            throw new BlueprintGraphExecutionError("blueprint.state.set requires params.key", node.id);
        }
        const value = params.value;
        if (rt.hostApi) {
            rt.hostApi.state.set("surface", key, value);
        } else {
            rt.setSurfaceState(key, value);
        }
        return { nextPort: "next" };
    },
};

// Load before blueprintM3FullNodes (see builtinNodes.ts); register setVariant here to avoid duplicate registry overwrite.
behaviorNodeRegistry.registerMany([blueprintWidgetSetVariantNode, StateSetNode]);
