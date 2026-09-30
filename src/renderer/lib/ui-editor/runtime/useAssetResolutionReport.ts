/**
 * The widget half of asset failure reporting: one call beside each `useAssetObjectUrl` a widget
 * draws from, saying what became of it.
 *
 * The host half is whatever the game app puts in {@link AssetResolutionReporterContext} - the game
 * app provides its host's `reportAssetResolution` there, and nothing else does. The editor canvas
 * mounts no provider, so on the canvas this hook reads a null context and does nothing at all:
 * authoring already has its own account of a missing asset (the project check `assets/missing`, and
 * the notice under the image field in the inspector), and a canvas that also wrote to a list nobody
 * shows would only cost a render.
 *
 * See `assetResolution.ts` for what a report carries and why.
 */

import { createContext, useContext, useEffect, useRef } from "react";
import type { AssetResolutionOutcome, AssetResolutionReporter, AssetResolutionSite } from "./assetResolution";

/** Null outside a running game (the editor canvas, a thumbnail), which turns reporting off. */
export const AssetResolutionReporterContext = createContext<AssetResolutionReporter | null>(null);

/**
 * What a widget knows about one slot at one render.
 *
 * `answer` is the very object `useAssetObjectUrl` returned, not a copy of its fields: its identity
 * changing is how this hook learns a new answer has arrived (see the note on the effect below).
 */
export type AssetResolutionReading = {
    /** The value handed to `useAssetObjectUrl` - exactly that value, whatever shape it has. */
    requested: unknown;
    /** Whether the widget draws this slot right now. A slot it does not draw cannot fail. */
    wanted: boolean;
    answer: { url: string | null; loading: boolean; error: string | null };
    /**
     * A URL the element showing it reported it could not load, or null. Compared against the
     * current URL, so a failure of the previous picture does not stick to the next one.
     */
    loadFailedUrl?: string | null;
};

function requestedString(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
        return null;
    }
    return typeof value === "string" ? value : String(value);
}

/**
 * The outcome one reading amounts to, or null while there is no answer to report yet.
 *
 * Exported for the tests. "No answer yet" is its own case rather than a failure: the hook starts with
 * no URL and no error before its first lookup has run, and an IPC lookup spends a moment loading.
 */
export function readAssetResolutionOutcome(reading: AssetResolutionReading): AssetResolutionOutcome | null {
    const requested = requestedString(reading.requested);
    if (!reading.wanted || requested === null) {
        return { status: "unused" };
    }
    const { url, loading, error } = reading.answer;
    if (loading) {
        return null;
    }
    if (url) {
        return reading.loadFailedUrl && reading.loadFailedUrl === url
            ? { status: "failed", requested, stage: "load" }
            : { status: "drawn" };
    }
    if (error) {
        return { status: "failed", requested, stage: "resolve" };
    }
    return null;
}

function outcomeKey(outcome: AssetResolutionOutcome): string {
    return outcome.status === "failed"
        ? `failed\u0000${outcome.stage}\u0000${outcome.requested}`
        : outcome.status;
}

let drawingCounter = 0;

/**
 * Report what became of one asset slot, whenever that changes.
 *
 * Once per change, never per render: a widget re-renders on every hover and every animation frame
 * its appearance runs, and the host would otherwise be told the same thing hundreds of times.
 */
export function useAssetResolutionReport(site: AssetResolutionSite | null, reading: AssetResolutionReading): void {
    const reporter = useContext(AssetResolutionReporterContext);
    const drawingRef = useRef<string | null>(null);
    const reportedRef = useRef<string | null>(null);
    const seenRequestedRef = useRef<{ value: unknown } | null>(null);
    const siteKey = site
        ? `${site.surfaceId}\u0000${site.elementId ?? ""}\u0000${site.ownerName}\u0000${site.slot}\u0000${site.instanceKey}`
        : null;

    useEffect(() => {
        if (!reporter) {
            return;
        }
        return () => {
            if (drawingRef.current && reportedRef.current !== null) {
                reporter({ type: "released", drawing: drawingRef.current });
            }
            // A drawing that comes back (a StrictMode remount, a new host) says where it stands
            // again rather than assuming the host still remembers.
            reportedRef.current = null;
        };
    }, [reporter]);

    useEffect(() => {
        /**
         * The render in which `requested` changed carries the answer to the PREVIOUS request:
         * `useAssetObjectUrl` only starts on the new one in its own effect, after this render has
         * committed. Reading that answer as this request's would report a failure the new value
         * never had - rebinding a broken picture to a good one would flash an issue about the good
         * one. So that render is skipped. The next is guaranteed, because the lookup always sets a
         * fresh state object when it starts, and `answer` is a dependency.
         *
         * Tracked whether or not anyone is listening, so a reporter that arrives later does not
         * mistake a stale answer for a fresh one.
         */
        const seen = seenRequestedRef.current;
        seenRequestedRef.current = { value: reading.requested };
        if (!reporter || !site || !siteKey) {
            return;
        }
        if (!seen || !Object.is(seen.value, reading.requested)) {
            return;
        }
        const outcome = readAssetResolutionOutcome(reading);
        if (!outcome) {
            return;
        }
        const key = `${siteKey}\u0000${outcomeKey(outcome)}`;
        if (reportedRef.current === key) {
            return;
        }
        reportedRef.current = key;
        drawingRef.current ??= `asset-drawing-${++drawingCounter}`;
        reporter({ type: "outcome", drawing: drawingRef.current, site, outcome });
        // `site` is a dependency through `siteKey`, which spells out every field of it, and `reading`
        // through its four members: both arrive as fresh objects on every render.
    }, [reporter, siteKey, reading.requested, reading.answer, reading.wanted, reading.loadFailedUrl]);
}
