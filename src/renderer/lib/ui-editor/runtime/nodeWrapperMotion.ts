import { animate, buildTransform, motionValue, type AnimationPlaybackControls, type MotionValue } from "motion/react";

/**
 * The channels an element's node wrapper moves on: where it is placed, its pose, and its opacity.
 *
 * Kept as motion values only once something animates them. Until then the wrapper is a plain `div`
 * whose style React writes - see `EditorNodeWrapper` for why that split exists at all.
 */
export type NodeWrapperChannel = "left" | "top" | "x" | "y" | "scale" | "rotate" | "opacity";

export type NodeWrapperPose = Readonly<Record<NodeWrapperChannel, number>>;

export type NodeWrapperTransition = Record<string, unknown>;

const CHANNELS: readonly NodeWrapperChannel[] = ["left", "top", "x", "y", "scale", "rotate", "opacity"];

/**
 * The channels a reduced-motion setting makes instant: motion's own rule for an element, which skips
 * positional values (placement and transforms) and still fades opacity.
 */
const POSITIONAL_CHANNELS: ReadonlySet<NodeWrapperChannel> = new Set(["left", "top", "x", "y", "scale", "rotate"]);

/**
 * The transform a pose draws as - motion's own builder, so a wrapper at rest reads exactly what a
 * motion-rendered one did: `none` for the identity pose, and otherwise the same functions in the same
 * order with the same units.
 */
export function nodeWrapperTransform(pose: { x: number; y: number; scale: number; rotate: number }): string {
    return buildTransform({ x: pose.x, y: pose.y, scale: pose.scale, rotate: pose.rotate }, {});
}

export function isNodeWrapperChannel(key: string): key is NodeWrapperChannel {
    return (CHANNELS as readonly string[]).includes(key);
}

/**
 * Writes an animating node wrapper's channels to its DOM node.
 *
 * A `motion.div` gives every element a visual element, a projection node, a feature set and a share
 * of the frame loop - most of what one element cost to mount, paid by every element on a page for the
 * few a blueprint ever moves. This keeps the same motion values and runs the same animations through
 * motion's own `animate`, and differs only in who writes the result: each channel is written to the
 * node as it changes, which is what the visual element did with it. It is created the first time a
 * wrapper has to animate and kept for the wrapper's life after that.
 *
 * The opacity and transform channels are written only once this owns them - before that, React writes
 * them from the wrapper's style, exactly as it did beside a visual element that held no value for them.
 */
export class NodeWrapperMotionDriver {
    private readonly values: Record<NodeWrapperChannel, MotionValue<number>>;
    private readonly unsubscribers: (() => void)[] = [];
    private node: HTMLElement | null = null;
    private ownsTransform = false;
    private ownsOpacity = false;
    /** Channels a displayable motion has animated; their rest values stop following the props. */
    private readonly animatedByMotion = new Set<NodeWrapperChannel>();

    constructor(initial: NodeWrapperPose) {
        const values = {} as Record<NodeWrapperChannel, MotionValue<number>>;
        for (const channel of CHANNELS) {
            values[channel] = motionValue(initial[channel]);
            this.unsubscribers.push(values[channel].on("change", () => this.write(channel)));
        }
        this.values = values;
    }

    attach(node: HTMLElement | null): void {
        this.node = node;
        this.writeAll();
    }

    get(channel: NodeWrapperChannel): number {
        return this.values[channel].get();
    }

    set(channel: NodeWrapperChannel, value: number): void {
        this.values[channel].set(value);
    }

    /** Whether a displayable motion has ever animated this channel. */
    hasMotionAnimated(channel: NodeWrapperChannel): boolean {
        return this.animatedByMotion.has(channel);
    }

    takeTransform(): void {
        if (!this.ownsTransform) {
            this.ownsTransform = true;
            this.writeTransform();
        }
    }

    takeOpacity(): void {
        if (!this.ownsOpacity) {
            this.ownsOpacity = true;
            this.write("opacity");
        }
    }

    ownsOpacityChannel(): boolean {
        return this.ownsOpacity;
    }

    /** One channel to a target, as `animate(value, target, transition)` on its motion value. */
    animateChannel(channel: NodeWrapperChannel, target: number, transition: NodeWrapperTransition): AnimationPlaybackControls {
        return animate(this.values[channel], target, transition);
    }

    /**
     * Sets every channel the target names at once - what animation controls' `set` did.
     *
     * Unknown keys are ignored, as they were never part of the wrapper's pose.
     */
    setTarget(target: Readonly<Record<string, number>>): void {
        for (const [key, value] of Object.entries(target)) {
            if (isNodeWrapperChannel(key)) {
                if (key === "opacity") {
                    this.takeOpacity();
                }
                this.values[key].set(value);
            }
        }
    }

    /**
     * Animates every channel the target names with one transition, resolving once all of them have
     * finished or been stopped - what animation controls' `start` did.
     *
     * Reduced motion makes positional channels jump, matching motion's rule for an element.
     */
    start(
        target: Readonly<Record<string, number | number[]>>,
        transition: NodeWrapperTransition | undefined,
        reduceMotion: boolean,
    ): Promise<void> {
        const animations: AnimationPlaybackControls[] = [];
        for (const [key, value] of Object.entries(target)) {
            if (value === undefined || !isNodeWrapperChannel(key)) {
                continue;
            }
            if (key === "opacity") {
                this.takeOpacity();
            }
            this.animatedByMotion.add(key);
            const valueTransition =
                reduceMotion && POSITIONAL_CHANNELS.has(key) ? { type: false } : { delay: 0, ...(transition ?? {}) };
            animations.push(animate(this.values[key], value, valueTransition as NodeWrapperTransition));
        }
        return Promise.all(animations).then(() => undefined);
    }

    /** Stops whatever is moving any channel, leaving each where it got to - controls' `stop`. */
    stop(): void {
        for (const channel of CHANNELS) {
            this.values[channel].stop();
        }
    }

    dispose(): void {
        this.stop();
        for (const unsubscribe of this.unsubscribers.splice(0)) {
            unsubscribe();
        }
        this.node = null;
    }

    writeAll(): void {
        this.write("left");
        this.write("top");
        this.write("opacity");
        this.writeTransform();
    }

    private write(channel: NodeWrapperChannel): void {
        const node = this.node;
        if (!node) {
            return;
        }
        switch (channel) {
            case "left":
                node.style.left = `${this.values.left.get()}px`;
                return;
            case "top":
                node.style.top = `${this.values.top.get()}px`;
                return;
            case "opacity":
                if (this.ownsOpacity) {
                    // Clamped the way motion writes an alpha, so a spring overshooting 1 draws as 1.
                    node.style.opacity = String(Math.min(1, Math.max(0, this.values.opacity.get())));
                }
                return;
            default:
                this.writeTransform();
        }
    }

    private writeTransform(): void {
        if (this.node && this.ownsTransform) {
            this.node.style.transform = nodeWrapperTransform({
                x: this.values.x.get(),
                y: this.values.y.get(),
                scale: this.values.scale.get(),
                rotate: this.values.rotate.get(),
            });
        }
    }
}
