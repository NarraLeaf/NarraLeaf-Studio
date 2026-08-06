import { getHelpTopic, type HelpTopicId } from "./helpTopics";

/**
 * Window-local plumbing for the help popover: one opener pointer plus the DOM walk that turns
 * "what has focus" into a topic id.
 *
 * Same shape as `commandPaletteController` and `openKeybindingCheatSheet` - a module-level function
 * set by the mounted overlay - because the callers are everywhere (a keybinding, a panel header, a
 * palette command) and none of them is in a position to hold React state for the overlay.
 *
 * Topic resolution is deliberately DOM-based: a surface opts in by putting `data-help-topic` on any
 * element that contains it, and needs to know nothing else. That also means help follows the thing
 * the author is actually looking at rather than whatever the app believes is "current".
 */

export const HELP_TOPIC_ATTRIBUTE = "data-help-topic";

export interface HelpRequest {
    topicId: HelpTopicId;
    /** What the popover points at. Null centres it, which is what a palette command wants. */
    anchor: HTMLElement | null;
}

type HelpOpener = (request: HelpRequest) => void;

let opener: HelpOpener | null = null;

/** Called by the mounted overlay; returns the teardown. */
export function registerHelpOpener(next: HelpOpener): () => void {
    opener = next;
    return () => {
        if (opener === next) {
            opener = null;
        }
    };
}

/**
 * The element the pointer is over, kept because `document.activeElement` is the body in the common
 * case of "the author is hovering a panel they have not clicked". `pointerover` fires on element
 * change rather than on every pixel, so this costs nothing measurable.
 */
let pointerTarget: HTMLElement | null = null;

export function startHelpPointerTracking(): () => void {
    const onPointerOver = (event: PointerEvent) => {
        pointerTarget = event.target instanceof HTMLElement ? event.target : null;
    };
    document.addEventListener("pointerover", onPointerOver, { passive: true });
    return () => {
        document.removeEventListener("pointerover", onPointerOver);
        pointerTarget = null;
    };
}

/** The nearest enclosing element that declares a registered topic, if any. */
export function resolveHelpTopicElement(from: Element | null): HTMLElement | null {
    let node: Element | null = from;
    while (node) {
        if (node instanceof HTMLElement) {
            const id = node.getAttribute(HELP_TOPIC_ATTRIBUTE);
            if (id && getHelpTopic(id)) {
                return node;
            }
        }
        node = node.parentElement;
    }
    return null;
}

/** Open a named topic. `anchor` omitted centres the popover. */
export function openHelpTopic(topicId: HelpTopicId, anchor?: HTMLElement | null): void {
    opener?.({ topicId, anchor: anchor ?? null });
}

/**
 * What `F1` does: answer for whatever the author is looking at.
 *
 * Focus first (a keyboard user is in a control), pointer second (a mouse user is over a panel they
 * never clicked). Returns false when neither resolves, so the caller can decide what "no topic
 * here" means - the workspace opens the browser rather than swallowing the key silently.
 */
export function requestContextHelp(): boolean {
    const element =
        resolveHelpTopicElement(document.activeElement) ?? resolveHelpTopicElement(pointerTarget);
    if (!element) {
        return false;
    }
    const topicId = element.getAttribute(HELP_TOPIC_ATTRIBUTE);
    const topic = getHelpTopic(topicId);
    if (!topic) {
        return false;
    }
    opener?.({ topicId: topic.id, anchor: element });
    return true;
}
