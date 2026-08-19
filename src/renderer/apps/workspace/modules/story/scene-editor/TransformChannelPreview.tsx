import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import { STORY_CAMERA_LOOK_PRESETS } from "@/lib/ui-editor/runtime/game/cameraLookPresets";

/**
 * What a channel does to a picture, drawn at pick time.
 *
 * **Live CSS, not a rendered clip.** Every one of these channels IS a CSS declaration on a
 * displayable, so the honest preview is that declaration applied to a sample - which costs no
 * assets, follows the theme, works at any zoom, and cannot drift from what the channel does the way
 * a recorded GIF would the first time a value changes.
 *
 * **The sample is artwork, not a colour swatch.** A flat block only ever says "the colour changed":
 * sepia, saturate and hue-rotate all read as *some* shift and none of them reads as what it does to
 * a face. A portrait has skin, hair, line work and a highlight, so a grade lands on material an
 * author recognises - and the difference between grayscale and desaturate is visible at 24px, which
 * on a swatch it is not.
 *
 * Where the row transforms something that HAS a picture, that picture is the sample
 * ({@link TransformChannelPreviewProps.imageUrl}); otherwise it falls back to the bundled portrait,
 * because the picker has to work in a project with no art in it at all.
 */

const FALLBACK_SUBJECT_URL = "/img/narraleaf-studio/narra-avatar.png";

const TILE_CLASS = "relative h-8 w-12 shrink-0 overflow-hidden rounded-sm border border-edge bg-surface-sunken";

const SUBJECT_CLASS = "absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 bg-contain bg-center bg-no-repeat";

type SubjectProps = { url: string; className?: string; style?: CSSProperties };

/** The thing being transformed. Sized to the tile's height, so a crop or a mask has an edge to cut. */
function Subject(props: SubjectProps) {
    return (
        <span
            className={cn(SUBJECT_CLASS, props.className)}
            style={{ backgroundImage: `url("${props.url}")`, ...props.style }}
        />
    );
}

/** A horizon line, so a move or a zoom has something to be measured against. */
function Stage() {
    return <span className="absolute inset-x-0 bottom-1 h-px bg-edge-strong" aria-hidden="true" />;
}

const FILTER_SAMPLE: Record<string, string> = {
    blur: "blur(1.2px)",
    brightness: "brightness(1.6)",
    contrast: "contrast(2.2)",
    grayscale: "grayscale(1)",
    saturate: "saturate(3)",
    sepia: "sepia(1)",
    hueRotate: "hue-rotate(150deg)",
    invert: "invert(1)",
};

const GEOMETRY_SAMPLE: Record<string, CSSProperties> = {
    position: { transform: "translate(-110%, -50%)" },
    zoom: { transform: "translate(-50%, -50%) scale(1.4)" },
    scaleX: { transform: "translate(-50%, -50%) scaleX(0.45)" },
    scaleY: { transform: "translate(-50%, -50%) scaleY(0.45)" },
    rotation: { transform: "translate(-50%, -50%) rotate(26deg)" },
    opacity: { opacity: 0.3 },
};

const CLIP_SAMPLE: Record<string, string> = {
    clip: "inset(0 32% 0 0)",
    mask: "circle(42% at 50% 45%)",
    circleReveal: "circle(34% at 50% 45%)",
    circleClose: "circle(72% at 50% 45%)",
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
function RevealPreview(props: { url: string; className?: string }) {
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
                url={props.url}
                style={{
                    clipPath: open ? CLIP_SAMPLE.circleClose : CLIP_SAMPLE.circleReveal,
                    transition: "clip-path 300ms ease-out",
                }}
            />
        </span>
    );
}

export type TransformChannelPreviewProps = {
    channelId: string;
    /** Draw one named grade instead of the channel's own sample. */
    lookPreset?: string;
    /** The picture this row actually transforms, when it has one. Falls back to the bundled portrait. */
    imageUrl?: string | null;
    className?: string;
};

/**
 * The tile for one channel id, or for one grade when `lookPreset` names it.
 *
 * Unknown ids get the neutral sample rather than nothing: a channel added to the vocabulary without
 * a sample here still shows the subject, so the picker reads as complete while the tile is the thing
 * that is missing.
 */
export function TransformChannelPreview(props: TransformChannelPreviewProps) {
    const { channelId } = props;
    const url = props.imageUrl || FALLBACK_SUBJECT_URL;

    if (props.lookPreset) {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} style={{ filter: lookCss(props.lookPreset) }} />
            </span>
        );
    }

    // A restore puts the channel back, so its tile is the plain subject beside a faded copy of
    // itself - the look coming off, which is what the channel writes.
    if (channelId.startsWith("clear.")) {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} className="opacity-30" style={{ transform: "translate(-90%, -50%)" }} />
                <Subject url={url} style={{ transform: "translate(-10%, -50%)" }} />
            </span>
        );
    }

    if (channelId.startsWith("filter.")) {
        const fn = channelId.slice("filter.".length);
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} style={{ filter: FILTER_SAMPLE[fn] }} />
            </span>
        );
    }

    if (channelId in GEOMETRY_SAMPLE) {
        // Static, and the ghost is what makes it readable: a portrait sitting left of a faint copy
        // of itself says "position" without having to move, and a tile that moved would only be
        // legible while the pointer happened to be on it.
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} className="opacity-20" />
                <Subject url={url} style={GEOMETRY_SAMPLE[channelId]} />
            </span>
        );
    }

    if (channelId === "look") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} style={{ filter: lookCss(STORY_CAMERA_LOOK_PRESETS[0]?.id ?? "") }} />
            </span>
        );
    }

    if (channelId === "blend") {
        // A blend mode is a relationship, and one picture cannot show one: the tile has to say that
        // this channel is about what sits BEHIND the object, so there is something behind it.
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <span className="absolute inset-y-0 right-0 w-1/2 bg-warning" />
                <Stage />
                <Subject url={url} style={{ mixBlendMode: "luminosity" }} />
            </span>
        );
    }

    if (channelId === "backdrop") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} />
                <span className="absolute inset-x-0 bottom-0 h-1/2 bg-fill" style={{ backdropFilter: "blur(2px)" }} />
            </span>
        );
    }

    if (channelId === "reveal") {
        return <RevealPreview url={url} className={props.className} />;
    }

    if (channelId in CLIP_SAMPLE) {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} style={{ clipPath: CLIP_SAMPLE[channelId] }} />
            </span>
        );
    }

    if (channelId === "filterRaw") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} style={{ filter: "drop-shadow(0 0 2px currentColor) saturate(1.6)" }} />
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
        // Timing is not a look, so the tile shows the only thing it honestly can: the same subject
        // more than once, arriving across the frame.
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Stage />
                <Subject url={url} className="h-5 w-5 opacity-20" style={{ transform: "translate(-135%, -50%)" }} />
                <Subject url={url} className="h-5 w-5 opacity-45" style={{ transform: "translate(-50%, -50%)" }} />
                <Subject url={url} className="h-5 w-5" style={{ transform: "translate(35%, -50%)" }} />
            </span>
        );
    }

    return (
        <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
            <Stage />
            <Subject url={url} />
        </span>
    );
}
