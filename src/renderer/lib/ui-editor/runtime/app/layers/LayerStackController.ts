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
    /** Mutual-exclusion group. Stored only; nothing reads it yet. */
    group: string | null;
    /** The runtime scope that mounted this layer. Stored only; nothing reads it yet. */
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
    private readonly listeners = new Set<() => void>();
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

    /** Push a layer on top. Returns its key, which is the handle every other call takes. */
    public show(request: SurfaceLayerMountRequest): string {
        this.seq += 1;
        // Prefixed so a layer key can never collide with a page entry's `${surfaceId}:${seq}`, which
        // matters because both kinds of key index the same prepaint / interaction-ready sets and the
        // same blueprint scope table.
        const key = `layer:${request.surfaceId}:${this.seq}`;
        const modal = request.modal === true;
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
            group: request.group ?? null,
            ownerScopeId: request.ownerScopeId ?? "",
        };
        this.emit([...this.layers, entry]);
        return key;
    }

    /** Remove one layer by handle. False when it is already gone. */
    public hide(key: string): boolean {
        if (!this.layers.some(layer => layer.key === key)) {
            return false;
        }
        this.emit(this.layers.filter(layer => layer.key !== key));
        return true;
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
        this.emit(this.layers.slice(0, -1));
        return true;
    }

    /** Drop every layer. Layers are not serialised, so a load lands with an empty stack. */
    public clear(): void {
        if (this.layers.length === 0) {
            return;
        }
        this.emit([]);
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
