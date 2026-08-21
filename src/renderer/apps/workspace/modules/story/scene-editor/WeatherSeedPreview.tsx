import { useEffect, useRef } from "react";
import { buildWeatherField, createWeatherRenderer } from "@shared/weather/field";
import {
    resolveWeatherParams,
    WEATHER_LOOP_SECONDS,
    type WeatherParamKey,
    type WeatherSeedId,
} from "@shared/weather/model";
import { useProjectVfxFrameRate } from "@/lib/workspace/hooks/useProjectVfxFrameRate";

/**
 * The size of the window this preview is, in the finished picture's own pixels.
 *
 * It is a **window onto the stage at 1:1**, not the stage shrunk to fit the panel. That is what
 * makes it readable: the sizes are pixel lengths, so a stage-sized field scaled into 264 points of
 * panel would put a far flake at half a pixel - true to what ships and impossible to judge. At 1:1
 * every flake is the size it will be, the sway is the distance it will travel, and the count is
 * honest too, because density is stated per megapixel and this window gets its share of it.
 *
 * What it cannot show is the whole frame's composition, which is the one thing an author can already
 * picture from the stage they are looking at.
 */
const PREVIEW_WIDTH = 320;
const PREVIEW_HEIGHT = 180;

/**
 * What the numbers above it currently mean, moving.
 *
 * ## Why it animates rather than showing a frame
 *
 * Half of what these parameters control is motion: wind tilt, fall speed, the length of a rain
 * streak, the wobble of a petal. A still frame answers only the density question, which is the one
 * an author can already guess. Anything less than motion would send them to a run to find out, and
 * removing that round trip is the whole point.
 *
 * ## Why it is not the baked clip
 *
 * It renders the same field through the same renderer at one sub-step instead of eight, so the
 * motion, the tint and the density are the clip's; only the per-frame shutter blur is not. That is
 * the right thing to leave out: the blur is what makes the encoded file smaller and smoother, and it
 * is not a parameter anybody is here to tune.
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
    // The project's, and subscribed: an author can have this panel and Project -> App open together,
    // so the rate can move while the preview is running.
    const fps = useProjectVfxFrameRate();

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
            return;
        }

        const field = buildWeatherField(props.seed, JSON.parse(paramsKey), PREVIEW_WIDTH, PREVIEW_HEIGHT);
        const frames = WEATHER_LOOP_SECONDS * fps;
        const renderer = createWeatherRenderer(field, PREVIEW_WIDTH, PREVIEW_HEIGHT, { frames, subSteps: 1 });
        // The canvas's own buffer, filled from the renderer's each frame. Wrapping the renderer's
        // array directly would be one copy cheaper and is not worth the cast it needs: the renderer
        // owns that buffer and overwrites it in place, which is exactly the aliasing the bake had to
        // be fixed for once already.
        const image = context.createImageData(PREVIEW_WIDTH, PREVIEW_HEIGHT);

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
        // `fps` restarts the loop, unlike the parameters above: it is the renderer's frame count, so a
        // change to it is a different renderer. It moves once per deliberate act, never per keystroke.
    }, [props.seed, paramsKey, fps]);

    return (
        <canvas
            ref={canvasRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className="mb-2 aspect-video w-full rounded-md border border-edge bg-black"
        />
    );
}
