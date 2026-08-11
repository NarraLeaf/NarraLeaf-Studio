import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import type { AssetOverviewSummary } from "./assetOverviewModel";
import { computeAssetOverviewSnapshot } from "./assetOverviewSnapshot";

/**
 * The measured reading of the asset library: bytes per asset, and who points at what.
 *
 * Everything the asset records cannot answer on their own lives here. It costs a walk of the
 * project's `assets/` directory and a flush of the reference index, so it runs only while something
 * is actually asking — the overview view being on screen, or a size / usage filter being in play.
 * `enabled` going false leaves the last reading in place rather than discarding it: switching back
 * to the overview should not blank the page while a walk it already did runs again.
 */
export function useAssetLibrarySnapshot(context: WorkspaceContext | null, enabled: boolean) {
    const [snapshot, setSnapshot] = useState<AssetOverviewSummary | null>(null);
    const [loading, setLoading] = useState(false);
    const [failed, setFailed] = useState(false);
    const requestRef = useRef(0);
    /**
     * A snapshot builds the reference index and flushes its pending rebuilds, and both of those
     * *announce a change* — so a listener that recomputed on every announcement would recompute on
     * its own footsteps forever. Announcements arriving mid-run are recorded instead of acted on,
     * and settle into at most one further run: the second pass finds nothing left to flush, so it
     * announces nothing. Recording rather than dropping is what keeps a real edit landing during
     * the directory walk from being lost.
     */
    const runningRef = useRef(false);
    const changedWhileRunningRef = useRef(false);
    const refreshRef = useRef<() => void>(() => {});

    const refresh = useCallback(() => {
        if (!context) {
            return;
        }
        const requestId = ++requestRef.current;
        runningRef.current = true;
        changedWhileRunningRef.current = false;
        setLoading(true);
        setFailed(false);
        void computeAssetOverviewSnapshot(context)
            .then(next => {
                if (requestRef.current === requestId) {
                    setSnapshot(next);
                    setLoading(false);
                }
            })
            .catch(error => {
                console.warn("[AssetOverview] Failed to compute the asset snapshot", error);
                if (requestRef.current === requestId) {
                    setFailed(true);
                    setLoading(false);
                }
            })
            .finally(() => {
                if (requestRef.current !== requestId) {
                    return;
                }
                runningRef.current = false;
                if (changedWhileRunningRef.current) {
                    changedWhileRunningRef.current = false;
                    refreshRef.current();
                }
            });
    }, [context]);
    refreshRef.current = refresh;

    useEffect(() => {
        if (enabled) {
            refresh();
        }
    }, [enabled, refresh]);

    // An edit that adds or removes a reference changes which assets are orphans, which is the
    // reading most likely to be acted on. Follow the index rather than leaving a stale answer up.
    useEffect(() => {
        if (!context || !enabled) {
            return;
        }
        const referenceService = context.services.get<ReferenceService>(Services.Reference);
        return referenceService.onIndexChanged(() => {
            if (runningRef.current) {
                changedWhileRunningRef.current = true;
                return;
            }
            refreshRef.current();
        });
    }, [context, enabled]);

    const bytesByAssetId = useMemo(() => {
        if (!snapshot) {
            return null;
        }
        const bytes = new Map<string, number>();
        for (const entry of snapshot.entries) {
            if (entry.bytes !== null) {
                bytes.set(entry.asset.id, entry.bytes);
            }
        }
        return bytes;
    }, [snapshot]);

    const referencedAssetIds = useMemo(() => {
        if (!snapshot) {
            return null;
        }
        return new Set(snapshot.entries.filter(entry => entry.referenced).map(entry => entry.asset.id));
    }, [snapshot]);

    /**
     * Assets the index cannot answer for. Held apart from both filter answers: they are not known
     * to be referenced and they are not known to be unreferenced, and putting them in either
     * bucket would state something the index did not say.
     */
    const usageUnknownAssetIds = useMemo(() => {
        if (!snapshot) {
            return null;
        }
        return new Set(snapshot.entries.filter(entry => !entry.usageKnown).map(entry => entry.asset.id));
    }, [snapshot]);

    return { snapshot, loading, failed, refresh, bytesByAssetId, referencedAssetIds, usageUnknownAssetIds };
}
