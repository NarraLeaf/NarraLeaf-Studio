import type { UIElement, UIElementId, UISurface } from "@shared/types/ui-editor/document";
import { getUIElementAnimationSettings } from "@shared/types/ui-editor/elementAnimation";
import {
    normalizeUIPageAnimationSettings,
    type UIPageAnimationPreset,
    type UIPageAnimationSettings,
} from "@shared/types/ui-editor/pageAnimation";
import { getPageAnimationDurationMs } from "@/lib/ui-editor/runtime/pageAnimation";

/**
 * When each element of one Surface starts and stops moving.
 *
 * Every number here is milliseconds measured from the moment the *Surface* begins entering or
 * leaving. The runtime subtracts the origin of whichever subtree actually triggered the change
 * (see `ElementAnimationScope`), so the same plan serves both "the whole Page left" and "a blueprint
 * hid this one container".
 *
 * It is computed rather than observed because the two things that need it cannot wait and see:
 * navigation has to know up front how long a page switch takes (it settles a promise on it), and an
 * element that waits for its children has to be handed a delay before its own animation starts.
 */
export type ElementAnimationTiming = {
    settings: UIPageAnimationSettings;
    /** When this element's subtree begins entering (its parent's origin plus its share of the stagger). */
    enterOriginMs: number;
    /** When this element's own enter animation starts. */
    enterStartMs: number;
    enterDurationMs: number;
    /** When this element's subtree begins leaving. */
    exitOriginMs: number;
    /** When this element's own exit animation starts - after its children when it waits for them. */
    exitStartMs: number;
    exitDurationMs: number;
    /** This element itself moves. */
    selfAnimated: boolean;
    /**
     * This element, or something under it, moves. It is what decides whether the element is wrapped
     * in a presence layer at all: an element with nothing animated anywhere below it renders exactly
     * as it did before this feature existed.
     */
    subtreeAnimated: boolean;
};

export type SurfaceAnimationPlan = {
    reducedMotion: boolean;
    /** Keyed by element id; the root element is included, under the Surface's own settings. */
    elements: ReadonlyMap<UIElementId, ElementAnimationTiming>;
    root: ElementAnimationTiming;
    /** Everything below the root has finished leaving by here. */
    childrenExitEndMs: number;
    /** Everything below the root has finished arriving by here. */
    childrenEnterEndMs: number;
    /** How long the Surface must stay mounted once it starts leaving, children included. */
    exitTotalMs: number;
    /** How long the whole arrival takes, children included. */
    enterTotalMs: number;
    /** Nothing on this Surface moves, root included. */
    empty: boolean;
};

type PlanInput = {
    elements: Record<UIElementId, UIElement>;
    rootElementId: UIElementId;
    /**
     * The Surface's page animation, or a Page component's override of it. The root element's own
     * animation field is never read: on a Surface the root *is* the Surface.
     */
    rootSettings?: UIPageAnimationSettings | null;
    reducedMotion?: boolean;
};

type VisitResult = {
    enterEndMs: number;
    exitEndMs: number;
    childrenEnterEndMs: number;
    childrenExitEndMs: number;
    subtreeAnimated: boolean;
};

const DEFAULT_ELEMENT_SETTINGS = normalizeUIPageAnimationSettings(null);

function durationMs(preset: UIPageAnimationPreset, seconds: number, reducedMotion: boolean): number {
    if (reducedMotion || preset === "none") {
        return 0;
    }
    return Math.max(0, Math.round(seconds * 1000));
}

function delayMs(seconds: number, reducedMotion: boolean): number {
    return reducedMotion ? 0 : Math.max(0, Math.round(seconds * 1000));
}

function emptyTiming(settings: UIPageAnimationSettings): ElementAnimationTiming {
    return {
        settings,
        enterOriginMs: 0,
        enterStartMs: 0,
        enterDurationMs: 0,
        exitOriginMs: 0,
        exitStartMs: 0,
        exitDurationMs: 0,
        selfAnimated: false,
        subtreeAnimated: false,
    };
}

export function buildSurfaceAnimationPlan(input: PlanInput): SurfaceAnimationPlan {
    const reducedMotion = input.reducedMotion === true;
    const timings = new Map<UIElementId, ElementAnimationTiming>();
    const rootSettings = normalizeUIPageAnimationSettings(input.rootSettings);

    const visit = (
        element: UIElement,
        settings: UIPageAnimationSettings,
        enterOriginMs: number,
        exitOriginMs: number,
    ): VisitResult => {
        const enterDurationMs = durationMs(settings.enter, settings.enterDurationSeconds, reducedMotion);
        const exitDurationMs = durationMs(settings.exit, settings.exitDurationSeconds, reducedMotion);
        // A delay with nothing to delay would still push a waiting parent out, so an element that
        // does not animate a phase contributes no time to it at all.
        const enterStartMs =
            enterOriginMs + (enterDurationMs > 0 ? delayMs(settings.enterDelaySeconds, reducedMotion) : 0);
        const staggerMs = delayMs(settings.childStaggerSeconds, reducedMotion);

        let childrenEnterEndMs = enterOriginMs;
        let childrenExitEndMs = exitOriginMs;
        let subtreeAnimated = enterDurationMs > 0 || exitDurationMs > 0;
        let staggerIndex = 0;
        for (const childId of element.childrenIds) {
            const child = input.elements[childId];
            if (!child) {
                continue;
            }
            /**
             * An authored-hidden child is still planned - a blueprint showing it is the ordinary way
             * an element gets an entrance, and it needs its timings ready for that moment. What it
             * does not get is a place in the queue: it takes no stagger slot, and nothing waits for
             * an animation nobody is watching. If it is revealed later it arrives on its own clock,
             * which is what `ElementAnimationScope` resolves.
             */
            const hidden = child.layout.visible === false;
            const childOffsetMs = staggerMs * staggerIndex;
            if (!hidden) {
                staggerIndex += 1;
            }
            const result = visit(
                child,
                getUIElementAnimationSettings(child) ?? DEFAULT_ELEMENT_SETTINGS,
                enterOriginMs + childOffsetMs,
                exitOriginMs + childOffsetMs,
            );
            if (!hidden) {
                childrenEnterEndMs = Math.max(childrenEnterEndMs, result.enterEndMs);
                childrenExitEndMs = Math.max(childrenExitEndMs, result.exitEndMs);
            }
            subtreeAnimated = subtreeAnimated || result.subtreeAnimated;
        }

        const exitStartMs =
            (settings.exitWaitsForChildren ? childrenExitEndMs : exitOriginMs) +
            (exitDurationMs > 0 ? delayMs(settings.exitDelaySeconds, reducedMotion) : 0);

        timings.set(element.id, {
            settings,
            enterOriginMs,
            enterStartMs,
            enterDurationMs,
            exitOriginMs,
            exitStartMs,
            exitDurationMs,
            selfAnimated: enterDurationMs > 0 || exitDurationMs > 0,
            subtreeAnimated,
        });

        return {
            enterEndMs: Math.max(enterStartMs + enterDurationMs, childrenEnterEndMs),
            exitEndMs: Math.max(exitStartMs + exitDurationMs, childrenExitEndMs),
            childrenEnterEndMs,
            childrenExitEndMs,
            subtreeAnimated,
        };
    };

    const rootElement = input.elements[input.rootElementId];
    if (!rootElement) {
        return {
            reducedMotion,
            elements: timings,
            root: emptyTiming(rootSettings),
            childrenExitEndMs: 0,
            childrenEnterEndMs: 0,
            exitTotalMs: 0,
            enterTotalMs: 0,
            empty: true,
        };
    }

    const result = visit(rootElement, rootSettings, 0, 0);
    return {
        reducedMotion,
        elements: timings,
        root: timings.get(rootElement.id) ?? emptyTiming(rootSettings),
        childrenExitEndMs: result.childrenExitEndMs,
        childrenEnterEndMs: result.childrenEnterEndMs,
        exitTotalMs: result.exitEndMs,
        enterTotalMs: result.enterEndMs,
        empty: !result.subtreeAnimated,
    };
}

const planCache = new WeakMap<Record<UIElementId, UIElement>, Map<string, SurfaceAnimationPlan>>();

/**
 * Written out in a fixed order rather than stringified: two records with the same values but a
 * different key order are the same plan, and every nested Page component builds a fresh override
 * object on each render.
 */
function settingsCacheKey(settings: UIPageAnimationSettings | null | undefined): string {
    if (!settings) {
        return "-";
    }
    return [
        settings.enter,
        settings.exit,
        settings.enterDirection,
        settings.exitDirection,
        settings.enterAngleDegrees,
        settings.exitAngleDegrees,
        settings.enterDurationSeconds,
        settings.exitDurationSeconds,
        settings.enterDelaySeconds,
        settings.exitDelaySeconds,
        settings.childStaggerSeconds,
        settings.exitWaitsForChildren,
        settings.exitBlocking,
    ].join(",");
}

/**
 * Cached {@link buildSurfaceAnimationPlan}, keyed on the element table's identity.
 *
 * Only a host whose element table is a snapshot may pass `cache` - the same promise `staticDocument`
 * asks of the element tree. The editor mutates its document in place and re-emits the same object,
 * so a cached plan there would stop following edits.
 */
export function getSurfaceAnimationPlan(input: PlanInput & { cache?: boolean }): SurfaceAnimationPlan {
    if (input.cache !== true) {
        return buildSurfaceAnimationPlan(input);
    }
    let byKey = planCache.get(input.elements);
    if (!byKey) {
        byKey = new Map();
        planCache.set(input.elements, byKey);
    }
    const key = [
        input.rootElementId,
        input.reducedMotion === true ? "reduced" : "full",
        settingsCacheKey(input.rootSettings),
    ].join(" ");
    const cached = byKey.get(key);
    if (cached) {
        return cached;
    }
    const plan = buildSurfaceAnimationPlan(input);
    byKey.set(key, plan);
    return plan;
}

export type SurfaceAnimationTimings = {
    /** Null when this host wants a static tree; the durations then come from the Surface alone. */
    plan: SurfaceAnimationPlan | null;
    /** Everything the arrival takes, the Surface's own animation and its elements' together. */
    enterMs: number;
    /** Everything the departure takes. This is what an incoming Page waits for. */
    exitMs: number;
    /** Held before the Surface's own enter starts. */
    ownEnterDelayMs: number;
    /** Held before the Surface's own exit starts - the children's departure, when it waits for them. */
    ownExitDelayMs: number;
    /** The incoming Page waits for this one to finish leaving. */
    exitBlocking: boolean;
};

/**
 * What a Surface transition costs, elements included.
 *
 * The one place navigation, Page components and the Surface layer agree on the numbers. Pass
 * `elements` to have the element timings counted; without them it answers for the Surface alone,
 * which is what a host that does not animate its elements wants (and what every caller did before
 * elements could animate).
 */
export function getSurfaceAnimationTimings(input: {
    elements?: Record<UIElementId, UIElement> | null;
    surface?: Pick<UISurface, "rootElementId" | "settings"> | null;
    /** A Page component's override of the Surface's own animation. */
    settingsOverride?: UIPageAnimationSettings | null;
    reducedMotion?: boolean;
    cache?: boolean;
}): SurfaceAnimationTimings {
    const settings = input.settingsOverride ?? input.surface?.settings?.pageAnimation ?? null;
    const reducedMotion = input.reducedMotion === true;
    const plan =
        input.elements && input.surface && !reducedMotion
            ? getSurfaceAnimationPlan({
                  elements: input.elements,
                  rootElementId: input.surface.rootElementId,
                  rootSettings: settings,
                  reducedMotion,
                  cache: input.cache,
              })
            : null;
    const enterMs = plan ? plan.enterTotalMs : getPageAnimationDurationMs(settings, "enter", reducedMotion);
    const exitMs = plan ? plan.exitTotalMs : getPageAnimationDurationMs(settings, "exit", reducedMotion);
    return {
        plan,
        enterMs,
        exitMs,
        ownEnterDelayMs: plan?.root.enterStartMs ?? 0,
        ownExitDelayMs: plan?.root.exitStartMs ?? 0,
        // Read off the resolved total rather than the Surface's own duration: a Page whose own exit
        // is instant but whose contents leave over half a second still has something to wait for.
        exitBlocking: normalizeUIPageAnimationSettings(settings).exitBlocking && exitMs > 0,
    };
}
