import { Wind } from "lucide-react";
import type { StoryActionPayload, StoryBlock } from "@shared/types/story";
import { WEATHER_SEED_IDS, type WeatherSeedId } from "@shared/weather/model";
import { asDurationMs, asEnum, asNumber, asText, defineStoryCommand, secondsParam } from "../spec";
import { deriveObjectName } from "../payloadHelpers";

/**
 * `/vfx` - a full-screen ambience overlay.
 *
 * A `Vfx` is a looping video composited over the whole stage: falling petals, rain, drifting dust,
 * light flares. It is an engine `Actionable`, **not** a Displayable - it has no transform pipeline, so
 * `/transform` and `/fx` do not accept it and never will.
 *
 * One new token, like `/camera` and `/video` before it. Everything an author does to an overlay after
 * placing it - fade it in or out, freeze it, change how fast it drifts - is an existing generic verb
 * (`/show` `/hide` `/pause` `/resume` `/rate`) that dispatches on the resolved target.
 *
 * The line places the clip and names it; blend mode, opacity, fit and z-index are the inspector's.
 * Blend mode in particular is not a preference but a property of the MATERIAL, which is why the
 * inspector's options name the material rather than the CSS keyword.
 *
 * **There is no alpha-channel route.** WebKit decodes a WebM carrying alpha and then composites its
 * RGB plane opaquely, discarding the transparency - VP9 and VP8 alike, on iOS and on macOS Safari.
 * Measured 2026-08-18 against iOS 18.7 and Safari 26.3, with Chromium honouring the very same files.
 * So a transparent clip left on `normal` looks correct on Windows, macOS, Linux and Android, and
 * arrives as a full-screen opaque rectangle in the iOS shell and for every Safari player of the web
 * build. It cannot be reproduced on the machine the clip was authored on.
 *
 * The material route is therefore an OPAQUE clip rendered on black with `screen`, or on white with
 * `multiply`. `normal` stays legal - a clip meant to cover what is under it uses it - but it is not
 * how transparency is achieved. The transcode target, VP9 video plus Vorbis audio in WebM, plays
 * correctly on every target and is not what is at fault here.
 */

const VFX_DEFAULT_FADE_MS = 600;

/** The weather word this slot resolved to, or null when it named a clip of the author's own. */
function seedOf(value: { kind: string } | undefined): WeatherSeedId | null {
    const word = asEnum(value as never);
    return word && (WEATHER_SEED_IDS as readonly string[]).includes(word) ? (word as WeatherSeedId) : null;
}

export const vfx = defineStoryCommand({
    id: "vfx",
    token: "vfx",
    aliases: ["ambience"],
    category: "vfx",
    icon: Wind,
    examples: ["/vfx intro", "/vfx intro name=petals opacity=0.5 d=0.8"],
    quickParams: ["d"],
    params: {
        clip: {
            aliases: ["src"],
            hint: "vfxSource",
            // The seed branch is tried FIRST, so the three weather words are reserved in this slot the
            // way `camera` and `background` are reserved in a transform target. An author with a clip
            // of their own named `snow` reaches it by renaming the asset or by filling the slot from
            // the inspector; the alternative - letting a library name shadow a built-in - would mean
            // the same line does different things in two projects.
            type: [
                { kind: "enum", options: WEATHER_SEED_IDS.map(value => ({ value })) },
                { kind: "asset", assetType: "video" },
            ],
            positional: true,
            core: true,
        },
        name: { hint: "objectName", type: { kind: "text" } },
        // The one visual knob worth typing inline: how strongly the overlay reads. Everything else
        // about how it composites is a material question the inspector asks properly.
        opacity: { hint: "opacity", type: { kind: "number", min: 0, max: 1 } },
        d: secondsParam(),
    },
    // Same auto-name rule as `/image` and `/video`: `/vfx petals.webm` lands an overlay called
    // `petals`, and `/vfx snow` one called `snow`.
    deriveArgs: deriveObjectName("vfx", "clip", "vfx"),
    build(args, ctx): StoryBlock {
        const payload: Extract<StoryActionPayload, { action: "vfx" }> = {
            action: "vfx",
            operation: "create",
            objectName: asText(args.name) ?? "vfx",
            // An ambience overlay that does not loop is a video, so the default is the one an author
            // reaching for `/vfx` means.
            loop: true,
            durationMs: VFX_DEFAULT_FADE_MS,
            // One source or the other, never both: the payload documents them as mutually exclusive
            // because a row carrying two would leave the compiler's read order deciding the picture.
            ...(args.clip?.kind === "asset" ? { assetId: args.clip.assetId } : {}),
            ...(seedOf(args.clip) ? { seed: { seed: seedOf(args.clip)! } } : {}),
            ...(asNumber(args.opacity) !== undefined ? { opacity: asNumber(args.opacity) } : {}),
            ...(asDurationMs(args.d) !== undefined ? { durationMs: asDurationMs(args.d) } : {}),
        };
        return { id: ctx.generateId(), parentId: null, childrenIds: [], kind: "action", payload };
    },
    // Blend mode is the choice that decides whether the material looks right at all, and it is not
    // something to guess from a filename - the create row opens on it.
    inspectorAfterCommit: true,
});

export const VFX_COMMANDS = [vfx];
