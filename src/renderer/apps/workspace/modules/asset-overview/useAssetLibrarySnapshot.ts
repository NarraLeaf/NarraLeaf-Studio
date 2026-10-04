import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Services, type WorkspaceContext } from "@/lib/workspace/services/services";
import { ReferenceService } from "@/lib/workspace/services/references/ReferenceService";
import type { DirectorySizeResult } from "@shared/utils/fs";
import type { AssetOverviewSummary } from "./assetOverviewModel";
import { computeAssetOverviewSnapshot } from "./assetOverviewSnapshot";

/**
 * How long the library has to stay still before the folder is measured again. An import arrives as a
 * run of records, and each is a change; one walk at the end of the run is the one that counts.
 */
const LIBRARY_REWALK_DEBOUNCE_MS = 600;

/**
 * The measured reading of the library: bytes per asset, and who points at what.
 *
 * Everything the asset records cannot answer on their own lives here. It costs a walk of the
 * project's `assets/` directory and a flush of the reference index, so it runs only while something
 * is actually asking — the overview view being on screen, a size / usage filter being in play, or the
 * bottom tray's browser being on screen. `enabled` going false leaves the last reading in place
 * rather than discarding it: switching back should not blank the page while a walk runs again.
 *
 * The two halves are refreshed apart, because they change apart. The reference index moves with
 * every edit that names an asset, and following it is cheap: the counts are read again against the
 * folder measurement already held. The folder itself only changes when a file is added, replaced or
 * removed, which `libraryKey` stands for - so only a change to that key, an explicit refresh, or the
 * reading being switched on walks it again. Walking on every index change cost most of a second of
 * main-process disk reads per pause in typing on a project of a thousand files.
 *
 * @param libraryKey Changes whenever a file in the library does (each record's id and content hash).
 *   Absent until the library has loaded.
 */
export function useAssetLibrarySnapshot(context: WorkspaceContext | null, enabled: boolean, libraryKey?: string) {
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
    /** Whether the run owed after the current one has to measure the folder again. */
    const owedWalkRef = useRef(false);
    /** The last folder measurement, and the library it was taken against. */
    const walkRef = useRef<DirectorySizeResult | null>(null);
    const walkKeyRef = useRef<string | undefined>(undefined);
    const libraryKeyRef = useRef(libraryKey);
    libraryKeyRef.current = libraryKey;
    const runRef = useRef<(walk: boolean) => void>(() => {});

    const run = useCallback((walk: boolean) => {
        if (!context) {
            return;
        }
        const requestId = ++requestRef.current;
        runningRef.current = true;
        changedWhileRunningRef.current = false;
        owedWalkRef.current = false;
        setLoading(true);
        setFailed(false);
        const reuse = walk ? undefined : walkRef.current ?? undefined;
        if (!reuse) {
            // Recorded as the walk starts, not when it lands: switching the reading on walks, and the
            // library check in the same commit must see that this library is already being measured.
            walkKeyRef.current = libraryKeyRef.current;
        }
        void computeAssetOverviewSnapshot(context, reuse)
            .then(next => {
                if (requestRef.current === requestId) {
                    if (!reuse) {
                        walkRef.current = next.walk;
                    }
                    setSnapshot(next.summary);
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
                    runRef.current(owedWalkRef.current);
                }
            });
    }, [context]);
    runRef.current = run;

    /** Run now, or once the run in flight has finished. A walk asked for while one runs is kept. */
    const request = useCallback((walk: boolean) => {
        if (runningRef.current) {
            changedWhileRunningRef.current = true;
            owedWalkRef.current = owedWalkRef.current || walk;
            return;
        }
        runRef.current(walk);
    }, []);

    /** The refresh a person asks for re-reads everything, the folder included. */
    const refresh = useCallback(() => run(true), [run]);

    useEffect(() => {
        if (enabled) {
            run(true);
        }
    }, [enabled, run]);

    // An edit that adds or removes a reference changes which assets are orphans, which is the
    // reading most likely to be acted on. Follow the index rather than leaving a stale answer up -
    // against the folder measurement already held.
    useEffect(() => {
        if (!context || !enabled) {
            return;
        }
        const referenceService = context.services.get<ReferenceService>(Services.Reference);
        return referenceService.onIndexChanged(() => request(false));
    }, [context, enabled, request]);

    // A file added, replaced or removed: measure the folder again once the library settles.
    useEffect(() => {
        if (!enabled || libraryKey === undefined) {
            return;
        }
        if (walkKeyRef.current === undefined) {
            // The walk was started before the library had loaded, and measures the same files.
            walkKeyRef.current = libraryKey;
            return;
        }
        if (walkKeyRef.current === libraryKey) {
            return;
        }
        const timer = window.setTimeout(() => request(true), LIBRARY_REWALK_DEBOUNCE_MS);
        return () => window.clearTimeout(timer);
    }, [enabled, libraryKey, request]);

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

    /** How many places use each asset, for the readouts that print the number rather than a yes/no. */
    const referenceCountByAssetId = useMemo(() => {
        if (!snapshot) {
            return null;
        }
        return new Map(snapshot.entries.map(entry => [entry.asset.id, entry.referenceCount]));
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

    return {
        snapshot,
        loading,
        failed,
        refresh,
        bytesByAssetId,
        referencedAssetIds,
        referenceCountByAssetId,
        usageUnknownAssetIds,
    };
}
