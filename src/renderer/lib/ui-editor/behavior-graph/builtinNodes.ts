import { behaviorNodeRegistry, type BehaviorNodeDefinition } from "./BehaviorNodeRegistry";
import "./blueprintM3MinNodes";

const SequenceNode: BehaviorNodeDefinition = {
    type: "sequence",
    displayName: "Sequence",
    execute: () => ({ nextPort: "next" }),
};

const IfNode: BehaviorNodeDefinition = {
    type: "if",
    displayName: "Conditional",
    execute: ({ params }) => {
        const conditionValue = params.condition ?? params.value ?? false;
        const truthy = Boolean(conditionValue);
        return { nextPort: truthy ? "true" : "false" };
    },
};

const DelayNode: BehaviorNodeDefinition = {
    type: "delay",
    displayName: "Delay",
    async execute({ params }) {
        const duration = Math.max(0, Number(params.duration ?? 0));
        if (duration > 0) {
            await new Promise((resolve) => setTimeout(resolve, duration));
        }
        return { nextPort: "next" };
    },
};

const EffectRunNode: BehaviorNodeDefinition = {
    type: "effect.run",
    displayName: "Run Effect",
    async execute({ params, hostAdapter }) {
        const effectId = String(params.effectId ?? params.effect ?? "").trim();
        if (!effectId) {
            throw new Error("Behavior node 'effect.run' requires an effectId parameter");
        }
        await hostAdapter.effects.runEffect(effectId, params.payload ?? params.data ?? {});
        return { nextPort: "next" };
    },
};

behaviorNodeRegistry.registerMany([SequenceNode, IfNode, DelayNode, EffectRunNode]);
