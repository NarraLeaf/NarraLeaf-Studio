import type { UIHostAdapter } from "../types";

export function createEditorHostAdapter(): UIHostAdapter {
    return {
        host: "app",
        navigate: async (target) => {
            console.debug("[EditorHostAdapter] navigate", target);
        },
        resolveSlot: () => null,
        effects: {
            runEffect: async (effectId, payload) => {
                console.debug("[EditorHostAdapter] runEffect", effectId, payload);
            },
        },
    };
}
