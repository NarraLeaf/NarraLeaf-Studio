import { useEffect, useRef } from "react";
import { buildWeatherField, createWeatherRenderer } from "@shared/weather/field";
import {
    resolveWeatherParams,
    WEATHER_FPS,
    WEATHER_LOOP_SECONDS,
    type WeatherParamKey,
    type WeatherSeedId,
} from "@shared/weather/model";

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

    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) {
            return;
        }

        const field = buildWeatherField(props.seed, JSON.parse(paramsKey), PREVIEW_WIDTH, PREVIEW_HEIGHT);
        const frames = WEATHER_LOOP_SECONDS * WEATHER_FPS;
        const renderer = createWeatherRenderer(field, PREVIEW_WIDTH, PREVIEW_HEIGHT, { frames, subSteps: 1 });
        // The canvas's own buffer, filled from the renderer's each frame. Wrapping the renderer's
        // array directly would be one copy cheaper and is not worth the cast it needs: the renderer
        // owns that buffer and overwrites it in place, which is exactly the aliasing the bake had to
        // be fixed for once already.
        const image = context.createImageData(PREVIEW_WIDTH, PREVIEW_HEIGHT);

        let handle = 0;
        let running = false;
        let start = 0;

        const draw = (now: number) => {
            if (!running) {
                return;
            }
            if (start === 0) {
                start = now;
            }
            // The clip's own loop, so the speed on screen is the speed on stage.
            const phase = ((now - start) / (WEATHER_LOOP_SECONDS * 1000)) % 1;
            renderer.render(phase);
            image.data.set(renderer.frame);
            context.putImageData(image, 0, 0);
            handle = requestAnimationFrame(draw);
        };

        const stop = () => {
            running = false;
            start = 0;
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
    }, [props.seed, paramsKey]);

    return (
        <canvas
            ref={canvasRef}
            width={PREVIEW_WIDTH}
            height={PREVIEW_HEIGHT}
            className="mb-2 aspect-video w-full rounded-md border border-edge bg-black"
        />
    );
}
