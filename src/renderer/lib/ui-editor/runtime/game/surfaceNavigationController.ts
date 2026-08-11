import type { UIElement, UIElementId, UISurface } from "@shared/types/ui-editor/document";
import type { PageAnimationNavigationDirection } from "@/lib/ui-editor/runtime/pageAnimation";
import { getSurfaceAnimationTimings } from "@/lib/ui-editor/runtime/surfaceAnimationPlan";
import { shouldHoldCurrentSurfaceUntilEnterComplete } from "@/lib/ui-editor/runtime/surface/surfaceTransitionPlan";

/**
 * The running bundle's element table, so a transition can count what the Pages' own contents cost.
 *
 * Optional: without it the numbers are the Surfaces' own, which is what they always were.
 */
export type SurfaceNavigationElements = Record<UIElementId, UIElement> | null | undefined;

export type SurfaceNavigationPresentation = "appPage" | "gameOverlay";
export type SurfaceNavigationPresenceMode = "sync" | "wait";

export type SurfaceNavigationEntry<
    Props = Record<string, unknown>,
    Presentation extends string = SurfaceNavigationPresentation,
> = {
    key: string;
    surfaceId: string;
    direction: PageAnimationNavigationDirection;
    waitForExit: boolean;
    props: Props;
    presentation: Presentation;
    exitBehind?: boolean;
};

export type SurfaceNavigationWaitOptions = {
    waitForEnter?: boolean;
    waitForExit?: boolean;
};

export type SurfaceNavigationUpdate<Entry extends SurfaceNavigationEntry> = {
    direction: PageAnimationNavigationDirection;
    navStack: Entry[];
    visibleEntries: Entry[];
    surfacePresenceMode: SurfaceNavigationPresenceMode;
    pendingWaitEntry: Entry | null;
    pendingUnderlayReadyKey: string | null;
    pendingRemoveAfterEnterKey: string | null;
    transitionDurationMs: number;
    transitionWaitOptions?: SurfaceNavigationWaitOptions;
};

export function createSurfaceNavigationOpenUpdate<Entry extends SurfaceNavigationEntry>(input: {
    navStack: readonly Entry[];
    visibleEntries: readonly Entry[];
    activeEntry: Entry | null;
    fromSurface: UISurface | null;
    targetSurface: UISurface | null;
    currentHiddenForGame: boolean;
    prefersReducedMotion?: boolean | null;
    elements?: SurfaceNavigationElements;
    createNextEntry: (waitForExit: boolean) => Entry;
}): SurfaceNavigationUpdate<Entry> {
    const reduced = input.prefersReducedMotion === true;
    const outgoing = getSurfaceAnimationTimings({
        elements: input.elements,
        surface: input.fromSurface,
        reducedMotion: reduced,
        cache: true,
    });
    const incoming = getSurfaceAnimationTimings({
        elements: input.elements,
        surface: input.targetSurface,
        reducedMotion: reduced,
        cache: true,
    });
    const waitForExit = input.currentHiddenForGame ? false : outgoing.exitBlocking;
    const nextEntry = input.createNextEntry(waitForExit);
    const exitDurationMs = input.currentHiddenForGame ? 0 : outgoing.exitMs;
    const enterDurationMs = incoming.enterMs;
    const holdCurrentUntilEnterComplete = shouldHoldCurrentSurfaceUntilEnterComplete({
        waitForExit,
        hasCurrentSurface: Boolean(input.activeEntry),
        exitDurationMs,
        enterDurationMs,
        outgoingHidden: input.currentHiddenForGame,
    });
    const transitionDurationMs = input.currentHiddenForGame
        ? enterDurationMs
        : waitForExit
            ? exitDurationMs + enterDurationMs
            : Math.max(exitDurationMs, enterDurationMs);
    const currentVisual = input.activeEntry ?? input.visibleEntries[input.visibleEntries.length - 1] ?? null;
    let visibleEntries: Entry[];
    if (waitForExit) {
        visibleEntries = [];
    } else if (input.currentHiddenForGame || !currentVisual || currentVisual.key === nextEntry.key) {
        visibleEntries = [nextEntry];
    } else if (holdCurrentUntilEnterComplete) {
        visibleEntries = [{ ...currentVisual, exitBehind: true } as Entry, nextEntry];
    } else {
        visibleEntries = [nextEntry, currentVisual];
    }

    return {
        direction: "forward",
        navStack: [...input.navStack, nextEntry],
        visibleEntries,
        surfacePresenceMode: waitForExit ? "wait" : "sync",
        pendingWaitEntry: waitForExit ? nextEntry : null,
        pendingUnderlayReadyKey:
            waitForExit || input.currentHiddenForGame || holdCurrentUntilEnterComplete ? null : nextEntry.key,
        pendingRemoveAfterEnterKey: holdCurrentUntilEnterComplete ? nextEntry.key : null,
        transitionDurationMs,
        transitionWaitOptions: {
            waitForEnter: true,
            waitForExit: !input.currentHiddenForGame && Boolean(input.activeEntry),
        },
    };
}

export function createSurfaceNavigationCloseUpdate<Entry extends SurfaceNavigationEntry>(input: {
    navStack: readonly Entry[];
    fromSurface: UISurface | null;
    targetSurface: UISurface | null;
    targetHiddenForGame: boolean;
    prefersReducedMotion?: boolean | null;
    elements?: SurfaceNavigationElements;
    /**
     * Index in `navStack` to land on. Defaults to the entry below the top - an ordinary Back. Naming
     * a lower one drops every layer above it in a single transition, which is what clearing the page
     * stack has to be: popping N times would animate N times and settle on N intermediate screens the
     * player never asked to see.
     */
    targetIndex?: number;
}): SurfaceNavigationUpdate<Entry> | null {
    if (input.navStack.length <= 1) {
        return null;
    }
    const targetIndex = Math.max(0, Math.min(input.targetIndex ?? input.navStack.length - 2, input.navStack.length - 2));
    const currentEntry = input.navStack[input.navStack.length - 1]!;
    const nextEntryBase = input.navStack[targetIndex]!;
    const reduced = input.prefersReducedMotion === true;
    const outgoing = getSurfaceAnimationTimings({
        elements: input.elements,
        surface: input.fromSurface,
        reducedMotion: reduced,
        cache: true,
    });
    const incoming = getSurfaceAnimationTimings({
        elements: input.elements,
        surface: input.targetSurface,
        reducedMotion: reduced,
        cache: true,
    });
    const waitForExit = input.targetHiddenForGame ? false : outgoing.exitBlocking;
    const nextEntry = { ...nextEntryBase, direction: "back" as const, waitForExit } as Entry;
    const exitDurationMs = outgoing.exitMs;
    const enterDurationMs = input.targetHiddenForGame ? 0 : incoming.enterMs;
    const holdCurrentUntilEnterComplete = shouldHoldCurrentSurfaceUntilEnterComplete({
        waitForExit,
        hasCurrentSurface: true,
        exitDurationMs,
        enterDurationMs,
        incomingHidden: input.targetHiddenForGame,
    });
    const transitionDurationMs = input.targetHiddenForGame
        ? exitDurationMs
        : waitForExit
            ? exitDurationMs + enterDurationMs
            : Math.max(exitDurationMs, enterDurationMs);
    let visibleEntries: Entry[];
    if (waitForExit || input.targetHiddenForGame) {
        visibleEntries = [];
    } else if (holdCurrentUntilEnterComplete) {
        visibleEntries = [{ ...currentEntry, exitBehind: true } as Entry, nextEntry];
    } else {
        visibleEntries = [nextEntry, currentEntry];
    }
    const navStack = input.navStack.slice(0, targetIndex + 1) as Entry[];
    navStack[navStack.length - 1] = nextEntry;

    return {
        direction: "back",
        navStack,
        visibleEntries,
        surfacePresenceMode: waitForExit ? "wait" : "sync",
        pendingWaitEntry: waitForExit ? nextEntry : null,
        pendingUnderlayReadyKey:
            waitForExit || input.targetHiddenForGame || holdCurrentUntilEnterComplete ? null : nextEntry.key,
        pendingRemoveAfterEnterKey: holdCurrentUntilEnterComplete ? nextEntry.key : null,
        transitionDurationMs,
        transitionWaitOptions: input.targetHiddenForGame
            ? { waitForEnter: false, waitForExit: transitionDurationMs > 0 }
            : undefined,
    };
}
