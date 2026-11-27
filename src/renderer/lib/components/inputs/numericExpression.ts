/**
 * What a number field makes of what was typed into it.
 *
 * A plain number, or simple arithmetic - `120+16`, `1920/3`, `(40-8)*2` - as design tools take it,
 * so "half of this" or "this plus a margin" can be typed instead of worked out elsewhere. A trailing
 * unit (`12px`, `50%`) is read past, as `parseFloat` always did here. Anything else is not a number:
 * `null`, and the field keeps the value it had rather than guessing (`parseFloat("10+5")` used to
 * write 10 without a word).
 */
export function evaluateNumericInput(raw: string): number | null {
    const text = raw.trim().replace(/[a-z%]+$/i, "").trim().replace(/−/g, "-").replace(/,/g, ".");
    if (text === "") {
        return null;
    }
    let pos = 0;

    const peek = () => text[pos];
    const skipSpace = () => {
        while (pos < text.length && /\s/.test(text[pos])) {
            pos += 1;
        }
    };

    // expression := term (('+' | '-') term)*
    const expression = (): number | null => {
        let value = term();
        if (value === null) {
            return null;
        }
        for (;;) {
            skipSpace();
            const op = peek();
            if (op !== "+" && op !== "-") {
                return value;
            }
            pos += 1;
            const right = term();
            if (right === null) {
                return null;
            }
            value = op === "+" ? value + right : value - right;
        }
    };

    // term := factor (('*' | '/' | 'x' | '×') factor)*
    const term = (): number | null => {
        let value = factor();
        if (value === null) {
            return null;
        }
        for (;;) {
            skipSpace();
            const op = peek();
            if (op !== "*" && op !== "/" && op !== "×" && op !== "÷") {
                return value;
            }
            pos += 1;
            const right = factor();
            if (right === null) {
                return null;
            }
            value = op === "*" || op === "×" ? value * right : value / right;
        }
    };

    // factor := ('-' | '+') factor | '(' expression ')' | number
    const factor = (): number | null => {
        skipSpace();
        const ch = peek();
        if (ch === "-" || ch === "+") {
            pos += 1;
            const inner = factor();
            return inner === null ? null : ch === "-" ? -inner : inner;
        }
        if (ch === "(") {
            pos += 1;
            const inner = expression();
            skipSpace();
            if (inner === null || peek() !== ")") {
                return null;
            }
            pos += 1;
            return inner;
        }
        const match = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(text.slice(pos));
        if (!match) {
            return null;
        }
        pos += match[0].length;
        return Number(match[0]);
    };

    const value = expression();
    skipSpace();
    if (value === null || pos !== text.length || !Number.isFinite(value)) {
        return null;
    }
    return value;
}

/** How far one arrow key press moves a number field: 1, or 10 with Shift (0.1 with Alt). */
export function arrowKeyStep(event: { shiftKey: boolean; altKey: boolean }): number {
    if (event.shiftKey) {
        return 10;
    }
    if (event.altKey) {
        return 0.1;
    }
    return 1;
}

/** `value + delta`, without the float noise that `0.1 + 0.2` leaves behind. */
export function stepNumber(value: number, delta: number): number {
    return Math.round((value + delta) * 1e6) / 1e6;
}

/** Screen pixels of sideways drag per step while scrubbing a number field's icon. */
export const SCRUB_PIXELS_PER_STEP = 2;

/**
 * Scrubbing: the icon of a number field pressed and dragged sideways changes the value, one step
 * every {@link SCRUB_PIXELS_PER_STEP} pixels (Shift and Alt scale the step as the arrow keys do).
 * `onPreview` hears every step, `onCommit` the final value once, when the pointer comes up - one
 * edit, one undo step - and only if the value moved.
 */
export function beginNumberScrub(
    event: { clientX: number; pointerId: number; currentTarget: Element; preventDefault(): void },
    options: { start: number; onPreview: (value: number) => void; onCommit: (value: number) => void; onEnd?: () => void },
): void {
    event.preventDefault();
    const target = event.currentTarget;
    const view = target.ownerDocument.defaultView;
    if (!view) {
        return;
    }
    const originX = event.clientX;
    let value = options.start;
    try {
        target.setPointerCapture(event.pointerId);
    } catch {
        // Capture is a nicety: without it the window-level listeners below still see the drag.
    }
    const move = (moveEvent: PointerEvent) => {
        const steps = Math.round((moveEvent.clientX - originX) / SCRUB_PIXELS_PER_STEP);
        const next = stepNumber(options.start, steps * arrowKeyStep(moveEvent));
        if (next !== value) {
            value = next;
            options.onPreview(value);
        }
    };
    const up = () => {
        view.removeEventListener("pointermove", move);
        view.removeEventListener("pointerup", up);
        view.removeEventListener("pointercancel", up);
        options.onEnd?.();
        if (value !== options.start) {
            options.onCommit(value);
        }
    };
    view.addEventListener("pointermove", move);
    view.addEventListener("pointerup", up);
    view.addEventListener("pointercancel", up);
}
