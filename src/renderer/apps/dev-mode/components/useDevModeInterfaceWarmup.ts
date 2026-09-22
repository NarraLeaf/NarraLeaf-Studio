import { useEffect, useRef, useState } from "react";
import type { DevModeBundle } from "@shared/types/devMode";
import type { UISurface } from "@shared/types/ui-editor/document";
import {
    publishedDevModeAssetIds,
    resolveDevModeAssetType,
    resolveDevModeAssetUrl,
} from "@/lib/ui-editor/runtime/devModeAssetUrls";
import { warmSurfaceAssets } from "@/lib/ui-editor/runtime/surfaceAssetWarmup";
import { createGameBootReporter } from "@/lib/ui-editor/runtime/app/bootTiming";
import { warmDevModeFont } from "@/lib/workspace/hooks/useEditorFontFamily";

/**
 * This pass on the page's performance timeline, as the boot's `preload` phase - the same phase the
 * packaged shell writes for its own first-screen pass, because it is the same work.
 *
 * Its own reporter, and one with no listener: the loading state here counts from this hook's own
 * state, and a second reporter is what keeps this span from being closed by the game app's, which
 * times the story's warm-up under the same name.
 */
const interfaceWarmupTimeline = createGameBootReporter();

export type DevModeInterfaceWarmup = {
    /** The screen the window opens on is warm, or never will be (it timed out, or had nothing). */
    ready: boolean;
    /** How far the pass has got, for the loading state to count. */
    loaded: number;
    total: number;
};

/**
 * Warm the screen a Dev Mode window opens on, so that when it lights up it is ready.
 *
 * The screen it opens on and nothing else. A packaged game warms its whole interface before it shows
 * any of it; Dev Mode is the window an author stops and starts all day, so it pays for what is on
 * screen when it lights up - pictures and fonts that pop in a frame after the reveal are what this
 * exists to stop - and leaves the rest to arrive when it is opened. The walk is the packaged game's
 * own (`surfaceAssetWarmup`), so the set it waits on is the set a player's first screen waits on.
 *
 * Once per session. A hot reload keeps the play head and the screen the author is looking at, and a
 * loading state put back over that would be a reload that looks like a restart.
 *
 * Nothing here blocks on a failure: an asset that cannot be had is counted and passed, and the whole
 * pass gives up at the shared timeout. A window that never lights up is worse than one that shows a
 * missing picture - the missing picture is at least something the Issues panel can point at.
 */
export function useDevModeInterfaceWarmup(input: {
    bundle: DevModeBundle | null;
    surface: UISurface | null;
    /**
     * Whether this launch opens on its interface at all. A launch into a story row covers the
     * interface with the stage from the first frame, so warming it would be a wait for nothing.
     */
    enabled: boolean;
    /** Resolve the library and publish its URLs to the window. Shared with the story compile. */
    prewarmAssetUrls: () => Promise<void>;
    log: (level: "info" | "warning", message: string) => void;
}): DevModeInterfaceWarmup {
    const { bundle, surface, enabled, prewarmAssetUrls, log } = input;
    const [state, setState] = useState<DevModeInterfaceWarmup & { key: string | null }>({
        key: null,
        ready: false,
        loaded: 0,
        total: 0,
    });
    /** The session this window has already warmed for; see "once per session" above. */
    const warmedKeyRef = useRef<string | null>(null);
    // Read at call time rather than listed as dependencies: both are rebuilt by renders that change
    // nothing this pass cares about, and a pass restarted by one of those would count to the end twice.
    const prewarmRef = useRef(prewarmAssetUrls);
    prewarmRef.current = prewarmAssetUrls;
    const logRef = useRef(log);
    logRef.current = log;

    const bundleId = bundle?.bundleId ?? null;
    const surfaceId = surface?.id ?? null;
    const key = bundleId && surfaceId ? `${bundleId}:${surfaceId}` : null;

    useEffect(() => {
        if (!key || !bundle || !surfaceId) {
            return;
        }
        if (warmedKeyRef.current === key || !enabled) {
            warmedKeyRef.current = key;
            setState({ key, ready: true, loaded: 0, total: 0 });
            return;
        }
        let cancelled = false;
        setState({ key, ready: false, loaded: 0, total: 0 });
        const startedAt = performance.now();
        interfaceWarmupTimeline.begin("preload");
        void (async () => {
            try {
                await prewarmRef.current();
                const publishedIds = publishedDevModeAssetIds();
                const result = await warmSurfaceAssets({
                    source: {
                        uidoc: bundle.ui.uidoc,
                        fontAssetIds: (bundle.fonts ?? []).map(entry => entry.assetId),
                        // What the library has, standing in for a pack's manifest. An id the window
                        // could not resolve is one no widget will draw from this map either, and
                        // waiting on it would only be waiting for its failure.
                        manifestIds: publishedIds.size > 0 ? publishedIds : null,
                    },
                    surfaceId,
                    assetUrl: assetId => resolveDevModeAssetUrl(assetId) ?? "",
                    entryFor: assetId => {
                        const type = resolveDevModeAssetType(assetId);
                        return type ? { type } : undefined;
                    },
                    loadFont: assetId => warmDevModeFont(assetId),
                    onProgress: (settled, total) => {
                        if (!cancelled) {
                            setState({ key, ready: false, loaded: settled, total });
                        }
                    },
                });
                if (cancelled) {
                    return;
                }
                const ms = Math.round(performance.now() - startedAt);
                if (result.timedOut) {
                    logRef.current(
                        "warning",
                        `[DevMode] interface warm-up gave up after ${ms}ms: ${result.loaded}/${result.assetIds.length} ready`,
                    );
                } else if (result.failed.length > 0) {
                    logRef.current(
                        "warning",
                        `[DevMode] interface warmed in ${ms}ms; ${result.failed.length} of ${result.assetIds.length} could not be loaded`,
                    );
                } else {
                    logRef.current("info", `[DevMode] interface warmed in ${ms}ms: ${result.assetIds.length} asset(s)`);
                }
            } catch (error) {
                if (!cancelled) {
                    logRef.current(
                        "warning",
                        `[DevMode] interface warm-up failed: ${error instanceof Error ? error.message : String(error)}`,
                    );
                }
            } finally {
                interfaceWarmupTimeline.end("preload");
                if (!cancelled) {
                    warmedKeyRef.current = key;
                    setState(previous => ({ ...previous, key, ready: true }));
                }
            }
        })();
        return () => {
            cancelled = true;
        };
        // `bundle` is read for this session only; a hot reload's new bundle must not restart the pass.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [key, enabled]);

    return state.key === key
        ? { ready: state.ready, loaded: state.loaded, total: state.total }
        : { ready: false, loaded: 0, total: 0 };
}

