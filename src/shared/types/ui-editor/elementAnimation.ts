import { uiElementTypeAcceptsChildren, type UIElement } from "./document";
import {
    isDefaultUIPageAnimationSettings,
    normalizeUIPageAnimationSettings,
    type UIPageAnimationSettings,
} from "./pageAnimation";

/**
 * The animation an element was given, or null when it was never given one.
 *
 * Null and "all defaults" mean the same thing to the runtime (nothing moves), and the editor writes
 * the field away again the moment it returns to defaults - so an untouched document stays untouched.
 * Callers that need a record to show or edit use {@link resolveUIElementAnimationSettings}.
 */
export function getUIElementAnimationSettings(
    element: Pick<UIElement, "animation"> | null | undefined,
): UIPageAnimationSettings | null {
    const raw = element?.animation;
    if (!raw || typeof raw !== "object") {
        return null;
    }
    const settings = normalizeUIPageAnimationSettings(raw);
    return isDefaultUIPageAnimationSettings(settings) ? null : settings;
}

/** The record to show in an inspector: the element's own, falling back to a fully-default one. */
export function resolveUIElementAnimationSettings(
    element: Pick<UIElement, "animation"> | null | undefined,
): UIPageAnimationSettings {
    return normalizeUIPageAnimationSettings(element?.animation);
}

export function hasUIElementAnimation(element: Pick<UIElement, "animation"> | null | undefined): boolean {
    return getUIElementAnimationSettings(element) !== null;
}

/**
 * Whether this element offers the child-timing half of the editor (stagger, wait for children).
 *
 * Asked of the type rather than of `childrenIds`, so the controls do not appear and disappear as an
 * author fills an empty container.
 */
export function uiElementOwnsChildAnimationTiming(elementType: string): boolean {
    return uiElementTypeAcceptsChildren(elementType);
}
