import type { ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

/**
 * The stand-in an editor preview performs on when the author's own art is not available.
 *
 * Every preview in the story editor auditions something: a transform channel, a motion preset, a
 * camera move. Each of them can bind the real picture - the sprite the row transforms, the asset
 * the motion names, the scene's background - and each of them sometimes cannot: a character's
 * appearance may be a puppet, a fresh project may hold no art at all, a row may address an object
 * that is not on stage yet.
 *
 * What those cases used to draw was a flat coloured box with a label in it, and a box says nothing
 * about the thing being chosen. A grade on a swatch reads as "some colour changed"; a pan across a
 * plain rectangle reads as nothing moving. So the stand-in is a picture: a portrait for a subject,
 * and a horizon with someone standing on it for a stage.
 *
 * Shared rather than copied because it was already copied - the camera's viewfinder and the motion
 * preview's camera placeholder held the same gradient and the same white blob, letter for letter,
 * and the two had to be edited together to stay the same picture.
 */

/**
 * The bundled portrait, served from `app://public` (`electron-builder.yml` already ships
 * `src/renderer/public`, so this needs no packaging change).
 *
 * A portrait rather than a shape: skin, hair, line work and a highlight are what make sepia legible
 * as sepia and grayscale as grayscale at 24 pixels, which is the size these previews actually get.
 */
export const SAMPLE_SUBJECT_URL = "/img/narraleaf-studio/narra-avatar.png";

/**
 * The stage a camera frames, with no background bound.
 *
 * One flat tone off the theme ladder, not a painted sky. The two-tone gradient this replaces was
 * trying to be a horizon and a ground plane, and at the size these previews actually get - a 32px
 * tile - it read as a coloured block with something small at the bottom of it rather than as a
 * stage. `surface-canvas` is the darkest step the theme has, so the picture stays one step below
 * the tile it sits in and follows the theme instead of fighting it.
 *
 * The floor is a hairline, which is all a horizon has to be: it gives a pan and a zoom something to
 * be measured against without painting a second colour into the frame.
 */
export function SampleStage(props: { backgroundUrl?: string | null; className?: string; children?: ReactNode }) {
    return (
        <div
            className={cn(
                "relative h-full w-full overflow-hidden",
                props.backgroundUrl ? "bg-cover bg-center" : "bg-surface-canvas",
                props.className,
            )}
            style={props.backgroundUrl ? { backgroundImage: `url("${props.backgroundUrl}")` } : undefined}
        >
            {props.backgroundUrl ? null : <span className="absolute inset-x-0 bottom-[14%] h-px bg-edge-strong" />}
            {/*
              * Standing ON the floor line and filling most of the frame. The first version placed a
              * `h-[42%]` figure at `bottom-[8%]`, which put a head-and-shoulders portrait in the
              * lower third of a tile: the sample is a portrait, not a full body, so treating it as a
              * figure standing in a landscape left it reading as a speck low in a coloured box.
              */}
            <div
                className="absolute bottom-[14%] left-1/2 aspect-square h-[72%] -translate-x-1/2 bg-contain bg-bottom bg-no-repeat"
                style={{ backgroundImage: `url("${SAMPLE_SUBJECT_URL}")` }}
            />
            {props.children}
        </div>
    );
}

/**
 * The portrait on its own, for a preview whose subject IS one displayable rather than the stage.
 *
 * `contain` and not `cover`: a stand-in that cropped itself would be showing the author a framing
 * decision the row never made.
 */
export function SampleSubject(props: { className?: string }) {
    return (
        <div
            className={cn("h-full w-full bg-contain bg-center bg-no-repeat", props.className)}
            style={{ backgroundImage: `url("${SAMPLE_SUBJECT_URL}")` }}
        />
    );
}
