import type {
    SurfaceNavigationEntry,
    SurfaceNavigationPresentation,
} from "@/lib/ui-editor/runtime/game/surfaceNavigationController";
import { clonePageProps } from "../pageProps";
import type { PageProps } from "../types";

/**
 * One surface stacked over the page lane.
 *
 * There are no named layers: the array index IS the z order, and an author never sees a number or a
 * name. `key` is minted at mount, never reused, and doubles as the layer's `runtimeScopeId` - the
 * same rule the page lane follows, so a layer gets its own blueprint scope and its own lifecycle
 * boundary for free.
 *
 * Carries the navigation-entry fields verbatim so the entry the surface layer renders IS this object
 * rather than a shape rebuilt for it: a rebuilt one would take a new identity on every render, and
 * the surface layer memoises its whole blueprint host bundle on entry identity.
 */
export type SurfaceLayerEntry = SurfaceNavigationEntry<PageProps, SurfaceNavigationPresentation> & {
    runtimeScopeId: string;
    /** Everything below goes inert, and this is the keyboard owner. */
    modal: boolean;
    /** Paint a dimming sheet behind this layer's own background. */
    scrim: boolean;
    /** Whether Go back closes it. */
    dismissible: boolean;
    /** Mutual-exclusion group: at most one layer of a group is on screen, the rest queue. */
    group: string | null;
    /** The runtime scope that mounted this layer. When that scope closes, so does this layer. */
    ownerScopeId: string;
};

export type SurfaceLayerMountRequest = {
    surfaceId: string;
    props?: PageProps;
    modal?: boolean;
    /** Defaults to `modal`: a dimmed backing is what a modal looks like, and it can be turned off. */
    scrim?: boolean;
    dismissible?: boolean;
    group?: string | null;
    ownerScopeId?: string;
    presentation?: SurfaceNavigationPresentation;
};

/**
 * The layer stack, as an external store beside the page lane's own controller.
 *
 * Deliberately NOT folded into the navigation machine. The page lane's transition rules - hold the
 * outgoing page, wait for its exit, collapse to one entry - are about replacing one screen with
 * another, and a layer replaces nothing. Keeping the two stores side by side is what makes "no layers
 * mounted means nothing about paging changed" true by construction rather than by test coverage.
 */
export class LayerStackController {
    private layers: readonly SurfaceLayerEntry[] = [];
    /**
     * Layers whose group is occupied, in arrival order. They mount when {@link notifyExitComplete}
     * reports the layer holding their group has finished leaving.
     *
     * A queued layer already has its handle: `show` mints the key before deciding whether the layer
     * can go on screen yet, so the caller can hand that handle to `Wait For Layer` without having to
     * know whether it queued. That is also why "is this handle still live" below counts a queued
     * layer as live - it has not closed, it has not started.
     */
    private queued: SurfaceLayerEntry[] = [];
    private readonly listeners = new Set<() => void>();
    /** Per layer key: everyone waiting for that layer to close, and for the value it closes with. */
    private readonly closeWaiters = new Map<string, Set<(result: unknown) => void>>();
    /** Everyone waiting for the exit animations now running to finish. */
    private readonly exitWaiters = new Set<() => void>();
    /** True between removing a mounted layer and the presence group reporting its exit done. */
    private exitPending = false;
    private seq = 0;

    public getState = (): readonly SurfaceLayerEntry[] => {
        return this.layers;
    };

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private emit(next: readonly SurfaceLayerEntry[]): void {
        this.layers = next;
        this.listeners.forEach(listener => listener());
    }

    /** Push a layer on top, or queue it when its group is taken. Returns the handle either way. */
    public show(request: SurfaceLayerMountRequest): string {
        this.seq += 1;
        // Prefixed so a layer key can never collide with a page entry's `${surfaceId}:${seq}`, which
        // matters because both kinds of key index the same prepaint / interaction-ready sets and the
        // same blueprint scope table.
        const key = `layer:${request.surfaceId}:${this.seq}`;
        const modal = request.modal === true;
        const group = typeof request.group === "string" && request.group.trim() ? request.group.trim() : null;
        const entry: SurfaceLayerEntry = {
            key,
            runtimeScopeId: key,
            surfaceId: request.surfaceId,
            // A layer arrives; it never goes "back" to somewhere. The page-animation settings on the
            // surface resolve against this exactly as they do for a page being opened.
            direction: "forward",
            waitForExit: false,
            props: clonePageProps(request.props),
            presentation: request.presentation ?? "appPage",
            modal,
            scrim: request.scrim ?? modal,
            dismissible: request.dismissible ?? true,
            group,
            ownerScopeId: request.ownerScopeId ?? "",
        };
        if (group && this.isGroupTaken(group)) {
            this.queued.push(entry);
            return key;
        }
        this.emit([...this.layers, entry]);
        return key;
    }

    /** Remove one layer by handle. False when it is already gone. */
    public hide(key: string): boolean {
        return this.remove(layer => layer.key === key, null);
    }

    /**
     * Remove one layer and settle the value it closes with, for whoever is waiting on that handle.
     *
     * This is what `Close This Layer` reaches: the waiter is resolved on this call rather than when
     * the exit animation ends, so the graph that opened the layer runs on the beat the layer was
     * answered. The queue is the other half and settles later - see {@link notifyExitComplete}.
     */
    public closeWithResult(key: string, result: unknown): boolean {
        return this.remove(layer => layer.key === key, result);
    }

    /** Drop every layer of a group, on screen or still queued behind it. */
    public hideGroup(group: string): boolean {
        const name = group.trim();
        if (!name) {
            return false;
        }
        return this.remove(layer => layer.group === name, null);
    }

    /**
     * Drop every layer that the given runtime scope put on screen.
     *
     * The rule that makes a forgotten layer impossible: a layer belongs to whatever showed it, and a
     * page leaving the screen (or a layer closing) takes its own with it. Cascades on its own - the
     * layers removed here unmount, which closes THEIR scopes, which brings this round again.
     */
    public hideOwnedBy(ownerScopeId: string): boolean {
        if (!ownerScopeId) {
            return false;
        }
        return this.remove(layer => layer.ownerScopeId === ownerScopeId, null);
    }

    /**
     * Close the top layer if Go back is allowed to close it.
     *
     * Only the top one is consulted. A stack whose top layer refuses dismissal reports false and Go
     * back does what it does with no layers at all.
     */
    public dismissTop(): boolean {
        const top = this.layers[this.layers.length - 1];
        if (!top || !top.dismissible) {
            return false;
        }
        return this.remove(layer => layer.key === top.key, null);
    }

    /** Drop every layer. Layers are not serialised, so a load lands with an empty stack. */
    public clear(): void {
        const closed = [...this.layers, ...this.queued];
        this.queued = [];
        if (this.layers.length > 0) {
            this.emit([]);
        }
        for (const layer of closed) {
            this.settleClose(layer.key, null);
        }
        // Nothing is left to animate out, so anything waiting on an exit is waiting on a frame that
        // will never come. A load clearing the stack must not strand a graph mid-`Hide Layer`.
        this.exitPending = false;
        this.settleExit();
    }

    /** Whether this handle still names a live layer - on screen, or queued behind its group. */
    public isPresent(key: string): boolean {
        return this.layers.some(layer => layer.key === key) || this.queued.some(layer => layer.key === key);
    }

    /**
     * Resolve when this layer closes, with the value it closed with.
     *
     * A handle that names nothing resolves to null straight away rather than hanging: by the time an
     * author wires `Show Layer -> Wait For Layer` the layer may already have answered, and a wait
     * that never returns would strand the graph on a race.
     */
    public waitForClose(key: string): Promise<unknown> {
        if (!this.isPresent(key)) {
            return Promise.resolve(null);
        }
        return new Promise(resolve => {
            let waiters = this.closeWaiters.get(key);
            if (!waiters) {
                waiters = new Set();
                this.closeWaiters.set(key, waiters);
            }
            waiters.add(resolve);
        });
    }

    /** Resolve once the exit animations started by the last removal have finished. */
    public waitForExitComplete(): Promise<void> {
        if (!this.exitPending) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            this.exitWaiters.add(resolve);
        });
    }

    /** {@link hide}, settling when the layer has finished animating out. */
    public async hideAndWaitForExit(key: string): Promise<boolean> {
        const removed = this.hide(key);
        await this.waitForExitComplete();
        return removed;
    }

    /** {@link hideGroup}, settling when the group has finished animating out. */
    public async hideGroupAndWaitForExit(group: string): Promise<boolean> {
        const removed = this.hideGroup(group);
        await this.waitForExitComplete();
        return removed;
    }

    /**
     * The presence group reports every layer that was leaving has left.
     *
     * The one dequeue trigger. Taken from the animation rather than from a timer because the
     * question a queue asks - "has the screen given that space back yet" - is answered by the
     * animation and by nothing else; a duration guessed here would be wrong for every page whose
     * exit an author retimes.
     */
    public notifyExitComplete(): void {
        this.exitPending = false;
        this.settleExit();
        this.promoteQueued();
    }

    private isGroupTaken(group: string): boolean {
        return this.layers.some(layer => layer.group === group) || this.queued.some(layer => layer.group === group);
    }

    private remove(match: (layer: SurfaceLayerEntry) => boolean, result: unknown): boolean {
        const removed = this.layers.filter(match);
        const dropped = this.queued.filter(match);
        if (removed.length === 0 && dropped.length === 0) {
            return false;
        }
        if (dropped.length > 0) {
            this.queued = this.queued.filter(layer => !match(layer));
        }
        if (removed.length > 0) {
            // Only a layer that was on screen has anything to animate out. One that never got past
            // the queue leaves no frame behind, and waiting on its exit would wait forever.
            this.exitPending = true;
            this.emit(this.layers.filter(layer => !match(layer)));
        }
        for (const layer of [...removed, ...dropped]) {
            this.settleClose(layer.key, result);
        }
        return true;
    }

    private settleClose(key: string, result: unknown): void {
        const waiters = this.closeWaiters.get(key);
        if (!waiters) {
            return;
        }
        this.closeWaiters.delete(key);
        waiters.forEach(resolve => resolve(result));
    }

    private settleExit(): void {
        if (this.exitWaiters.size === 0) {
            return;
        }
        const waiters = [...this.exitWaiters];
        this.exitWaiters.clear();
        waiters.forEach(resolve => resolve());
    }

    private promoteQueued(): void {
        if (this.queued.length === 0) {
            return;
        }
        const taken = new Set(
            this.layers.map(layer => layer.group).filter((group): group is string => Boolean(group)),
        );
        const promoted: SurfaceLayerEntry[] = [];
        const stillQueued: SurfaceLayerEntry[] = [];
        for (const entry of this.queued) {
            if (entry.group && taken.has(entry.group)) {
                stillQueued.push(entry);
                continue;
            }
            if (entry.group) {
                taken.add(entry.group);
            }
            promoted.push(entry);
        }
        if (promoted.length === 0) {
            return;
        }
        this.queued = stillQueued;
        this.emit([...this.layers, ...promoted]);
    }
}

/**
 * Put a surface on the composite stack.
 *
 * The one entry point that mounts a layer. It takes the controller explicitly rather than reaching
 * for an ambient one, so a test can drive a stack without a React tree and the blueprint host API can
 * later route `Show Layer` through the very same call.
 */
export function mountSurfaceLayer(
    controller: LayerStackController,
    request: SurfaceLayerMountRequest,
): string {
    return controller.show(request);
}

/** Remove a layer previously returned by {@link mountSurfaceLayer}. */
export function unmountSurfaceLayer(controller: LayerStackController, key: string): boolean {
    return controller.hide(key);
}
