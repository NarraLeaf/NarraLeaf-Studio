/**
 * Pure navigation state machine for the shared game app.
 *
 * Replaces the flag/ref soup previously spread across the orchestrator
 * components (navStack/visibleEntries state, pendingWaitEntryRef,
 * pendingUnderlayReadyKeyRef, pendingRemoveAfterEnterKeyRef,
 * transitionDirectionRef). The reducer computes OPEN/CLOSE updates through
 * the existing pure helpers in surfaceNavigationController.ts and settles
 * them via animation-completion events; timers and promise settlement live
 * in NavigationController (the impure edge).
 */

import type { UISurface } from "@shared/types/ui-editor/document";
import type { PageAnimationNavigationDirection } from "@/lib/ui-editor/runtime/pageAnimation";
import {
    createSurfaceNavigationCloseUpdate,
    createSurfaceNavigationOpenUpdate,
    type SurfaceNavigationPresenceMode,
    type SurfaceNavigationUpdate,
} from "@/lib/ui-editor/runtime/game/surfaceNavigationController";
import type { AppNavEntry } from "../types";

export type NavigationState = {
    navStack: AppNavEntry[];
    visibleEntries: AppNavEntry[];
    direction: PageAnimationNavigationDirection;
    presenceMode: SurfaceNavigationPresenceMode;
    pendingWaitEntry: AppNavEntry | null;
    pendingUnderlayReadyKey: string | null;
    pendingRemoveAfterEnterKey: string | null;
};

export const initialNavigationState: NavigationState = {
    navStack: [],
    visibleEntries: [],
    direction: "forward",
    presenceMode: "sync",
    pendingWaitEntry: null,
    pendingUnderlayReadyKey: null,
    pendingRemoveAfterEnterKey: null,
};

export type NavigationEvent =
    | { type: "RESET"; initialEntry: AppNavEntry | null }
    | {
          type: "OPEN";
          fromSurface: UISurface | null;
          targetSurface: UISurface;
          currentHiddenForGame: boolean;
          reducedMotion: boolean | null;
          createNextEntry: (waitForExit: boolean) => AppNavEntry;
      }
    | {
          type: "CLOSE";
          fromSurface: UISurface | null;
          targetSurface: UISurface | null;
          targetHiddenForGame: boolean;
          reducedMotion: boolean | null;
      }
    | { type: "PREPAINT_READY"; entryKey: string }
    | { type: "ENTER_COMPLETE"; entryKey: string }
    | { type: "ALL_EXITED" }
    | { type: "HIDE_ALL_FOR_GAME" };

/** Wait parameters the controller uses to settle an open()/close() promise. */
export type NavigationTransitionRequest = {
    durationMs: number;
    waitForEnter: boolean;
    waitForExit: boolean;
};

export type NavigationReduction = {
    state: NavigationState;
    /** Present when the event started a transition the caller should await. */
    transition?: NavigationTransitionRequest;
};

function applyUpdate(state: NavigationState, update: SurfaceNavigationUpdate<AppNavEntry>): NavigationReduction {
    return {
        state: {
            ...state,
            navStack: update.navStack,
            visibleEntries: update.visibleEntries,
            direction: update.direction,
            presenceMode: update.surfacePresenceMode,
            pendingWaitEntry: update.pendingWaitEntry,
            pendingUnderlayReadyKey: update.pendingUnderlayReadyKey,
            pendingRemoveAfterEnterKey: update.pendingRemoveAfterEnterKey,
        },
        transition: {
            durationMs: update.transitionDurationMs,
            waitForEnter: update.transitionWaitOptions?.waitForEnter ?? true,
            waitForExit: update.transitionWaitOptions?.waitForExit ?? true,
        },
    };
}

export function reduceNavigation(state: NavigationState, event: NavigationEvent): NavigationReduction {
    switch (event.type) {
        case "RESET": {
            const entries = event.initialEntry ? [event.initialEntry] : [];
            return {
                state: {
                    ...initialNavigationState,
                    navStack: entries,
                    visibleEntries: entries,
                },
            };
        }
        case "OPEN": {
            const activeEntry = state.navStack[state.navStack.length - 1] ?? null;
            const update = createSurfaceNavigationOpenUpdate<AppNavEntry>({
                navStack: state.navStack,
                visibleEntries: state.visibleEntries,
                activeEntry,
                fromSurface: event.fromSurface,
                targetSurface: event.targetSurface,
                currentHiddenForGame: event.currentHiddenForGame,
                prefersReducedMotion: event.reducedMotion,
                createNextEntry: event.createNextEntry,
            });
            return applyUpdate(state, update);
        }
        case "CLOSE": {
            const update = createSurfaceNavigationCloseUpdate<AppNavEntry>({
                navStack: state.navStack,
                fromSurface: event.fromSurface,
                targetSurface: event.targetSurface,
                targetHiddenForGame: event.targetHiddenForGame,
                prefersReducedMotion: event.reducedMotion,
            });
            if (!update) {
                return { state };
            }
            return applyUpdate(state, update);
        }
        case "PREPAINT_READY": {
            if (state.pendingUnderlayReadyKey !== event.entryKey) {
                return { state };
            }
            return {
                state: {
                    ...state,
                    pendingUnderlayReadyKey: null,
                    visibleEntries: state.visibleEntries.filter(entry => entry.key === event.entryKey),
                },
            };
        }
        case "ENTER_COMPLETE": {
            const activeKey = state.navStack[state.navStack.length - 1]?.key ?? null;
            if (event.entryKey !== activeKey) {
                return { state };
            }
            if (state.pendingRemoveAfterEnterKey !== event.entryKey) {
                return { state };
            }
            return {
                state: {
                    ...state,
                    pendingRemoveAfterEnterKey: null,
                    visibleEntries: state.visibleEntries.filter(entry => entry.key === event.entryKey),
                },
            };
        }
        case "ALL_EXITED": {
            const pendingEntry = state.pendingWaitEntry;
            if (!pendingEntry) {
                return { state };
            }
            return {
                state: {
                    ...state,
                    pendingWaitEntry: null,
                    presenceMode: "sync",
                    visibleEntries: [pendingEntry],
                },
            };
        }
        case "HIDE_ALL_FOR_GAME": {
            const hiddenKeys = new Set(state.navStack.map(entry => entry.key));
            return {
                state: {
                    ...state,
                    visibleEntries: state.visibleEntries.filter(entry => !hiddenKeys.has(entry.key)),
                    pendingWaitEntry: null,
                    pendingUnderlayReadyKey: null,
                    pendingRemoveAfterEnterKey: null,
                    presenceMode: "sync",
                },
            };
        }
    }
}
