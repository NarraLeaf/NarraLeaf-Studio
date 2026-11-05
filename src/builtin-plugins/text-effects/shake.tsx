/**
 * Shaking text: every character of the run jitters around its place, each out of step with its
 * neighbours, the way a frightened or furious line is set in a visual novel.
 *
 * Drawn with one CSS animation per character rather than from a timer: the browser runs it off the
 * main thread's layout, and the line is not re-rendered sixty times a second while it is on screen.
 * The keyframes go into the document once, as a style element of their own, because a plugin bundle
 * carries no stylesheet.
 *
 * A player whose system asks for reduced motion sees the text still. The effect is decoration, and
 * the words read the same without it.
 *
 * Comments in English per project convention.
 */

import { useLayoutEffect, useRef } from "react";
import type { CSSProperties, ReactElement, RefObject } from "react";
import type { RuntimeInlineTextEffectRenderProps } from "narraleaf-studio/runtime";

export const SHAKE_EFFECT_ID = "narraleaf.text-effects.shake";

/** The two parameters the author sets, and the range each slider covers. */
export const SHAKE_PARAMS = {
    intensity: { min: 1, max: 10, step: 1, default: 3 },
    speed: { min: 0.25, max: 4, step: 0.25, default: 1 },
} as const;

/** How far one step of intensity moves a character, as a share of the text's size. */
const AMPLITUDE_PER_INTENSITY_EM = 0.02;

/** How long one cycle of the jitter takes at speed 1. */
const CYCLE_SECONDS = 0.4;

const STYLE_ELEMENT_ID = "narraleaf-text-effects-shake";

/**
 * Five off-centre positions per cycle, scaled by `--nlfx-a`. The pattern is irregular on purpose: a
 * shake that traces a circle reads as a wobble.
 */
const STYLE_SHEET = `
@keyframes nlfx-shake {
    0% { transform: translate(0, 0); }
    20% { transform: translate(calc(var(--nlfx-a) * -0.8), calc(var(--nlfx-a) * 0.6)); }
    40% { transform: translate(calc(var(--nlfx-a) * 0.7), calc(var(--nlfx-a) * -0.9)); }
    60% { transform: translate(calc(var(--nlfx-a) * -0.5), calc(var(--nlfx-a) * -0.4)); }
    80% { transform: translate(calc(var(--nlfx-a) * 0.9), calc(var(--nlfx-a) * 0.7)); }
    100% { transform: translate(0, 0); }
}
@keyframes nlfx-enter {
    from { opacity: 0; }
    to { opacity: 1; }
}
.nlfx-shake {
    display: inline-block;
    white-space: pre;
    animation: nlfx-shake var(--nlfx-d) linear var(--nlfx-p) infinite;
}
.nlfx-shake.nlfx-enter {
    animation: nlfx-enter 0.18s ease-out, nlfx-shake var(--nlfx-d) linear var(--nlfx-p) infinite;
}
@media (prefers-reduced-motion: reduce) {
    .nlfx-shake, .nlfx-shake.nlfx-enter { animation: none; }
}
`;

function useShakeStyleSheet(ref: RefObject<HTMLElement | null>): void {
    useLayoutEffect(() => {
        const doc = ref.current?.ownerDocument;
        if (!doc || doc.getElementById(STYLE_ELEMENT_ID)) {
            return;
        }
        const style = doc.createElement("style");
        style.id = STYLE_ELEMENT_ID;
        style.textContent = STYLE_SHEET;
        doc.head.appendChild(style);
    }, [ref]);
}

function numberParam(value: unknown, range: { min: number; max: number; default: number }): number {
    const numeric = typeof value === "number" && Number.isFinite(value) ? value : range.default;
    return Math.min(range.max, Math.max(range.min, numeric));
}

/**
 * Where in the cycle a character starts, as a share of it. Spread by the golden ratio so neighbours
 * never move together, and fixed by position so a line drawn again shakes the same way.
 */
export function shakePhase(index: number): number {
    return (index * 0.618034) % 1;
}

type ShakeVars = CSSProperties & Record<"--nlfx-a" | "--nlfx-d", string>;

export function ShakeText(props: RuntimeInlineTextEffectRenderProps): ReactElement {
    const rootRef = useRef<HTMLSpanElement | null>(null);
    useShakeStyleSheet(rootRef);
    /**
     * How many characters were already there when the run first drew. Those arrive settled - a line
     * restored from a save, or one the player skipped to the end of - and only the ones typed out
     * afterwards fade in, as the characters around them do.
     */
    const settledRef = useRef<number | null>(null);
    if (settledRef.current === null) {
        settledRef.current = props.done || props.revealed ? Array.from(props.fullText).length : Array.from(props.text).length;
    }

    const intensity = numberParam(props.params.intensity, SHAKE_PARAMS.intensity);
    const speed = numberParam(props.params.speed, SHAKE_PARAMS.speed);
    const duration = CYCLE_SECONDS / speed;
    const vars: ShakeVars = {
        "--nlfx-a": `${(intensity * AMPLITUDE_PER_INTENSITY_EM).toFixed(3)}em`,
        "--nlfx-d": `${duration.toFixed(3)}s`,
    };

    // A reading sits over the whole word and vertical writing sets short runs upright inside it;
    // both are in the laid-out word the engine hands over, and splitting the characters out of it
    // would lose them. The word shakes as one piece instead.
    const writingMode = String(props.style.writingMode ?? "");
    if (props.hasRuby || writingMode.startsWith("vertical")) {
        return (
            <span ref={rootRef} className="nlfx-shake" style={{ ...vars, "--nlfx-p": "0s" } as CSSProperties}>
                {props.children}
            </span>
        );
    }

    const characters = Array.from(props.text);
    return (
        <span ref={rootRef} style={vars}>
            {characters.map((character, index) => (
                <span
                    key={index}
                    className={index >= (settledRef.current ?? 0) ? "nlfx-shake nlfx-enter" : "nlfx-shake"}
                    style={{ "--nlfx-p": `${(-shakePhase(index) * duration).toFixed(3)}s` } as CSSProperties}
                >
                    {character}
                </span>
            ))}
        </span>
    );
}
