import { ImageTransition, Transition } from "narraleaf-react";
import type { CSSProperties } from "react";

/**
 * Custom {@link ImageTransition} implementations that fill the gaps in the
 * transitions NarraLeaf-React ships out of the box.
 *
 * NLR's built-in `MaskTransition.wipe`/`.circle` animate a hard `clip-path`
 * (`inset()`/`circle()`) - there is no feathering, which is why the stock wipe
 * reads as a hard geometric cut rather than a soft erase. NLR does, however,
 * pass any resolver `style` straight onto the layer element and its render
 * pipeline whitelists `mask-image`/`filter`, so a genuinely soft (feathered)
 * wipe, venetian "blinds", a blur dissolve and a colour-hold ("through black")
 * transition are all expressible as animated CSS masks/filters.
 *
 * A transition declares a set of single `start → end` animation channels plus
 * resolvers tagged {@link ImageTransition.asPrev} ("current"/outgoing) and
 * {@link ImageTransition.asTarget} ("target"/incoming). Every resolver becomes
 * its own stacked, independently-keyed layer sharing one progress clock; later
 * entries render on top. `asPrev`/`asTarget` auto-merge the correct image `src`
 * into the resolver output, so a resolver only needs to return `style`.
 */

// A single 1×1 transparent pixel; used as the `src` for synthetic colour
// overlay layers (their visible colour comes from `backgroundColor`, optionally
// masked into a shape).
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
export type ThroughColorPattern = "plain" | "linear" | "blinds" | "iris";

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

// ---- Shared mask generators (progress/coverage ∈ [0,1]) --------------------

/** Feathered linear wipe: `progress` 0 → fully hidden, 1 → fully covered. */
function linearWipeMask(direction: WipeDirection, feather: number, progress: number): string {
    const f = Math.max(0, feather);
    // Sweep the opaque edge from just before the start to just past the end so
    // the reveal is total at the extremes.
    const edge = -f + clamp01(progress) * (100 + f);
    return `linear-gradient(${wipeGradientDir(direction)}, #000 ${edge}%, transparent ${edge + f}%)`;
}

/** Venetian slats: `progress` 0 → open (hidden), 1 → shut (covered). */
function blindsCoverMask(orientation: BlindsOrientation, slats: number, progress: number): string {
    const pitch = 100 / Math.max(1, slats);
    const cover = clamp01(progress) * pitch;
    return `repeating-linear-gradient(${blindsAxis(orientation)}, #000 0, #000 ${cover}%, transparent ${cover}%, transparent ${pitch}%)`;
}

/** Iris that *covers* from the rim inward: `progress` 0 → hidden, 1 → covered. */
function irisCoverMask(center: string, feather: number, progress: number): string {
    const f = Math.max(0, feather);
    const r = (1 - clamp01(progress)) * 150; // transparent hole shrinks to nothing
    return `radial-gradient(circle at ${center}, transparent ${r - f}%, #000 ${r}%)`;
}

/** Iris that *reveals* from the centre out: `progress` 0 → hidden, 1 → shown. */
function irisRevealMask(center: string, feather: number, progress: number): string {
    const f = Math.max(0, feather);
    const r = clamp01(progress) * 150; // opaque disc grows to cover
    return `radial-gradient(circle at ${center}, #000 ${r - f}%, transparent ${r}%)`;
}

/** Full-bleed positioning for a synthetic overlay `<img>` layer. */
function overlayBase(color: string): CSSProperties {
    return {
        position: "absolute",
        top: "50%",
        left: "50%",
        width: "100%",
        height: "100%",
        transform: "translate(-50%, -50%)",
        backgroundColor: color,
    } as CSSProperties;
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
        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                this.asPrev<NumberChannel>(() => ({})),
                this.asTarget<NumberChannel>((t: number) => ({
                    style: maskStyle(linearWipeMask(this.direction, this.feather, t)),
                })),
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
        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                this.asPrev<NumberChannel>(() => ({})),
                this.asTarget<NumberChannel>((t: number) => ({
                    style: maskStyle(blindsCoverMask(this.orientation, this.slats, t)),
                })),
            ],
        };
    }

    copy(): Blinds {
        return new Blinds(this.duration, this.orientation, this.slats, this.easing);
    }
}

/**
 * A soft, feathered iris: the incoming image is revealed over the outgoing one
 * through an expanding `radial-gradient` circle with a feathered edge - the
 * soft-edged counterpart of NLR's hard `MaskTransition.circle`.
 */
export class SoftIris extends ImageTransition<NumberChannel> {
    constructor(
        private readonly duration: number,
        private readonly center: string = "50% 50%",
        private readonly feather: number = 12,
        private readonly easing?: Easing,
    ) {
        super();
    }

    createTask(): ImageTransitionTask {
        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                this.asPrev<NumberChannel>(() => ({})),
                this.asTarget<NumberChannel>((t: number) => ({
                    style: maskStyle(irisRevealMask(this.center, this.feather, t)),
                })),
            ],
        };
    }

    copy(): SoftIris {
        return new SoftIris(this.duration, this.center, this.feather, this.easing);
    }
}

/**
 * A blur dissolve: the outgoing image blurs out and fades while the incoming
 * one sharpens in - the dreamy crossfade used for flashbacks / dream states.
 */
export class BlurDissolve extends ImageTransition<NumberChannel> {
    constructor(
        private readonly duration: number,
        private readonly blur: number = 16,
        private readonly easing?: Easing,
    ) {
        super();
    }

    createTask(): ImageTransitionTask {
        const max = Math.max(0, this.blur);
        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                this.asPrev<NumberChannel>((t: number) => ({
                    style: { opacity: 1 - clamp01(t), filter: `blur(${max * clamp01(t)}px)` } as CSSProperties,
                })),
                this.asTarget<NumberChannel>((t: number) => ({
                    style: { opacity: clamp01(t), filter: `blur(${max * (1 - clamp01(t))}px)` } as CSSProperties,
                })),
            ],
        };
    }

    copy(): BlurDissolve {
        return new BlurDissolve(this.duration, this.blur, this.easing);
    }
}

/** Per-pattern options for {@link ThroughColor}; each pattern reads only its own. */
export type ThroughColorOptions = {
    direction?: WipeDirection;
    feather?: number;
    orientation?: BlindsOrientation;
    slats?: number;
    center?: string;
};

/**
 * The "through colour" engine (过色 / 黑场). A dedicated colour overlay covers
 * the frame using the chosen `pattern`, holds a solid-colour frame, then
 * uncovers to reveal the incoming image - so the target never appears until
 * after the colour hold. The outgoing/incoming images simply swap opacity at
 * the midpoint, unseen behind the fully-covered frame.
 *
 * `pattern` selects how the colour covers:
 * - `plain`  - the overlay fades in/out          → fade through black/white, flash (hold ≈ 0)
 * - `linear` - a feathered directional edge       → soft wipe through black
 * - `blinds` - venetian slats                     → blinds black hold
 * - `iris`   - a circle closing from the rim in    → iris to black
 *
 * `color` is the hold colour (black, white, any tint) and `hold` is the
 * fraction (0–1) of the duration spent fully covered.
 */
export class ThroughColor extends ImageTransition<NumberChannel> {
    constructor(
        private readonly duration: number,
        private readonly pattern: ThroughColorPattern = "plain",
        private readonly color: string = "#000",
        private readonly hold: number = 0.3,
        private readonly options: ThroughColorOptions = {},
        private readonly easing?: Easing,
    ) {
        super();
    }

    /** Style for the colour overlay at a given coverage (0 = clear, 1 = fully covered). */
    private coverStyle(cover: number): CSSProperties {
        const base = overlayBase(this.color);
        if (this.pattern === "plain") {
            return { ...base, opacity: clamp01(cover) } as CSSProperties;
        }
        let mask: string;
        if (this.pattern === "linear") {
            mask = linearWipeMask(this.options.direction ?? "left", this.options.feather ?? 12, cover);
        } else if (this.pattern === "blinds") {
            mask = blindsCoverMask(this.options.orientation ?? "horizontal", this.options.slats ?? 8, cover);
        } else {
            mask = irisCoverMask(this.options.center ?? "50% 50%", this.options.feather ?? 12, cover);
        }
        return { ...base, opacity: 1, ...maskStyle(mask) } as CSSProperties;
    }

    createTask(): ImageTransitionTask {
        const hold = clamp01(this.hold);
        const closeEnd = (1 - hold) / 2; // fully covered by here
        const openStart = 1 - closeEnd; // starts uncovering here
        const mid = 0.5; // fully covered window → swap the images here, unseen

        // Coverage (0–1) of the colour overlay: cover → hold → uncover.
        const coverAt = (t: number): number => {
            if (t <= closeEnd) return closeEnd <= 0 ? 1 : t / closeEnd;
            if (t >= openStart) return openStart >= 1 ? 1 : (1 - t) / (1 - openStart);
            return 1;
        };

        return {
            animations: [unitChannel(this.duration, this.easing)],
            resolve: [
                // Outgoing image: visible until the frame is fully covered, then gone.
                this.asPrev<NumberChannel>((t: number) => ({ style: { opacity: t < mid ? 1 : 0 } as CSSProperties })),
                // Incoming image: swapped in behind the colour, revealed as it uncovers.
                this.asTarget<NumberChannel>((t: number) => ({ style: { opacity: t < mid ? 0 : 1 } as CSSProperties })),
                // Colour overlay on top: cover → hold → uncover.
                (t: number) => ({ src: TRANSPARENT_PIXEL, style: this.coverStyle(coverAt(t)) }),
            ],
        };
    }

    copy(): ThroughColor {
        return new ThroughColor(this.duration, this.pattern, this.color, this.hold, this.options, this.easing);
    }
}

/**
 * A push / slide: the incoming image slides in from one edge while the outgoing
 * image slides out the opposite way, as if the camera panned. `direction` is
 * the direction the outgoing image travels toward.
 *
 * The offset is applied via the independent CSS `translate` property (not
 * `transform`) in percentages of the layer's own size. That composes additively
 * with whatever base positioning NLR gives the layer instead of overriding it,
 * and at offset `0` it is the identity - so neither image jumps at the
 * start/end of the slide, regardless of how the background is anchored.
 * Percentages (not viewport units!) matter: the transition layers live inside
 * the letterboxed stage box, so whenever the window aspect differs from the
 * design aspect a `100vw`/`100vh` travel overshoots or undershoots the stage
 * and both images sit off-stage mid-slide, exposing the backdrop.
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
