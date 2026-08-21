/**
 * What a project's weather comes to, as a picture and as a shipped file.
 *
 * Three callers need the same answers and must never disagree about them:
 *
 * - the **host** (`GameApp`), which turns a row's seed into the spec it asks its host to produce;
 * - the **build**, which produces those clips ahead of time and puts them in the package;
 * - the **shipped game**, which asks for the same spec again and has to find what the build left.
 *
 * A disagreement between any two of them is a game that ships a clip nothing asks for, or asks for
 * one that is not there. Both fail silently: the pack is valid, the story plays, and the weather is
 * simply absent. So the size, the id and the walk that finds them live here rather than at each end.
 */

import type { StoryBlock, StoryDocument } from "@shared/types/story";
import type { UIDocument } from "@shared/types/ui-editor/document";
import { vfxFrameRateOf, type VfxConfiguration } from "@shared/types/vfx";
import { weatherBakeKey } from "./bakeKey";
import {
    weatherBakeSize,
    weatherFrameCountOf,
    type WeatherBakeSpec,
    type WeatherSeedRef,
} from "./model";

/**
 * The stage a weather clip covers, in the coordinates the author authored it in.
 *
 * Separate from {@link weatherSpecForStage} because the inspector's live preview needs the same
 * answer and does not want a spec: a preview shows the picture at panel size, so it needs the stage
 * to scale AGAINST, not the frame count or the id. Two callers deriving "which surface is the
 * stage?" for themselves is how a preview comes to be a picture of a different composition than the
 * clip - which is exactly what happened, and what the preview is now scaled from this to avoid.
 *
 * The fallbacks are the clip's own: the first surface when nothing is marked as the stage, and
 * 1080p when there is no document at all. The clip is `cover`-fitted either way, so a size that is
 * merely close costs nothing an eye can find.
 */
export function weatherStageSize(uidoc: UIDocument | undefined): { width: number; height: number } {
    const stage = uidoc?.surfaces.find(surface => surface.kind === "stageSurface") ?? uidoc?.surfaces[0];
    return stage?.designSize ?? { width: 1920, height: 1080 };
}

/**
 * The synthetic asset id a baked clip is addressed by.
 *
 * Baked clips are deliberately not project-library assets: they are derived from the story document
 * and belong to the build, and putting them in the author's asset browser would fill it with files
 * they never imported. They ride a computed id instead, exactly as baked character avatars do.
 *
 * The id is the bake key, so it already carries the seed, every parameter and the size. Two projects
 * asking for the same weather at the same stage size address the same file, and a stage resize
 * addresses a different one.
 */
export const WEATHER_CLIP_ASSET_ID_PREFIX = "weather-clip:" as const;

export function weatherClipAssetId(spec: WeatherBakeSpec): string {
    return `${WEATHER_CLIP_ASSET_ID_PREFIX}${weatherBakeKey(spec)}`;
}

/**
 * One produced clip on its way into a package: the id it is addressed by and the file to copy.
 *
 * Declared beside the id it carries rather than beside the baker, so the packer can name the shape
 * without importing anything that spawns an encoder.
 */
export type PackedWeatherClip = {
    id: string;
    path: string;
};

/**
 * The clip a seed describes, at the size this project's stage is and the rate this project asked for.
 *
 * The size is the host's question rather than the compiler's: an overlay covers the stage, and the
 * compiler has no business knowing how big that is. A document with no stage surface falls back to
 * the first surface it has, and a document with none at all falls back to 1080p - the clip is
 * `cover`-fitted either way, so a size that is merely close costs nothing an eye can find.
 *
 * `vfx` is stated rather than optional for the reason `uidoc` is: both decide what file a row
 * addresses, so a caller that could omit one would silently address a different clip than the
 * caller beside it. Passing `undefined` is a real answer (the project's default rate), and the
 * hosts that genuinely hold no configuration - a bundle written before the setting existed - are
 * the ones that pass it.
 */
export function weatherSpecForStage(
    ref: WeatherSeedRef,
    uidoc: UIDocument | undefined,
    vfx: VfxConfiguration | undefined,
): WeatherBakeSpec {
    const design = weatherStageSize(uidoc);
    const { width, height } = weatherBakeSize(design.width, design.height);
    const fps = vfxFrameRateOf(vfx);
    // Neither the loop length nor the rate is fixed, so the frame count is derived here rather than
    // stored: the seam guarantee is that the renderer is asked for phases `i / frames`, and a frames
    // value that did not match the rate the encoder is handed would put a stutter in every loop.
    // The length is the effect's own (`loopSeconds`), which is why this reads the ref and not a
    // constant - a caller holding the old constant would address a clip nothing ever bakes.
    return { ref, width, height, fps, frames: weatherFrameCountOf(ref, fps) };
}

/**
 * Every clip a set of story documents asks for, deduplicated, in the order the rows name them.
 *
 * Collected from the authored payloads rather than from a compile: the compile that resolves these
 * runs inside the shipped game, which is precisely the moment at which producing one is no longer
 * possible. The build has to know beforehand.
 *
 * Any `vfx` payload carrying a seed counts, not only `create`. The compiler reads the seed off
 * whichever row first names an overlay, so keying on the operation would drop a clip whose row an
 * author wrote as `show`, and a missing clip is a scene that plays with no weather and no error.
 *
 * A row the author disabled is skipped, because the compiler skips it too. A row *inside* a disabled
 * subtree is still collected: this walk is flat and the answer it can give without one is a superset,
 * which costs a bake nobody watches rather than a scene that plays without its weather.
 */
export function collectWeatherSpecs(
    documents: readonly StoryDocument[],
    uidoc: UIDocument | undefined,
    vfx: VfxConfiguration | undefined,
): WeatherBakeSpec[] {
    const specs: WeatherBakeSpec[] = [];
    const seen = new Set<string>();
    for (const document of documents) {
        for (const scene of Object.values(document?.scenes ?? {})) {
            for (const block of Object.values(scene?.blocks ?? {}) as StoryBlock[]) {
                const ref = weatherRefOfBlock(block);
                if (!ref) {
                    continue;
                }
                const spec = weatherSpecForStage(ref, uidoc, vfx);
                const key = weatherBakeKey(spec);
                if (seen.has(key)) {
                    continue;
                }
                seen.add(key);
                specs.push(spec);
            }
        }
    }
    return specs;
}

/** The seed a block names, or null for every block that names none. */
function weatherRefOfBlock(block: StoryBlock | undefined): WeatherSeedRef | null {
    if (!block || block.disabled) {
        return null;
    }
    const payload = block.payload as { action?: string; seed?: WeatherSeedRef } | undefined;
    if (!payload || payload.action !== "vfx" || !payload.seed?.seed) {
        return null;
    }
    return payload.seed;
}
