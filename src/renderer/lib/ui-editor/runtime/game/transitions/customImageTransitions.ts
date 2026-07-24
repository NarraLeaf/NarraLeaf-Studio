import { ImageTransition, Transition } from "narraleaf-react";
import type { CSSProperties } from "react";

/**
 * The one {@link ImageTransition} Studio still ships itself, after the 0.16.0 migration folded the
 * rest (soft wipe, blinds, soft iris, blur dissolve, through-colour) into the engine's native
 * `Reveal`/`ThroughColor` + `Mask` vocabulary.
 *
 * `Slide` stays custom **only** because the engine's native `Push` translates the layer in viewport
 * units (`vw`/`vh`), while the transition stack wrapper it drives is `inset: 0` inside the
 * letterboxed stage box (see NLR `Image.tsx` `stackStyle`). Whenever the window aspect differs from
 * the design aspect - which includes the Studio Dev Mode preview at almost any panel size - a
 * `100vw`/`100vh` travel overshoots the stage, so both images sit off-stage mid-slide and expose the
 * backdrop. Percentages of the layer's *own* size are the identity at offset 0 and never overshoot,
 * which is what this class uses. Delete it and migrate `slide` → native `Push` once the engine's
 * `Push` is fixed to translate in `%` (tracked in the 0.16.0 migration report).
 */

/** Runtime value of `TransitionAnimationType.Number` (a single numeric channel). */
const NUMBER = Transition.AnimationType.Number;

type NumberChannel = [typeof Transition.AnimationType.Number];
type ImageTransitionTask = ReturnType<ImageTransition<NumberChannel>["createTask"]>;
type AnimationChannel = ImageTransitionTask["animations"][number];

export type WipeDirection = "left" | "right" | "top" | "bottom";

type Easing = AnimationChannel["ease"];

/** Clamp helper kept local so resolvers stay pure. */
function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Build the standard single 0 → 1 numeric channel. */
function unitChannel(duration: number, easing: Easing): AnimationChannel {
    return { type: NUMBER, start: 0, end: 1, duration, ease: easing };
}

/**
 * A push / slide: the incoming image slides in from one edge while the outgoing image slides out the
 * opposite way, as if the camera panned. `direction` is the direction the outgoing image travels
 * toward.
 *
 * The offset is applied via the independent CSS `translate` property (not `transform`) in percentages
 * of the layer's own size. That composes additively with whatever base positioning NLR gives the
 * layer instead of overriding it, and at offset `0` it is the identity - so neither image jumps at
 * the start/end of the slide, regardless of how the background is anchored. Percentages (not viewport
 * units!) matter - see the class-level note above.
 */
export class Slide extends ImageTransition<NumberChannel> {
    constructor(
        private readonly duration: number,
        private readonly direction: WipeDirection = "left",
        private readonly easing?: Easing,
    ) {
        super();
    }

    private axisSign(): { axis: "x" | "y"; sign: number } {
        switch (this.direction) {
            case "right":
                return { axis: "x", sign: 1 };
            case "top":
                return { axis: "y", sign: -1 };
            case "bottom":
                return { axis: "y", sign: 1 };
            case "left":
            default:
                return { axis: "x", sign: -1 };
        }
    }

    private translate(offset: number): CSSProperties {
        const { axis } = this.axisSign();
        const value = `${offset}%`;
        return { translate: axis === "x" ? `${value} 0px` : `0px ${value}` } as CSSProperties;
    }

    createTask(): ImageTransitionTask {
        const { sign } = this.axisSign();
        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                // Outgoing image slides from rest out toward `direction` (offset 0 → ±100).
                this.asPrev<NumberChannel>((t: number) => ({ style: this.translate(sign * 100 * clamp01(t)) })),
                // Incoming image slides in from the opposite edge to rest (∓100 → offset 0).
                this.asTarget<NumberChannel>((t: number) => ({ style: this.translate(-sign * 100 * (1 - clamp01(t))) })),
            ],
        };
    }

    copy(): Slide {
        return new Slide(this.duration, this.direction, this.easing);
    }
}
