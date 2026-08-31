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
    const originalScrollTo = Object.getOwnPropertyDescriptor(Element.prototype, "scrollTo");
    const originalClientHeight = Object.getOwnPropertyDescriptor(Element.prototype, "clientHeight");
    const originalScrollHeight = Object.getOwnPropertyDescriptor(Element.prototype, "scrollHeight");

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

    // jsdom's `scrollTo` is a no-op for the same reason, and a virtualiser asked to reveal an item
    // scrolls through exactly that call - so without this, "scroll to the hit" is a test that can
    // only ever assert that nothing moved. This does what a scroller does: move, then say so.
    Object.defineProperty(Element.prototype, "scrollTo", {
        configurable: true,
        writable: true,
        value(this: Element, options?: number | ScrollToOptions) {
            const top = typeof options === "number" ? options : options?.top;
            if (top === undefined) {
                return;
            }
            offsets.set(this, top);
            this.dispatchEvent(new Event("scroll"));
        },
    });

    // How far a scroller may be scrolled, which is the one number a virtualiser clamps a
    // `scrollToIndex` against - a jsdom `scrollHeight` of 0 clamps every reveal to the top, so a
    // list that scrolls perfectly well in the app looks inert here. The windowed list states its
    // own content height on the element it absolutely positions items inside, so read that.
    Object.defineProperty(Element.prototype, "clientHeight", {
        configurable: true,
        get: () => viewport,
    });
    Object.defineProperty(Element.prototype, "scrollHeight", {
        configurable: true,
        get(this: Element) {
            const content = this.firstElementChild as HTMLElement | null;
            const declared = Number.parseFloat(content?.style.height ?? "");
            return Number.isFinite(declared) ? Math.max(declared, viewport) : viewport;
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
        if (originalScrollTo) {
            Object.defineProperty(Element.prototype, "scrollTo", originalScrollTo);
        }
        if (originalClientHeight) {
            Object.defineProperty(Element.prototype, "clientHeight", originalClientHeight);
        }
        if (originalScrollHeight) {
            Object.defineProperty(Element.prototype, "scrollHeight", originalScrollHeight);
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
