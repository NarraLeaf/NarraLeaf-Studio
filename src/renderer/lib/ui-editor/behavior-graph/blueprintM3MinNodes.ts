import { behaviorNodeRegistry, type BehaviorNodeDefinition } from "./BehaviorNodeRegistry";

const StateSetNode: BehaviorNodeDefinition = {
    type: "blueprint.state.set",
    displayName: "Set surface state",
    execute: ({ params, hostAdapter }) => {
        const rt = hostAdapter.blueprintRuntime;
        if (!rt) {
            throw new Error("blueprint.state.set requires blueprintRuntime on UIHostAdapter");
        }
        const key = String(params.key ?? "").trim();
        if (!key) {
            throw new Error("blueprint.state.set requires params.key");
        }
        const value = params.value;
        rt.setSurfaceState(key, value);
        return { nextPort: "next" };
    },
};

behaviorNodeRegistry.register(StateSetNode);
