/**
 * How many Surface puppet widgets may hold a WebGL context at once.
 *
 * ## The ceiling is real, and it does not announce itself
 *
 * Measured in this Electron build (38.8.6 / Chromium 140, ANGLE over D3D11) rather than taken from
 * folklore: a probe created 40 WebGL contexts in one renderer process, drew in each, and then counted
 * the survivors after the eviction events landed. **All 40 `getContext()` calls succeeded. Exactly 16
 * contexts were still alive; the 24 oldest had been lost.** The window slides — the survivors were the
 * 16 most recently created.
 *
 * Two consequences shape everything below:
 *
 * 1. **There is no error to catch.** Chromium does not refuse the 17th context, it silently kills the
 *    oldest and fires `webglcontextlost` on it. So "did we exceed the budget" cannot be discovered
 *    from the failure - it has to be *counted* before the mount, which is what this module does.
 * 2. **Overshooting is worse than declining.** Past the ceiling the canvas does not lose the newest
 *    model, it loses the ones the author looked at first. A wall of models that go blank in the order
 *    they were opened reads as a corrupt project, not as a limit.
 *
 * ## Why 8 rather than 16
 *
 * Nothing else in Studio or in the engine takes a WebGL context (checked: no `getContext("webgl")`
 * anywhere in `src`, none in the engine's dist), so the whole ceiling belongs to author-supplied
 * puppet runtimes. But widgets are not the only ones asking:
 *
 * - `PuppetDescriptionService.probe()` mounts a model offscreen to fill the inspector's dropdowns,
 *   and the inspector's own `PuppetPreview` keeps a second one up while the author works;
 * - a Dev Mode window draws stage puppets in the same process as the Surface;
 * - and one *model* is not guaranteed to be one context: a backend is free to keep an offscreen one
 *   for masking or for a Cubism core.
 *
 * Half the measured ceiling leaves room for all of that and still shows more models at once than any
 * plausible menu screen wants. It is a deliberate under-commitment, not a measurement.
 *
 * ## What happens at the limit is visible
 *
 * A widget that does not get a lease is drawn as an explanatory box saying so (see the widget's
 * `renderer.tsx`), and a Surface authored past the limit raises a `resourceDiagnostics` warning.
 * Truncating silently would be the worst of the three options: it looks exactly like success.
 */

import { useEffect, useSyncExternalStore } from "react";

export const SURFACE_PUPPET_CONTEXT_BUDGET = 8;

/**
 * Claims in the order they were made. The first {@link SURFACE_PUPPET_CONTEXT_BUDGET} hold a lease.
 *
 * An array rather than a set with a counter, because the order *is* the policy: first come, first
 * served, and releasing an early claim promotes the earliest waiter with no bookkeeping. Mount order
 * on a Surface is document order, so which widgets draw is stable across reloads rather than a race.
 *
 * First-come rather than most-recent (which is what Chromium itself does) for the reason above: the
 * author is looking at the models that arrived first.
 */
const claims: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of [...listeners]) {
        try {
            listener();
        } catch {
            // A subscriber's own failure is not this registry's to propagate.
        }
    }
}

/**
 * Register interest in a context. Idempotent — a re-render must not push a widget to the back of the
 * queue, which would make the set of drawn models flicker on every keystroke.
 */
export function claimSurfacePuppetContext(key: string): void {
    if (claims.includes(key)) {
        return;
    }
    claims.push(key);
    emit();
}

export function releaseSurfacePuppetContext(key: string): void {
    const at = claims.indexOf(key);
    if (at < 0) {
        return;
    }
    claims.splice(at, 1);
    emit();
}

export function isSurfacePuppetContextGranted(key: string): boolean {
    const at = claims.indexOf(key);
    return at >= 0 && at < SURFACE_PUPPET_CONTEXT_BUDGET;
}

/** How many widgets asked and were turned down. For the "not drawn" box's own wording. */
export function surfacePuppetContextsDenied(): number {
    return Math.max(0, claims.length - SURFACE_PUPPET_CONTEXT_BUDGET);
}

/** How many leases are out. Exported for tests and for anything that wants to report the load. */
export function surfacePuppetContextsGranted(): number {
    return Math.min(claims.length, SURFACE_PUPPET_CONTEXT_BUDGET);
}

export function subscribeSurfacePuppetContexts(listener: () => void): () => void {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
}

/** Test seam. A module-level queue would otherwise leak one test's widgets into the next. */
export function __resetSurfacePuppetContextBudget(): void {
    claims.length = 0;
}

/**
 * Hold a lease for as long as `wanted` stays true, and report whether one was granted.
 *
 * The claim is made from an effect rather than during render: a render that mutated the queue would
 * decide the answer for every *other* widget as a side effect of drawing this one, and React is free
 * to throw a render away. So the first render after `wanted` turns true reads `false` and the effect's
 * notification brings the second one - one extra render, in exchange for a queue that is never
 * written from a render pass.
 */
export function useSurfacePuppetContextLease(key: string, wanted: boolean): boolean {
    const granted = useSyncExternalStore(
        subscribeSurfacePuppetContexts,
        () => wanted && isSurfacePuppetContextGranted(key),
        () => false,
    );

    useEffect(() => {
        if (!wanted) {
            return;
        }
        claimSurfacePuppetContext(key);
        // Releasing on the way out is what makes the budget breathe: a widget scrolled off the canvas
        // or emptied by the author hands its context to whoever was waiting.
        return () => { releaseSurfacePuppetContext(key); };
    }, [key, wanted]);

    return granted;
}

/** The queue, in order, including the denied tail. Test seam for the promotion behaviour. */
export function surfacePuppetContextClaims(): readonly string[] {
    return [...claims];
}
