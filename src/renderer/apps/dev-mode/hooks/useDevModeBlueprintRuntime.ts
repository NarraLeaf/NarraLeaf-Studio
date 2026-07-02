import { useCallback } from "react";
import type { BlueprintDebugEvent } from "@shared/types/blueprint/debug";
import type { DevModeBundle } from "@shared/types/devMode";
import { getInterface } from "@/lib/app/bridge";
import {
    useBlueprintRuntimeCore,
    type BlueprintRuntimeCore,
} from "@/lib/ui-editor/runtime/game/useBlueprintRuntimeCore";

export type DevModeBlueprintRuntimeCore = BlueprintRuntimeCore;

/**
 * Per-bundle Dev Mode Blueprint runtime core (scopes + debug bus). Host adapter is built in DevModeContent
 * so navigation / widget patches can update React state.
 */
export function useDevModeBlueprintRuntime(
    bundle: DevModeBundle | null,
    projectPath?: string | null,
): DevModeBlueprintRuntimeCore | null {
    const forwardDebugEvent = useCallback((event: BlueprintDebugEvent) => {
        if (!projectPath) {
            return;
        }
        try {
            getInterface().devMode.forwardBlueprintDebugEvent({ projectPath, event });
        } catch (error) {
            console.warn("[DevMode] failed to forward blueprint debug event", error);
        }
    }, [projectPath]);

    return useBlueprintRuntimeCore(bundle, {
        onDebugEvent: projectPath ? forwardDebugEvent : undefined,
        disposeMessage: "Dev Mode runtime disposed",
    });
}
