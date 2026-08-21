/**
 * A layout for jsdom, so a windowed list can be exercised at all.
 *
 * Imported only by tests. jsdom runs no layout engine: `offsetHeight` is 0 for every element and
 * `getBoundingClientRect` answers zero for everything, and a virtualiser reads exactly those two
 * numbers. `@tanstack/react-virtual` gives up when the scroller reports a height of 0 - it renders
 * nothing at all - so without this a test of a windowed surface asserts against an empty document
 * and passes for the wrong reason.
 *
 * What it fakes is deliberately crude: one height for the scroller, one height for a row, one width
 * for everything. That is enough for the only questions a jsdom test may honestly ask of a windowed
 * list - how many rows exist, and which ones - and it is not layout. Anything that depends on real
 * measurement (a wrapped line being taller than a short one, a grid's column count under a real
 * panel width) has to be looked at in the running app.
 *
 * Comments in English per project convention.
 */

export interface VirtualLayoutStubOptions {
    /** What the scroll container reports as its height. */
    viewport?: number;
    /** What one windowed item reports. A row wrapper is anything carrying `data-index`. */
    row?: number;
    /** What every element reports as its width. Decides a grid's column count. */
    width?: number;
}

/**
 * Install the stub. Returns the restore function; call it from `afterEach`.
 */
export function installVirtualLayoutStub({
    viewport = 600,
    row = 32,
    width = 400,
}: VirtualLayoutStubOptions = {}): () => void {
    const proto = HTMLElement.prototype as unknown as Record<string, unknown>;
    const originalRect = Object.getOwnPropertyDescriptor(Element.prototype, "getBoundingClientRect");
    const originalHeight = Object.getOwnPropertyDescriptor(proto, "offsetHeight");
    const originalWidth = Object.getOwnPropertyDescriptor(proto, "offsetWidth");
    const originalScrollTop = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTop");

    // jsdom's `scrollTop` is a getter that always answers 0, because scrolling needs a layout box.
    // A windowed list reads it on every scroll event, so a test that wants to scroll has to be able
    // to write it; the event itself stays the test's to dispatch.
    const offsets = new WeakMap<Element, number>();
    Object.defineProperty(Element.prototype, "scrollTop", {
        configurable: true,
        get(this: Element) {
            return offsets.get(this) ?? 0;
        },
        set(this: Element, value: number) {
            offsets.set(this, value);
        },
    });

    Object.defineProperty(HTMLElement.prototype, "offsetHeight", {
        configurable: true,
        get: () => viewport,
    });
    Object.defineProperty(HTMLElement.prototype, "offsetWidth", {
        configurable: true,
        get: () => width,
    });
    Object.defineProperty(Element.prototype, "getBoundingClientRect", {
        configurable: true,
        writable: true,
        value(this: Element): DOMRect {
            const height = this.hasAttribute("data-index") ? row : viewport;
            return {
                x: 0,
                y: 0,
                top: 0,
                left: 0,
                right: width,
                bottom: height,
                width,
                height,
                toJSON: () => ({}),
            } as DOMRect;
        },
    });

    return () => {
        if (originalRect) {
            Object.defineProperty(Element.prototype, "getBoundingClientRect", originalRect);
        }
        if (originalScrollTop) {
            Object.defineProperty(Element.prototype, "scrollTop", originalScrollTop);
        }
        if (originalHeight) {
            Object.defineProperty(proto, "offsetHeight", originalHeight);
        } else {
            delete proto.offsetHeight;
        }
        if (originalWidth) {
            Object.defineProperty(proto, "offsetWidth", originalWidth);
        } else {
            delete proto.offsetWidth;
        }
    };
}
