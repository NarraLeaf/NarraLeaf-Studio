import type { UIHostAdapter } from "../types";

export function createEditorHostAdapter(): UIHostAdapter {
    return {
        host: "app",
        navigate: async (target) => {
            console.debug("[EditorHostAdapter] navigate", target);
        },
        resolveSlot: () => null,
    };
}
