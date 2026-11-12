import { useCallback, useSyncExternalStore } from "react";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import type { DevModeService } from "@/lib/workspace/services/core/DevModeService";

const NO_SUBSCRIPTION = () => () => {};

/** Whether an agent's play-test holds this project's Dev Mode; see `DevModeService.isAgentHeld`. */
export function useDevModeAgentHeld(context: WorkspaceContext | null | undefined): boolean {
    const devMode = context ? context.services.get<DevModeService>(Services.DevMode) : null;
    const subscribe = useCallback(
        (listener: () => void) => (devMode ? devMode.onAgentHeldChanged(listener) : NO_SUBSCRIPTION()),
        [devMode],
    );
    return useSyncExternalStore(subscribe, () => devMode?.isAgentHeld() ?? false);
}
