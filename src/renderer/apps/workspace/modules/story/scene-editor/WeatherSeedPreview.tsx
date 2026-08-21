import { useEffect, useMemo, useRef } from "react";
import { buildWeatherField, createWeatherRenderer, scaleWeatherParams } from "@shared/weather/field";
import {
    resolveWeatherParams,
    WEATHER_LOOP_SECONDS,
    type ResolvedWeatherParams,
    type WeatherParamKey,
    type WeatherSeedId,
} from "@shared/weather/model";
import { useProjectVfxFrameRate } from "@/lib/workspace/hooks/useProjectVfxFrameRate";
import { useProjectStageSize } from "@/lib/workspace/hooks/useProjectStageSize";

/**
 * How wide the preview's own picture is, in its own pixels.
 *
 * The height is not stated: it comes from the stage's aspect, because this is the whole stage
 * reduced rather than a window cut out of it.
 */
const PREVIEW_WIDTH = 320;

/**
 * The finished frame, reduced to panel size.
 *
 * ## Why the whole frame and not a window onto it
 *
 * It used to be a 320x180 window onto the stage at 1:1, on the argument that pixel lengths are only
 * honest at their own scale. Every length in it was indeed correct and the picture was still wrong,
 * because composition is not a length. The stage carries around two hundred and forty petals of
 * which each is 5% of the frame's height; the window carried fourteen of which each was 29% of it.
 * One is weather and the other is a macro shot, and an author tuning the first while looking at the
 * second gets a clip that surprises them - which is exactly the report this was rewritten from.
 *
 * It was also unusable as a control surface: at fourteen particles, moving `density` by a step
 * changed the count by one, so half the panel's sliders read as doing nothing at all.
 *
 * So the field is built at the stage's own composition and drawn at a fraction of its size. Every
 * pixel length is scaled by the same factor and `density`, being areal, by its square - which leaves
 * the particle COUNT, the crossing time, the flutter rate and the depth spread identical to the
 * clip's. What it gives up is fine detail on the smallest particles, and that is the right thing to
 * give up: a far petal is a couple of pixels on the stage too.
 *
 * ## Why it animates rather than showing a frame
 *
 * Most of what these parameters control is motion: wind tilt, fall speed, flutter rate, the length
 * of a rain streak. A still frame answers only the density question, which is the one an author can
 * already guess. Anything less than motion would send them to a run to find out, and removing that
 * round trip is the whole point.
 *
 * ## Why it now integrates the shutter the bake integrates
 *
 * It used to render at one sub-step where the bake uses eight, on the argument that the shutter blur
 * is not a parameter anyone is here to tune. True, and it still misled: the blur is a function of
 * SPEED, and at the top of the speed range it costs a petal a quarter of its edge energy and nearly
 * half its peak brightness. A preview that stayed crisp there was advertising a picture the bake
 * cannot produce, precisely as an author raised the one slider that provokes it. Measured at panel
 * size the honest version costs 0.6 to 4.5 ms a frame depending on seed and stage, against a budget
 * of 33, so there is nothing to buy by lying about it.
 *
 * ## Why it steps rather than sweeps
 *
 * The frame rate is the project's (Project -> App), and it is the one screen-effect value with
 * nothing on the panel to read it off. So the loop advances on the clip's own frame grid instead of
 * on the display's: at 30 the preview holds each picture for a thirtieth of a second exactly as the
 * file will, and raising the rate is visible here rather than only after a run. Sweeping smoothly
 * would show a motion the clip cannot produce, which is the one way this preview could mislead.
 *
 * ## Why it draws on black rather than over the scene
 *
 * The clip is light on black and reaches the stage through `screen`, which drops the black. Showing
 * it over some stand-in background would be showing a composite this panel cannot predict - the
 * author's own scene is what it lands on, and that is what the stage shows. Black is what the file
 * contains.
 */
export function WeatherSeedPreview(props: {
    seed: WeatherSeedId;
    params: Partial<Record<WeatherParamKey, number>> | undefined;
}) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    // Read inside the effect rather than captured in its dependency list: a params object is rebuilt
    // on every keystroke, and restarting the loop for each one would drop the animation to a stutter.
    const resolved = resolveWeatherParams({ seed: props.seed, ...(props.params ? { params: props.params } : {}) });
    const paramsKey = JSON.stringify(resolved);
    // The project's, and both subscribed: an author can have this panel, Project -> App and the UI
    // editor open together, so either can move while the preview is running.
    const fps = useProjectVfxFrameRate();
    const stage = useProjectStageSize();

    // The stage reduced to panel width, rounded to whole pixels because a canvas has no others. The
    // scale is recovered from the rounded height rather than kept from the division, so the field is
    // built for the picture that will actually be drawn.
    const height = Math.max(1, Math.round((PREVIEW_WIDTH * stage.height) / stage.width));
    const scale = useMemo(() => PREVIEW_WIDTH / Math.max(1, stage.width), [stage.width]);

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
            return;
        }

        // Lengths by the scale and density by its square, so this is the stage's own composition
        // photographed smaller rather than a sparser weather that happens to fit. Shared with
        // nothing else drawing it, which is the point - see `scaleWeatherParams`.
        const scaled = scaleWeatherParams(JSON.parse(paramsKey) as ResolvedWeatherParams, scale);

        const field = buildWeatherField(props.seed, scaled, PREVIEW_WIDTH, height);
        const frames = WEATHER_LOOP_SECONDS * fps;
        // No `subSteps`: the renderer's own default is the bake's, which is the point.
        const renderer = createWeatherRenderer(field, PREVIEW_WIDTH, height, { frames });
        // The canvas's own buffer, filled from the renderer's each frame. Wrapping the renderer's
        // array directly would be one copy cheaper and is not worth the cast it needs: the renderer
        // owns that buffer and overwrites it in place, which is exactly the aliasing the bake had to
        // be fixed for once already.
        const image = context.createImageData(PREVIEW_WIDTH, height);

        let handle = 0;
        let running = false;
        let start = 0;
        /** Which of the clip's frames the canvas is currently showing; -1 is "nothing drawn yet". */
        let shown = -1;

        const draw = (now: number) => {
            if (!running) {
                return;
            }
            if (start === 0) {
                start = now;
            }
            // The clip's own loop and the clip's own frames, so both the speed and the smoothness on
            // screen are what will be on stage. The display is polled at its own rate and the field
            // is integrated only when the clip would have a new picture - a 30fps effect on a 165Hz
            // panel is then a fifth of the work, not five renders of the same frame.
            const index = Math.floor(((now - start) / 1000) * fps) % frames;
            if (index !== shown) {
                shown = index;
                renderer.render(index / frames);
                image.data.set(renderer.frame);
                context.putImageData(image, 0, 0);
            }
            handle = requestAnimationFrame(draw);
        };

        const stop = () => {
            running = false;
            start = 0;
            // The loop restarts from the top, so frame 0 has to be drawn again rather than skipped
            // as "already showing".
            shown = -1;
            if (handle !== 0) {
                cancelAnimationFrame(handle);
                handle = 0;
            }
        };

        const run = () => {
            if (running) {
                return;
            }
            running = true;
            handle = requestAnimationFrame(draw);
        };

        // Off screen is off. An inspector scrolled out of sight, or a window in the background, must
        // not keep a particle field integrating - this is the one control in the panel with a cost
        // that does not stop when the author does.
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting) && document.visibilityState === "visible") {
                run();
            } else {
                stop();
            }
        });
        observer.observe(canvas);

        const onVisibility = () => {
            if (document.visibilityState === "visible") {
                run();
            } else {
                stop();
            }
        };
        document.addEventListener("visibilitychange", onVisibility);

        return () => {
            observer.disconnect();
            document.removeEventListener("visibilitychange", onVisibility);
            stop();
        };
        // `fps`, `height` and `scale` restart the loop, unlike the parameters above: they are the
        // renderer's frame count and the field's own size, so a change to one is a different
        // renderer. All three move once per deliberate act, never per keystroke.
    }, [props.seed, paramsKey, fps, height, scale]);

    return (
        <canvas
            ref={canvasRef}
            width={PREVIEW_WIDTH}
            height={height}
            // `h-auto` rather than a fixed aspect: the picture's ratio is the stage's, and a 4:3
            // project must not have its weather previewed stretched into widescreen.
            className="mb-2 h-auto w-full rounded-md border border-edge bg-black"
        />
    );
}
