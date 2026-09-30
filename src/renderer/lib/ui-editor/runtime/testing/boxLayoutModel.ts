/**
 * Where the browser would put a box, worked out from the inline styles that place it.
 *
 * jsdom lays nothing out, so a test that has to say whether two pages of a frame are drawn over each
 * other, or where a press would land, has to state the browser's rules itself. These are the rules
 * for the styles that sit between a Page widget and the elements of the pages it shows, and no more:
 *
 * - an element with `position: absolute` sits at its `left` / `top` in its parent's box;
 * - any other element is in flow, and sits below every in-flow sibling before it (shifted by its own
 *   `left` / `top` when it is `position: relative`);
 * - a length is `px` or a percentage of the parent, and a box with no width or height of its own is
 *   taken to fill its parent - which every such box on that path is (`inset: 0`, `100%`), and which
 *   is a fair stand-in for the parts of a widget inside the widget's own box;
 * - a transform is translations and a scale, the scale taken from the top left corner. A scale about
 *   any other origin, or a rotation, is refused rather than guessed at.
 *
 * Only imported from test files; it never ships in a product bundle.
 */

export type LaidOutBox = { x: number; y: number; width: number; height: number };

const OUT_OF_FLOW = new Set(["absolute", "fixed"]);

function length(value: string, of: number): number | null {
    const trimmed = value.trim();
    if (trimmed.length === 0 || trimmed === "auto") {
        return null;
    }
    if (trimmed.endsWith("%")) {
        return (Number.parseFloat(trimmed) / 100) * of;
    }
    if (trimmed.endsWith("px") || /^-?\d+(\.\d+)?$/.test(trimmed)) {
        return Number.parseFloat(trimmed);
    }
    throw new Error(`the layout model reads px and % lengths, not "${value}"`);
}

/** The element's own size, before its transform. */
export function laidOutSize(element: HTMLElement): { width: number; height: number } {
    const parent = element.parentElement;
    const parentSize = parent ? laidOutSize(parent) : { width: 0, height: 0 };
    return {
        width: length(element.style.width, parentSize.width) ?? parentSize.width,
        height: length(element.style.height, parentSize.height) ?? parentSize.height,
    };
}

function offsetInParent(element: HTMLElement): { x: number; y: number } {
    const parent = element.parentElement;
    const parentSize = parent ? laidOutSize(parent) : { width: 0, height: 0 };
    const left = length(element.style.left, parentSize.width) ?? 0;
    const top = length(element.style.top, parentSize.height) ?? 0;
    if (OUT_OF_FLOW.has(element.style.position)) {
        return { x: left, y: top };
    }
    let above = 0;
    for (let sibling = element.previousElementSibling; sibling; sibling = sibling.previousElementSibling) {
        if (
            sibling instanceof HTMLElement
            && !OUT_OF_FLOW.has(sibling.style.position)
            && sibling.style.display !== "none"
        ) {
            above += laidOutSize(sibling).height;
        }
    }
    const relative = element.style.position === "relative";
    return { x: relative ? left : 0, y: above + (relative ? top : 0) };
}

function transformOf(element: HTMLElement): { scale: number; x: number; y: number } {
    const transform = element.style.transform.trim();
    const result = { scale: 1, x: 0, y: 0 };
    if (transform.length === 0 || transform === "none") {
        return result;
    }
    for (const [, name, args] of transform.matchAll(/([a-zA-Z0-9]+)\(([^)]*)\)/g)) {
        const values = args.split(",").map(part => part.trim());
        switch (name) {
            case "translateX":
                result.x += result.scale * (length(values[0], 0) ?? 0);
                break;
            case "translateY":
                result.y += result.scale * (length(values[0], 0) ?? 0);
                break;
            case "translate":
            case "translate3d":
                result.x += result.scale * (length(values[0], 0) ?? 0);
                result.y += result.scale * (length(values[1] ?? "0", 0) ?? 0);
                break;
            case "scale":
                result.scale *= Number.parseFloat(values[0]);
                break;
            case "rotate":
            case "rotateZ":
                // A widget's resting pose writes its rotation even when there is none.
                if (Number.parseFloat(values[0]) !== 0) {
                    throw new Error(`the layout model does not rotate boxes ("${transform}")`);
                }
                break;
            default:
                throw new Error(`the layout model reads translations and scale, not "${name}()" ("${transform}")`);
        }
    }
    const origin = element.style.transformOrigin.trim();
    if (result.scale !== 1 && !/^(top left|left top|0(px)? 0(px)?)$/.test(origin)) {
        throw new Error(`the layout model scales from the top left corner, not from "${origin || "the centre"}"`);
    }
    return result;
}

const round = (value: number) => Math.round(value * 100) / 100;

/** `element`'s box in `ancestor`'s coordinates, before `ancestor`'s own transform. */
export function laidOutBoxIn(ancestor: Element, element: HTMLElement): LaidOutBox {
    const size = laidOutSize(element);
    let box: LaidOutBox = { x: 0, y: 0, width: size.width, height: size.height };
    for (let node: HTMLElement = element; node !== ancestor; ) {
        const transform = transformOf(node);
        box = {
            x: transform.x + box.x * transform.scale,
            y: transform.y + box.y * transform.scale,
            width: box.width * transform.scale,
            height: box.height * transform.scale,
        };
        const offset = offsetInParent(node);
        box = { ...box, x: box.x + offset.x, y: box.y + offset.y };
        const parent = node.parentElement;
        if (!parent) {
            throw new Error("the element is not inside the ancestor it was measured against");
        }
        node = parent;
    }
    return { x: round(box.x), y: round(box.y), width: round(box.width), height: round(box.height) };
}

export function boxHolds(box: LaidOutBox, point: { x: number; y: number }): boolean {
    return point.x >= box.x && point.x < box.x + box.width && point.y >= box.y && point.y < box.y + box.height;
}
