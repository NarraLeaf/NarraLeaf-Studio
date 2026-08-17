/**
 * React wrapper around {@link PlaytimeClock}: owns the interval, the visibility listener and the
 * one read of the stored title total, and hands back the operations GameApp and the blueprint host
 * API need.
 *
 * The clock instance is created once per mount and its dependencies are read through refs, so a
 * re-render never rebuilds it — rebuilding would drop the run's accrued seconds on the floor.
 *
 * # Why visibility comes from the page and not from the window
 *
 * The obvious alternative is forwarding the real window's `blur`/`minimize` from the main process,
 * mirroring how fullscreen already reaches this layer. It is the wrong trade here. Nothing forwards
 * those events today, so it would mean a new IPC event, two emit sites (the Dev Mode window and the
 * packaged game's), preload wiring and a host interface field — and the web export has no main
 * process, so it would need this listener as a fallback anyway. One listener that behaves the same
 * in all three shells beats a second mechanism serving two of them.
 *
 * Focus is deliberately not part of it. A player who alt-tabs to read a walkthrough for ten seconds
 * is still playing; a player whose window is minimised is not.
 */

import { useCallback, useEffect, useMemo, useRef } from "react";
import { BLUEPRINT_PLAYTIME_TOTAL_PERSISTENCE_KEY } from "@shared/types/blueprint/hostApi";
import { PLAYTIME_TICK_INTERVAL_MS, PlaytimeClock } from "./playtimeClock";

export type UsePlaytimeOptions = {
    /** True while a playthrough is running. The same gate autosave asks. */
    isPlaying: () => boolean;
    /** Project persistence (scope bridge); values are JSON-safe. */
    persistenceGetAsync: (key: string) => Promise<unknown>;
    persistenceSet: (key: string, value: unknown) => void;
    /** Tick spacing; tests shorten it. */
    tickIntervalMs?: number;
};

export type PlaytimeRuntime = {
    /** Seconds a save written right now would record for this run. */
    getRunSeconds: () => number;
    /** Seconds ever spent in this project, across every playthrough. */
    getTotalSeconds: () => number;
    /**
     * Set the run's playtime: 0 when a new game starts, the stored reading after a load lands.
     * Never called for a load that failed — that player is still on the run they were having.
     */
    seedRun: (seconds: number) => void;
    /** Write out whatever the title total owes. Safe to call when it owes nothing. */
    flush: () => void;
};

/** Hidden covers minimised, and occluded on the platforms that report it. */
function documentHidden(): boolean {
    return typeof document !== "undefined" && document.visibilityState === "hidden";
}

export function usePlaytime(options: UsePlaytimeOptions): PlaytimeRuntime {
    const latest = useRef(options);
    latest.current = options;

    const clock = useMemo(
        () => new PlaytimeClock({
            isPlaying: () => latest.current.isPlaying(),
            isHidden: documentHidden,
            persistTotal: seconds => latest.current.persistenceSet(
                BLUEPRINT_PLAYTIME_TOTAL_PERSISTENCE_KEY,
                seconds,
            ),
            tickIntervalMs: options.tickIntervalMs,
        }),
        // Deliberately built once: see the note above about rebuilding.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [],
    );

    // Read the stored total once. A value that arrives after play started is merged rather than
    // assigned (see `seedTotal`), so a slow read cannot roll the counter back.
    useEffect(() => {
        let cancelled = false;
        void latest.current.persistenceGetAsync(BLUEPRINT_PLAYTIME_TOTAL_PERSISTENCE_KEY)
            .then(stored => {
                if (cancelled || typeof stored !== "number") {
                    return;
                }
                clock.seedTotal(stored);
            })
            // An unreadable store means the total starts from zero for this session, which is worth
            // strictly less than refusing to count at all.
            .catch(() => undefined);
        return () => {
            cancelled = true;
        };
    }, [clock]);

    const intervalMs = options.tickIntervalMs ?? PLAYTIME_TICK_INTERVAL_MS;
    useEffect(() => {
        const timer = setInterval(() => clock.tick(), intervalMs);
        return () => clearInterval(timer);
    }, [clock, intervalMs]);

    // Told rather than inferred: a hidden window's timer is throttled and may not tick at all, so
    // waiting for the next tick to notice would let the whole hidden stretch arrive as one delta.
    useEffect(() => {
        if (typeof document === "undefined") {
            return;
        }
        const onVisibilityChange = () => {
            if (documentHidden()) {
                clock.pause();
            }
        };
        document.addEventListener("visibilitychange", onVisibilityChange);
        return () => document.removeEventListener("visibilitychange", onVisibilityChange);
    }, [clock]);

    // The last chance to write on a real quit: `beforeunload` fires for a closing Electron window
    // and for the web export's tab. The write itself is synchronous into the store bridge, which is
    // what makes it usable from here at all.
    useEffect(() => {
        if (typeof window === "undefined") {
            return;
        }
        const onBeforeUnload = () => clock.flush();
        window.addEventListener("beforeunload", onBeforeUnload);
        return () => window.removeEventListener("beforeunload", onBeforeUnload);
    }, [clock]);

    useEffect(() => () => clock.dispose(), [clock]);

    const getRunSeconds = useCallback(() => clock.getRunSeconds(), [clock]);
    const getTotalSeconds = useCallback(() => clock.getTotalSeconds(), [clock]);
    const seedRun = useCallback((seconds: number) => clock.seedRun(seconds), [clock]);
    const flush = useCallback(() => clock.flush(), [clock]);

    return useMemo(
        () => ({ getRunSeconds, getTotalSeconds, seedRun, flush }),
        [flush, getRunSeconds, getTotalSeconds, seedRun],
    );
}
