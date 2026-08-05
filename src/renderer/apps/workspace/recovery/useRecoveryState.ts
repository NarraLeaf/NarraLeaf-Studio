import { useEffect, useState, useSyncExternalStore } from "react";
import { Services } from "@/lib/workspace/services/services";
import type { WorkspaceContext } from "@/lib/workspace/services/services";
import type { RecoveryProbeState } from "@/lib/workspace/services/core/RecoveryService";
import type { RecoveryService } from "@/lib/workspace/services/core/RecoveryService";
import {
    getWorkspaceAnomalies,
    observeWorkspaceAnomalies,
    type WorkspaceAnomaly,
} from "@/lib/workspace/recovery/anomalyLog";

/**
 * The anomaly log as React state.
 *
 * `useSyncExternalStore` rather than an effect-plus-setState because the log is written to during
 * startup - by services initializing, before this component has mounted - and a subscription that
 * only caught later writes would render an empty list on a window that opened *because* the list was
 * not empty.
 */
export function useWorkspaceAnomalyList(): readonly WorkspaceAnomaly[] {
    return useSyncExternalStore(
        // The observer fires immediately on subscribe, which React does not want here (it would be a
        // render-phase update); the immediate call is harmless because the snapshot below is what
        // React reads, and this only has to schedule re-renders.
        onStoreChange => observeWorkspaceAnomalies(() => onStoreChange()),
        getWorkspaceAnomalies,
        getWorkspaceAnomalies,
    );
}

/** Probe rows plus whether one is running. Re-renders on every probe state change. */
export function useRecoveryProbes(context: WorkspaceContext | null): {
    probes: readonly RecoveryProbeState[];
    running: boolean;
} {
    const [state, setState] = useState<{ probes: readonly RecoveryProbeState[]; running: boolean }>({
        probes: [],
        running: false,
    });

    useEffect(() => {
        if (!context) {
            setState({ probes: [], running: false });
            return;
        }
        const service = context.services.get<RecoveryService>(Services.Recovery);
        const read = () => setState({ probes: service.getProbes(), running: service.isRunning() });
        read();
        return service.onChanged(read);
    }, [context]);

    return state;
}
