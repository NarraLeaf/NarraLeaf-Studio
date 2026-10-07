/**
 * Whose a press inside a list row is: the row's, or a control's in it.
 *
 * A control in the row that handles a press itself - a replay button on a backlog line, a delete
 * button on a save row - is pressed for what it does, and the row raising Item Click under it as
 * well did two things at once: replaying a line also asked whether to go back to it. So such a press
 * is the control's alone, as a key pressed on the control already is (the row ignores keys from
 * inside it). A control that handles nothing - a hit area laid over a card - still passes its press
 * to the row, and so does the row's own root, whose press is the row's.
 */

/**
 * Whether an element between the press target and the row - the row's roots excepted - answers the
 * press itself.
 *
 * Walks the drawn elements from `target` up to `row`, reading each one's element id, so the elements
 * a component placement draws are asked by their own ids as well.
 */
export function pressIsAnsweredInRow(input: {
    target: EventTarget | null;
    row: Element;
    /** The row's own roots: the item template's top elements, whose press is the row's. */
    rowRootIds: ReadonlySet<string>;
    answers: (elementId: string) => boolean;
}): boolean {
    let node: Element | null = isElement(input.target) ? input.target : null;
    while (node && node !== input.row) {
        const elementId = node.getAttribute("data-ui-element-id");
        if (elementId && !input.rowRootIds.has(elementId) && input.answers(elementId)) {
            return true;
        }
        node = node.parentElement;
    }
    return false;
}

function isElement(target: EventTarget | null): target is Element {
    return typeof Element !== "undefined" && target instanceof Element;
}
