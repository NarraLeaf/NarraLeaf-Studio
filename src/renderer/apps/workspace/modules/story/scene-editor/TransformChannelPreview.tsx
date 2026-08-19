import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import { STORY_CAMERA_LOOK_PRESETS } from "@/lib/ui-editor/runtime/game/cameraLookPresets";

/**
 * What a channel does to a picture, drawn at pick time.
 *
 * **Live CSS, not a rendered clip.** Every one of these channels IS a CSS declaration on a
 * displayable, so the honest preview is that declaration applied to a sample - which costs no
 * assets, follows the theme, works at any zoom, and cannot drift from what the channel does the way
 * a recorded GIF would the first time a value changes. The moving ones animate on hover rather than
 * looping: a grid of twenty tiles all cycling is a slot machine, and the one the pointer is on is
 * the only one being read.
 *
 * The sample is deliberately a stage and a subject rather than a photograph. A grade has to be
 * legible on something with a hue (`bg-primary` carries the brand cyan, which is what makes
 * grayscale, sepia and hue-rotate readable at 40px), and a clip or a mask only reads as a cut when
 * the thing being cut has an edge inside the frame.
 */

const TILE_CLASS = "relative h-8 w-12 shrink-0 overflow-hidden rounded-sm border border-edge bg-surface-sunken";

/** The subject: a lit shape on a dim stage, with enough hue for a grade to show. */
function Subject(props: { className?: string; style?: CSSProperties }) {
    return (
        <span
            className={cn("absolute left-1/2 top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-sm bg-primary", props.className)}
            style={props.style}
        />
    );
}

/** A horizon line, so a move or a zoom has something to be measured against. */
function Stage() {
    return <span className="absolute inset-x-0 bottom-1.5 h-px bg-edge-strong" aria-hidden="true" />;
}

const FILTER_SAMPLE: Record<string, string> = {
    blur: "blur(1.5px)",
    brightness: "brightness(1.7)",
    contrast: "contrast(2.2)",
    grayscale: "grayscale(1)",
    saturate: "saturate(2.5)",
    sepia: "sepia(1)",
    hueRotate: "hue-rotate(140deg)",
    invert: "invert(1)",
};

const GEOMETRY_SAMPLE: Record<string, CSSProperties> = {
    position: { transform: "translate(-125%, -50%)" },
    zoom: { transform: "translate(-50%, -50%) scale(1.45)" },
    scaleX: { transform: "translate(-50%, -50%) scaleX(0.5)" },
    scaleY: { transform: "translate(-50%, -50%) scaleY(0.5)" },
    rotation: { transform: "translate(-50%, -50%) rotate(28deg)" },
    opacity: { opacity: 0.3 },
};

const CLIP_SAMPLE: Record<string, string> = {
    clip: "inset(0 30% 0 0)",
    mask: "circle(46% at 50% 50%)",
    circleReveal: "circle(38% at 50% 50%)",
    circleClose: "circle(70% at 50% 50%)",
    wipe: "inset(0 45% 0 0)",
};

function lookCss(presetId: string): string | undefined {
    const preset = STORY_CAMERA_LOOK_PRESETS.find(entry => entry.id === presetId);
    return preset ? preset.build(preset.defaultIntensity) : undefined;
}

/**
 * The one channel that IS an animation, so its tile plays rather than poses.
 *
 * Driven from hover state and inline styles rather than a keyframe in `styles.css`: it is a
 * transition, which means `ui.reduceMotion` degrades it to a snap between the two ends on its own,
 * and both ends are legible. A looping keyframe would have had to be marked `nl-motion-keep` to
 * survive that setting, and a preview grid that keeps moving after the reader asked it not to is
 * exactly what the setting is for.
 */
function RevealPreview(props: { className?: string }) {
    const [open, setOpen] = useState(false);
    return (
        <span
            className={cn(TILE_CLASS, props.className)}
            aria-hidden="true"
            onPointerEnter={() => setOpen(true)}
            onPointerLeave={() => setOpen(false)}
        >
            <Stage />
            <Subject
                style={{
                    clipPath: open ? CLIP_SAMPLE.circleClose : CLIP_SAMPLE.circleReveal,
                    transition: "clip-path 300ms ease-out",
                }}
            />
        </span>
    );
}

/**
 * The tile for one channel id, or for one grade when `lookPreset` names it.
 *
 * Unknown ids get the neutral sample rather than nothing: a channel added to the vocabulary without
 * a sample here still shows a subject, so the picker reads as complete while the tile is the thing
 * that is missing.
 */
export function TransformChannelPreview(props: { channelId: string; lookPreset?: string; className?: string }) {
    const { channelId } = props;

    if (props.lookPreset) {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject style={{ filter: lookCss(props.lookPreset) }} />
            </span>
        );
    }

    // A restore puts the channel back, so its tile is the neutral subject - the absence of a look,
    // which is exactly what the channel writes.
    if (channelId.startsWith("clear.")) {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject className="opacity-40" />
                <Subject />
            </span>
        );
    }

    if (channelId.startsWith("filter.")) {
        const fn = channelId.slice("filter.".length);
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject style={{ filter: FILTER_SAMPLE[fn] }} />
            </span>
        );
    }

    if (channelId in GEOMETRY_SAMPLE) {
        // Static, and the horizon is what makes it readable: a subject sitting left of centre says
        // "position" without having to move, and a tile that moved would only be legible while the
        // pointer happened to be on it.
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject className="opacity-25" />
                <Subject style={GEOMETRY_SAMPLE[channelId]} />
            </span>
        );
    }

    if (channelId === "look") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject style={{ filter: lookCss(STORY_CAMERA_LOOK_PRESETS[0]?.id ?? "") }} />
            </span>
        );
    }

    if (channelId === "blend") {
        // Two overlapping subjects, because a blend mode is a relationship and one shape cannot show
        // one: what the tile has to say is that this channel is about what is BEHIND the object.
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <span className="absolute left-2 top-1/2 h-5 w-5 -translate-y-1/2 rounded-sm bg-warning" />
                <span className="absolute right-2 top-1/2 h-5 w-5 -translate-y-1/2 rounded-sm bg-primary" style={{ mixBlendMode: "screen" }} />
            </span>
        );
    }

    if (channelId === "backdrop") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject />
                <span className="absolute inset-x-0 bottom-0 h-3 bg-fill" style={{ backdropFilter: "blur(2px)" }} />
            </span>
        );
    }

    if (channelId === "reveal") {
        return <RevealPreview className={props.className} />;
    }

    if (channelId in CLIP_SAMPLE) {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject style={{ clipPath: CLIP_SAMPLE[channelId] }} />
            </span>
        );
    }

    if (channelId === "filterRaw") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject style={{ filter: "drop-shadow(0 0 3px currentColor) saturate(1.6)" }} />
            </span>
        );
    }

    if (channelId === "fontColor") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <span className="absolute inset-0 grid place-items-center text-sm font-medium text-primary">A</span>
            </span>
        );
    }

    if (channelId === "delayMs" || channelId === "repeat" || channelId === "repeatDelayMs") {
        // Timing is not a look, so the tile shows the only thing it can honestly show: the subject
        // arriving late, or arriving twice.
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject className="h-4 w-4 opacity-20" style={{ transform: "translate(-115%, -50%)" }} />
                <Subject className="h-4 w-4 opacity-45" style={{ transform: "translate(-50%, -50%)" }} />
                <Subject className="h-4 w-4" style={{ transform: "translate(15%, -50%)" }} />
            </span>
        );
    }

    return (
        <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
            <Stage />
            <Subject />
        </span>
    );
}
