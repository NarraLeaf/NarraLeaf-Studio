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
 *
 * That box reports {@link SurfacePuppetLease.drawn} - the count read off this queue - and not the
 * budget constant. The two agree in a correct system, which is why the constant looked like a fine
 * substitute right up until the accounting was wrong, and then the box told an author that eight
 * models were drawn while one was.
 */

import { useEffect, useId, useSyncExternalStore } from "react";

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
 *
 * ## The entries are *renderer instances*, not elements
 *
 * This is the correction to a real defect, not a nuance. Keyed by element id, one element drawn by two
 * renderer instances at once - the canvas and a Surface panel preview, which is routine - produced one
 * shared claim, and then the first instance to unmount released the lease the *other* one was still
 * using. Since a claim is made once from an effect keyed on `[key, wanted]`, and neither changed, the
 * survivor never re-claimed: it sat at "not drawn" for the life of the window, holding no context,
 * mounting no backend, with nothing logged. A fully configured model simply never appeared.
 *
 * Per-instance ids fix it in the direction that is also *correct accounting*: two instances of one
 * element mount two backends and therefore hold two WebGL contexts, which the element-keyed version
 * undercounted by exactly the amount that made it look safe. And no instance can name another's id,
 * so nobody can revoke a lease they do not hold.
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
 * Register one renderer instance's interest in a context.
 *
 * Idempotent — a re-render must not push a widget to the back of the queue, which would make the set of
 * drawn models flicker on every keystroke. `holderId` identifies the *instance* (see above): it comes
 * from `useId()`, so no two live claimants can collide and no claimant can be named by another.
 */
export function claimSurfacePuppetContext(holderId: string): void {
    if (claims.includes(holderId)) {
        return;
    }
    claims.push(holderId);
    emit();
}

export function releaseSurfacePuppetContext(holderId: string): void {
    const at = claims.indexOf(holderId);
    if (at < 0) {
        return;
    }
    claims.splice(at, 1);
    emit();
}

export function isSurfacePuppetContextGranted(holderId: string): boolean {
    const at = claims.indexOf(holderId);
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

/** Test seam. A module-level queue would otherwise leak one test's holders into the next. */
export function __resetSurfacePuppetContextBudget(): void {
    claims.length = 0;
}

export interface SurfacePuppetLease {
    /** Whether this instance may mount a backend. */
    granted: boolean;
    /**
     * How many models are drawn in this window *right now*.
     *
     * Read from the queue rather than assumed to be the budget. The two are equal in a correct system -
     * a denial can only happen once the queue is full - which is exactly why the constant made a fine
     * substitute right up until the accounting was wrong, and then the box confidently told the author
     * that eight models were drawn while one was. A number that comes from the store cannot do that.
     */
    drawn: number;
}

/**
 * Hold a lease for as long as `wanted` stays true, and report whether one was granted.
 *
 * The claim is keyed on this component instance, not on anything about the element it is drawing: see
 * the note on {@link claims}. Nothing is passed in, so no caller can hand over an identity that another
 * instance also uses.
 *
 * The claim is made from an effect rather than during render, because a render that mutated the queue
 * would decide the answer for every *other* widget as a side effect of drawing this one, and React is
 * free to throw a render away. So the first render after `wanted` turns true reads `false` and the
 * effect's notification brings the second one - one extra render, in exchange for a queue that is never
 * written from a render pass.
 */
export function useSurfacePuppetContextLease(wanted: boolean): SurfacePuppetLease {
    const holderId = useId();
    // Two subscriptions rather than one returning an object: `getSnapshot` must return a value that
    // compares equal across calls, and a fresh object every time is an infinite render loop.
    const granted = useSyncExternalStore(
        subscribeSurfacePuppetContexts,
        () => wanted && isSurfacePuppetContextGranted(holderId),
        () => false,
    );
    const drawn = useSyncExternalStore(
        subscribeSurfacePuppetContexts,
        surfacePuppetContextsGranted,
        () => 0,
    );

    useEffect(() => {
        if (!wanted) {
            return;
        }
        claimSurfacePuppetContext(holderId);
        // Releasing on the way out is what makes the budget breathe: a widget scrolled off the canvas
        // or emptied by the author hands its context to whoever was waiting. Only ever its own.
        return () => { releaseSurfacePuppetContext(holderId); };
    }, [holderId, wanted]);

    return { granted, drawn };
}

/** The queue, in order, including the denied tail. Test seam for the promotion behaviour. */
export function surfacePuppetContextClaims(): readonly string[] {
    return [...claims];
}
