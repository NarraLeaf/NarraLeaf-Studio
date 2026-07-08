import { ImageTransition, Transition } from "narraleaf-react";
import type { CSSProperties } from "react";

/**
 * Custom {@link ImageTransition} implementations that fill the gaps in the
 * transitions NarraLeaf-React ships out of the box.
 *
 * NLR's built-in `MaskTransition.wipe`/`.circle` animate a hard `clip-path`
 * (`inset()`/`circle()`) — there is no feathering, which is why the stock wipe
 * reads as a hard geometric cut rather than a soft erase. NLR does, however,
 * pass any resolver `style` straight onto the layer element and its render
 * pipeline whitelists `mask-image`, so a genuinely soft (feathered) wipe and
 * classic venetian "blinds" are expressible as animated CSS gradient masks.
 *
 * A transition declares a set of single `start → end` animation channels plus
 * resolvers tagged {@link ImageTransition.asPrev} ("current"/outgoing) and
 * {@link ImageTransition.asTarget} ("target"/incoming). Every resolver becomes
 * its own stacked, independently-keyed layer sharing one progress clock; later
 * entries render on top. `asPrev`/`asTarget` auto-merge the correct image `src`
 * into the resolver output, so a resolver only needs to return `style`.
 */

// A single 1×1 transparent pixel; used as the `src` for the synthetic black
// slat layer of the blackout transition (its visible colour comes from
// `backgroundColor`, masked into slats).
const TRANSPARENT_PIXEL =
    "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

/** Runtime value of `TransitionAnimationType.Number` (a single numeric channel). */
const NUMBER = Transition.AnimationType.Number;

// NLR does not re-export the transition value/type helpers from its public
// entrypoint, so we recover the shapes we need structurally: a one-channel
// numeric animation, and the corresponding `TransitionTask` return type.
type NumberChannel = [typeof Transition.AnimationType.Number];
type ImageTransitionTask = ReturnType<ImageTransition<NumberChannel>["createTask"]>;
type AnimationChannel = ImageTransitionTask["animations"][number];

export type WipeDirection = "left" | "right" | "top" | "bottom";
export type BlindsOrientation = "horizontal" | "vertical";

type Easing = AnimationChannel["ease"];

/** Clamp helper kept local so resolvers stay pure. */
function clamp01(value: number): number {
    return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** Build the standard single 0 → 1 numeric channel every transition below uses. */
function unitChannel(duration: number, easing: Easing): AnimationChannel {
    return { type: NUMBER, start: 0, end: 1, duration, ease: easing };
}

/** The `mask-image` triplet, mirrored to the `-webkit-` prefix for Safari/WebKit. */
function maskStyle(image: string): CSSProperties {
    return {
        maskImage: image,
        WebkitMaskImage: image,
        maskSize: "100% 100%",
        WebkitMaskSize: "100% 100%",
        maskRepeat: "no-repeat",
        WebkitMaskRepeat: "no-repeat",
    } as CSSProperties;
}

/** CSS gradient direction keyword for a wipe travelling toward `direction`. */
function wipeGradientDir(direction: WipeDirection): string {
    switch (direction) {
        case "left":
            return "to left";
        case "top":
            return "to top";
        case "bottom":
            return "to bottom";
        case "right":
        default:
            return "to right";
    }
}

/** Gradient axis for blinds slats of a given orientation. */
function blindsAxis(orientation: BlindsOrientation): string {
    // Horizontal slats stack vertically → the gradient runs top-to-bottom.
    return orientation === "vertical" ? "to right" : "to bottom";
}

/**
 * A soft, feathered directional wipe. The incoming image is revealed over the
 * outgoing one through a moving `linear-gradient` alpha mask whose transition
 * band has width `feather` (in %), giving a gradual erase rather than a hard cut.
 */
export class SoftWipe extends ImageTransition<NumberChannel> {
    constructor(
        private readonly duration: number,
        private readonly direction: WipeDirection = "left",
        private readonly feather: number = 12,
        private readonly easing?: Easing,
    ) {
        super();
    }

    createTask(): ImageTransitionTask {
        const dir = wipeGradientDir(this.direction);
        const feather = Math.max(0, this.feather);
        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                this.asPrev<NumberChannel>(() => ({})),
                this.asTarget<NumberChannel>((t: number) => {
                    // Sweep the black (opaque → visible) edge from just before the
                    // start to just past the end so the reveal is total at t=0/1.
                    const edge = -feather + clamp01(t) * (100 + feather);
                    const image = `linear-gradient(${dir}, #000 ${edge}%, transparent ${edge + feather}%)`;
                    return { style: maskStyle(image) };
                }),
            ],
        };
    }

    copy(): SoftWipe {
        return new SoftWipe(this.duration, this.direction, this.feather, this.easing);
    }
}

/**
 * Classic venetian "blinds" (百叶窗): the incoming image is revealed over the
 * outgoing one through `slats` hard-edged bars that widen until they cover the
 * frame. Orientation selects horizontal or vertical slats.
 */
export class Blinds extends ImageTransition<NumberChannel> {
    constructor(
        private readonly duration: number,
        private readonly orientation: BlindsOrientation = "horizontal",
        private readonly slats: number = 8,
        private readonly easing?: Easing,
    ) {
        super();
    }

    createTask(): ImageTransitionTask {
        const axis = blindsAxis(this.orientation);
        const pitch = 100 / Math.max(1, this.slats);
        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                this.asPrev<NumberChannel>(() => ({})),
                this.asTarget<NumberChannel>((t: number) => {
                    const cover = clamp01(t) * pitch;
                    const image = `repeating-linear-gradient(${axis}, #000 0, #000 ${cover}%, transparent ${cover}%, transparent ${pitch}%)`;
                    return { style: maskStyle(image) };
                }),
            ],
        };
    }

    copy(): Blinds {
        return new Blinds(this.duration, this.orientation, this.slats, this.easing);
    }
}

/**
 * Blinds with a black hold (百叶窗黑屏). A dedicated opaque-black slat layer
 * closes over the outgoing image, holds a fully black frame, then opens to
 * reveal the incoming image — so the target background never appears until
 * after the black. `hold` is the fraction (0–1) of the duration spent fully
 * black; the outgoing/incoming images simply cross under the black at the
 * midpoint, invisible behind it.
 */
export class BlindsBlackout extends ImageTransition<NumberChannel> {
    constructor(
        private readonly duration: number,
        private readonly orientation: BlindsOrientation = "horizontal",
        private readonly slats: number = 8,
        private readonly hold: number = 0.3,
        private readonly easing?: Easing,
    ) {
        super();
    }

    createTask(): ImageTransitionTask {
        const axis = blindsAxis(this.orientation);
        const pitch = 100 / Math.max(1, this.slats);
        const hold = clamp01(this.hold);
        const closeEnd = (1 - hold) / 2; // slats fully shut by here
        const openStart = 1 - closeEnd; // slats begin to open here
        const mid = 0.5; // fully black window → swap the images here, unseen

        // Fraction (0–1) of a slat's pitch currently painted black.
        const coverAt = (t: number): number => {
            if (t <= closeEnd) return closeEnd <= 0 ? 1 : t / closeEnd;
            if (t >= openStart) return openStart >= 1 ? 1 : (1 - t) / (1 - openStart);
            return 1;
        };

        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                // Outgoing image: visible until the frame is fully black, then gone.
                this.asPrev<NumberChannel>((t: number) => ({ style: { opacity: t < mid ? 1 : 0 } as CSSProperties })),
                // Incoming image: swapped in behind the black, revealed as it opens.
                this.asTarget<NumberChannel>((t: number) => ({ style: { opacity: t < mid ? 0 : 1 } as CSSProperties })),
                // Black venetian slats on top: close → hold → open.
                (t: number) => {
                    const cover = clamp01(coverAt(t)) * pitch;
                    const image = `repeating-linear-gradient(${axis}, #000 0, #000 ${cover}%, transparent ${cover}%, transparent ${pitch}%)`;
                    return {
                        src: TRANSPARENT_PIXEL,
                        style: {
                            position: "absolute",
                            top: "50%",
                            left: "50%",
                            width: "100%",
                            height: "100%",
                            transform: "translate(-50%, -50%)",
                            backgroundColor: "#000",
                            ...maskStyle(image),
                        } as CSSProperties,
                    };
                },
            ],
        };
    }

    copy(): BlindsBlackout {
        return new BlindsBlackout(this.duration, this.orientation, this.slats, this.hold, this.easing);
    }
}

/**
 * A push / slide: the incoming image slides in from one edge while the outgoing
 * image slides out the opposite way, as if the camera panned. `direction` is
 * the direction the outgoing image travels toward. Distances use viewport units
 * so the slide spans the whole screen regardless of the fitted image size, and
 * the base `translate(-50%, -50%)` centring is preserved.
 */
export class Slide extends ImageTransition<NumberChannel> {
    constructor(
        private readonly duration: number,
        private readonly direction: WipeDirection = "left",
        private readonly easing?: Easing,
    ) {
        super();
    }

    private axisUnit(): { axis: "x" | "y"; unit: "vw" | "vh"; sign: number } {
        switch (this.direction) {
            case "right":
                return { axis: "x", unit: "vw", sign: 1 };
            case "top":
                return { axis: "y", unit: "vh", sign: -1 };
            case "bottom":
                return { axis: "y", unit: "vh", sign: 1 };
            case "left":
            default:
                return { axis: "x", unit: "vw", sign: -1 };
        }
    }

    private translate(offset: string): CSSProperties {
        const { axis } = this.axisUnit();
        const x = axis === "x" ? `calc(-50% + ${offset})` : "-50%";
        const y = axis === "y" ? `calc(-50% + ${offset})` : "-50%";
        return { transform: `translate(${x}, ${y})` } as CSSProperties;
    }

    createTask(): ImageTransitionTask {
        const { unit, sign } = this.axisUnit();
        const span = 100 * sign; // outgoing travels a full viewport toward `direction`
        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                // Outgoing image slides from centre out toward `direction`.
                this.asPrev<NumberChannel>((t: number) => ({ style: this.translate(`${span * clamp01(t)}${unit}`) })),
                // Incoming image slides in from the opposite edge to centre.
                this.asTarget<NumberChannel>((t: number) => ({ style: this.translate(`${-span * (1 - clamp01(t))}${unit}`) })),
            ],
        };
    }

    copy(): Slide {
        return new Slide(this.duration, this.direction, this.easing);
    }
}
