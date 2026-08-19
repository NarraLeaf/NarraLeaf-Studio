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
 * Sky over ground, for a stage with no background bound.
 *
 * Deliberately not a surface token: this is standing in for *artwork*, and a preview painted in the
 * chrome's own colours reads as part of the panel rather than as the picture the camera is framing.
 */
const STAND_IN_SKY = "bg-[linear-gradient(180deg,#2b3550_0%,#3d4a63_58%,#4b4136_58%,#3a3229_100%)]";

/**
 * A stage as a camera sees it: a background, and someone standing on it.
 *
 * The figure is what makes a camera move readable. A pan across an empty gradient is a gradient; the
 * same pan with someone in frame is a pan. It sits low and small on purpose - a subject that filled
 * the frame would leave a zoom nothing to zoom past.
 */
export function SampleStage(props: { backgroundUrl?: string | null; className?: string; children?: ReactNode }) {
    return (
        <div
            className={cn("relative h-full w-full overflow-hidden", props.backgroundUrl ? "bg-cover bg-center" : STAND_IN_SKY, props.className)}
            style={props.backgroundUrl ? { backgroundImage: `url("${props.backgroundUrl}")` } : undefined}
        >
            <div
                className="absolute bottom-[8%] left-1/2 aspect-square h-[42%] -translate-x-1/2 bg-contain bg-bottom bg-no-repeat"
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
