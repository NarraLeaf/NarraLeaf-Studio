export const BLUEPRINT_EVENTS_DISABLED_ATTR = "data-ui-blueprint-events-disabled";

const UI_ELEMENT_ID_ATTR = "data-ui-element-id";
const UI_ELEMENT_ID_SELECTOR = `[${UI_ELEMENT_ID_ATTR}]`;
const BLUEPRINT_EVENTS_DISABLED_SELECTOR = `[${BLUEPRINT_EVENTS_DISABLED_ATTR}="true"]`;

type ClosestCapableElement = {
    closest: (selectors: string) => ClosestCapableElement | null;
    getAttribute: (qualifiedName: string) => string | null;
    contains?: (other: ClosestCapableElement) => boolean;
    parentElement?: ClosestCapableElement | null;
};

function isClosestCapableElement(value: unknown): value is ClosestCapableElement {
    return (
        typeof value === "object" &&
        value !== null &&
        typeof (value as { closest?: unknown }).closest === "function" &&
        typeof (value as { getAttribute?: unknown }).getAttribute === "function"
    );
}

function eventTargetElement(target: EventTarget | null): ClosestCapableElement | null {
    if (!target) {
        return null;
    }
    if (typeof Element !== "undefined" && target instanceof Element) {
        return target as unknown as ClosestCapableElement;
    }
    if (typeof Node !== "undefined" && target instanceof Node) {
        return isClosestCapableElement(target.parentElement)
            ? target.parentElement as unknown as ClosestCapableElement
            : null;
    }
    return isClosestCapableElement(target) ? target : null;
}

export function shouldHandleBlueprintElementEvent(
    target: EventTarget | null,
    elementId: string,
): boolean {
    const targetEl = eventTargetElement(target);
    const owningElement = targetEl?.closest(UI_ELEMENT_ID_SELECTOR) ?? null;
    if (owningElement?.getAttribute(UI_ELEMENT_ID_ATTR) !== elementId) {
        return false;
    }

    const disabledEventRoot = targetEl?.closest(BLUEPRINT_EVENTS_DISABLED_SELECTOR) ?? null;
    if (!disabledEventRoot) {
        return true;
    }
    if (disabledEventRoot === owningElement) {
        return false;
    }
    if (typeof owningElement.contains === "function") {
        return !owningElement.contains(disabledEventRoot);
    }
    return false;
}
