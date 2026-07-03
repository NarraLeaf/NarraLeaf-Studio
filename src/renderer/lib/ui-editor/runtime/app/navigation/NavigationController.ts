import type { UISurface } from "@shared/types/ui-editor/document";
import { SURFACE_PREPAINT_TIMEOUT_MS } from "@/lib/ui-editor/runtime/surface/SurfaceAnimationLayer";
import {
    initialNavigationState,
    reduceNavigation,
    type NavigationEvent,
    type NavigationState,
    type NavigationTransitionRequest,
} from "./navigationMachine";
import type { AppNavEntry } from "../types";

export type NavigationOpenInput = {
    fromSurface: UISurface | null;
    targetSurface: UISurface;
    currentHiddenForGame: boolean;
    reducedMotion: boolean | null;
    createNextEntry: (waitForExit: boolean) => AppNavEntry;
};

export type NavigationCloseInput = {
    fromSurface: UISurface | null;
    targetSurface: UISurface | null;
    targetHiddenForGame: boolean;
    reducedMotion: boolean | null;
};

/**
 * External store around the pure navigation machine. Owns the impure edge:
 * transition-settlement promises for open()/close() with the same timeout
 * fallback the orchestrators used (duration + prepaint timeout + 180ms),
 * settled by animation-completion signals from the surface layers.
 *
 * Being an external store (not React state) lets the blueprint host API
 * bridge read navigation state synchronously outside React, which used to
 * require five mirrored refs.
 */
export class NavigationController {
    private state: NavigationState = initialNavigationState;
    private readonly listeners = new Set<() => void>();
    private wait: {
        resolve: (() => void) | null;
        timeoutId: ReturnType<typeof setTimeout> | null;
        enterDone: boolean;
        exitDone: boolean;
    } = { resolve: null, timeoutId: null, enterDone: true, exitDone: true };

    public getState = (): NavigationState => {
        return this.state;
    };

    public subscribe = (listener: () => void): (() => void) => {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    };

    private dispatch(event: NavigationEvent) {
        const reduction = reduceNavigation(this.state, event);
        if (reduction.state !== this.state) {
            this.state = reduction.state;
            this.listeners.forEach(listener => listener());
        }
        return reduction;
    }

    private completeTransitionWait = (): void => {
        const pending = this.wait;
        if (pending.timeoutId) {
            clearTimeout(pending.timeoutId);
        }
        const resolve = pending.resolve;
        this.wait = { resolve: null, timeoutId: null, enterDone: true, exitDone: true };
        resolve?.();
    };

    private tryCompleteTransitionWait(): void {
        const pending = this.wait;
        if (pending.resolve && pending.enterDone && pending.exitDone) {
            this.completeTransitionWait();
        }
    }

    private beginTransitionWait(transition: NavigationTransitionRequest): Promise<void> {
        this.completeTransitionWait();
        if (!transition.waitForEnter && !transition.waitForExit) {
            return Promise.resolve();
        }
        return new Promise(resolve => {
            const timeoutId = setTimeout(() => {
                this.completeTransitionWait();
            }, Math.max(0, transition.durationMs) + SURFACE_PREPAINT_TIMEOUT_MS + 180);
            this.wait = {
                resolve,
                timeoutId,
                enterDone: !transition.waitForEnter,
                exitDone: !transition.waitForExit,
            };
        });
    }

    /** Reset to a fresh session stack. Does not settle an in-flight wait (its timeout still will). */
    public reset(initialEntry: AppNavEntry | null): void {
        this.dispatch({ type: "RESET", initialEntry });
    }

    /** Push a surface; resolves when the transition settles (or its timeout fires). */
    public open(input: NavigationOpenInput): Promise<void> {
        const reduction = this.dispatch({ type: "OPEN", ...input });
        return reduction.transition ? this.beginTransitionWait(reduction.transition) : Promise.resolve();
    }

    /** Pop the top layer; resolves immediately when there is nothing to close. */
    public close(input: NavigationCloseInput): Promise<void> {
        const reduction = this.dispatch({ type: "CLOSE", ...input });
        return reduction.transition ? this.beginTransitionWait(reduction.transition) : Promise.resolve();
    }

    /** Enter animation of the active entry finished (from the surface layer). */
    public markEnterComplete(entryKey: string): void {
        const activeKey = this.state.navStack[this.state.navStack.length - 1]?.key ?? null;
        if (entryKey !== activeKey) {
            return;
        }
        this.wait.enterDone = true;
        this.dispatch({ type: "ENTER_COMPLETE", entryKey });
        this.tryCompleteTransitionWait();
    }

    /** AnimatePresence finished exiting all layers (wait mode). */
    public markAllExited(): void {
        this.wait.exitDone = true;
        this.tryCompleteTransitionWait();
        this.dispatch({ type: "ALL_EXITED" });
    }

    /** A surface layer finished its hidden prepaint pass. */
    public markPrepaintReady(entryKey: string): void {
        this.dispatch({ type: "PREPAINT_READY", entryKey });
    }

    /** The game stage covered the page stack: hide all current entries and settle any wait. */
    public hideAllForGame(): void {
        this.dispatch({ type: "HIDE_ALL_FOR_GAME" });
        this.completeTransitionWait();
    }
}
