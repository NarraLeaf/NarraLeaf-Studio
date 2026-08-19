import { useState, type CSSProperties } from "react";
import { cn } from "@/lib/utils/cn";
import { STORY_CAMERA_LOOK_PRESETS } from "@/lib/ui-editor/runtime/game/cameraLookPresets";
import { SampleStage, SAMPLE_SUBJECT_URL } from "@/lib/story/previewSubject";

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

const TILE_CLASS = "relative h-8 w-12 shrink-0 overflow-hidden rounded-sm border border-edge bg-surface-sunken";

const SUBJECT_CLASS = "absolute left-1/2 top-1/2 h-7 w-7 -translate-x-1/2 -translate-y-1/2 bg-contain bg-center bg-no-repeat";

type SubjectProps = { url: string; stage?: boolean; className?: string; style?: CSSProperties };

/**
 * The thing being transformed.
 *
 * A displayable's subject is one portrait, centred and smaller than the frame, so a crop or a mask
 * has an edge inside the tile to cut. A camera's subject is the whole STAGE - the tile is the
 * viewport, and what moves inside it is everything the camera sees, which is the only way a pan or
 * a zoom reads as a camera move rather than as a sprite move.
 */
function Subject(props: SubjectProps) {
    if (props.stage) {
        return (
            <span className={cn("absolute inset-0", props.className)} style={props.style}>
                <SampleStage />
            </span>
        );
    }
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

/**
 * The same channels as seen by a camera.
 *
 * Much smaller moves than a sprite's: the subject here fills the frame, so the offset that reads as
 * "moved" for a portrait would push the whole stage out of the tile and leave an empty box - which
 * is a picture of nothing rather than a picture of a pan.
 */
const CAMERA_GEOMETRY_SAMPLE: Record<string, CSSProperties> = {
    position: { transform: "translateX(-18%) scale(1.25)" },
    zoom: { transform: "scale(1.5)" },
    scaleX: { transform: "scaleX(1.45)" },
    scaleY: { transform: "scaleY(1.45)" },
    rotation: { transform: "rotate(8deg) scale(1.2)" },
    opacity: { opacity: 0.35 },
};

/**
 * The lens, drawn: what each of the camera-only channels puts between the shot and the viewer.
 *
 * Black, and raw rather than tokenised, for the same reason the stand-in sky is: these are the
 * MATERIAL, not the chrome. A shutter really is black (`shutterColor` seeds `#000000`) and a
 * vignette really darkens toward black, so painting them in a surface token would draw a preview of
 * something the camera does not do. The two tinted variants exist only so the colour knobs have a
 * tile that can show a colour at all.
 */
const SHUTTER_BAR = "pointer-events-none absolute inset-x-0 bg-black";
const vignetteStyle = (inner: string, outer: string, color = "rgb(0 0 0 / 0.85)"): CSSProperties => ({
    background: `radial-gradient(ellipse at 50% 50%, transparent ${inner}, ${color} ${outer})`,
});

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

/**
 * The lens gesture, which is a blink - so its tile blinks.
 *
 * Same rule as {@link RevealPreview}: a transition rather than a keyframe, so `ui.reduceMotion`
 * degrades it to a snap between open and shut and both ends still say what the channel is.
 */
function LensPreview(props: { className?: string }) {
    const [shut, setShut] = useState(false);
    return (
        <span
            className={cn(TILE_CLASS, props.className)}
            aria-hidden="true"
            onPointerEnter={() => setShut(true)}
            onPointerLeave={() => setShut(false)}
        >
            <Subject stage url={SAMPLE_SUBJECT_URL} />
            <span className={cn(SHUTTER_BAR, "top-0")} style={{ height: shut ? "50%" : "8%", transition: "height 260ms ease-out" }} />
            <span className={cn(SHUTTER_BAR, "bottom-0")} style={{ height: shut ? "50%" : "8%", transition: "height 260ms ease-out" }} />
        </span>
    );
}

export type TransformChannelPreviewProps = {
    channelId: string;
    /** Draw one named grade instead of the channel's own sample. */
    lookPreset?: string;
    /** The picture this row actually transforms, when it has one. Falls back to the bundled portrait. */
    imageUrl?: string | null;
    /** The subject is the whole stage rather than one sprite - see {@link Subject}. */
    isCamera?: boolean;
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
    const url = props.imageUrl || SAMPLE_SUBJECT_URL;
    const stage = props.isCamera === true;
    // The stand-in stage draws its own horizon; the portrait needs one drawn for it.
    const horizon = stage ? null : <Stage />;

    if (props.lookPreset) {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                {horizon}
                <Subject stage={stage} url={url} style={{ filter: lookCss(props.lookPreset) }} />
            </span>
        );
    }

    // A restore puts the channel back, so its tile is the plain subject beside a faded copy of
    // itself - the look coming off, which is what the channel writes.
    if (channelId.startsWith("clear.")) {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                {horizon}
                <Subject stage={stage} url={url} className="opacity-30" style={{ transform: "translate(-90%, -50%)" }} />
                <Subject stage={stage} url={url} style={{ transform: "translate(-10%, -50%)" }} />
            </span>
        );
    }

    if (channelId.startsWith("filter.")) {
        const fn = channelId.slice("filter.".length);
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                {horizon}
                <Subject stage={stage} url={url} style={{ filter: FILTER_SAMPLE[fn] }} />
            </span>
        );
    }

    if (channelId in GEOMETRY_SAMPLE) {
        if (stage) {
            // No ghost: two stacked copies of a full-frame stage read as a double exposure rather
            // than as a before and after.
            return (
                <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                    <Subject stage url={url} style={CAMERA_GEOMETRY_SAMPLE[channelId]} />
                </span>
            );
        }
        // Static, and the ghost is what makes it readable: a portrait sitting left of a faint copy
        // of itself says "position" without having to move, and a tile that moved would only be
        // legible while the pointer happened to be on it.
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                {horizon}
                <Subject stage={stage} url={url} className="opacity-20" />
                <Subject stage={stage} url={url} style={GEOMETRY_SAMPLE[channelId]} />
            </span>
        );
    }

    if (channelId === "look") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                {horizon}
                <Subject stage={stage} url={url} style={{ filter: lookCss(STORY_CAMERA_LOOK_PRESETS[0]?.id ?? "") }} />
            </span>
        );
    }

    if (channelId === "blend") {
        // A blend mode is a relationship, and one picture cannot show one: the tile has to say that
        // this channel is about what sits BEHIND the object, so there is something behind it.
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <span className="absolute inset-y-0 right-0 w-1/2 bg-warning" />
                {horizon}
                <Subject stage={stage} url={url} style={{ mixBlendMode: "luminosity" }} />
            </span>
        );
    }

    if (channelId === "backdrop") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                {horizon}
                <Subject stage={stage} url={url} />
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
                {horizon}
                <Subject stage={stage} url={url} style={{ clipPath: CLIP_SAMPLE[channelId] }} />
            </span>
        );
    }

    if (channelId === "filterRaw") {
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                {horizon}
                <Subject stage={stage} url={url} style={{ filter: "drop-shadow(0 0 2px currentColor) saturate(1.6)" }} />
            </span>
        );
    }

    // ---- the lens: what the camera puts between the shot and the viewer -----------------------
    if (channelId === "shutter" || channelId === "shutterColor") {
        // Two eyelids closing symmetrically. The colour knob draws its own bars in something other
        // than black, because a black bar on a black bar is the one thing that cannot show a colour.
        const paint = channelId === "shutterColor" ? { backgroundColor: "rgb(120 40 60)" } : undefined;
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Subject stage url={url} />
                <span className={cn(SHUTTER_BAR, "top-0 h-1/3")} style={paint} />
                <span className={cn(SHUTTER_BAR, "bottom-0 h-1/3")} style={paint} />
            </span>
        );
    }
    if (channelId === "vignette" || channelId === "vignetteColor" || channelId === "vignetteInner" || channelId === "vignetteOuter") {
        // One picture, three readings: the plain grade, a tighter opening, a wider falloff. Each
        // tile shows the knob at a value that is visibly not the others.
        const shape = channelId === "vignetteInner"
            ? vignetteStyle("10%", "70%")
            : channelId === "vignetteOuter"
                ? vignetteStyle("40%", "100%")
                : vignetteStyle("35%", "85%", channelId === "vignetteColor" ? "rgb(90 20 40 / 0.9)" : undefined);
        return (
            <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
                <Subject stage url={url} />
                <span className="pointer-events-none absolute inset-0" style={shape} />
            </span>
        );
    }
    if (channelId === "lens") {
        return <LensPreview className={props.className} />;
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
                {horizon}
                <Subject stage={stage} url={url} className="h-5 w-5 opacity-20" style={{ transform: "translate(-135%, -50%)" }} />
                <Subject stage={stage} url={url} className="h-5 w-5 opacity-45" style={{ transform: "translate(-50%, -50%)" }} />
                <Subject stage={stage} url={url} className="h-5 w-5" style={{ transform: "translate(35%, -50%)" }} />
            </span>
        );
    }

    return (
        <span className={cn(TILE_CLASS, props.className)} aria-hidden="true">
            <Stage />
            <Subject stage={stage} url={url} />
        </span>
    );
}
