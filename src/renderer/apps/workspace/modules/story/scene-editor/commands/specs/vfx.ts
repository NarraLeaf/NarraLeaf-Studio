import { Wind } from "lucide-react";
import type { StoryActionPayload, StoryBlock } from "@shared/types/story";
import { asDurationMs, asNumber, asText, defineStoryCommand, secondsParam } from "../spec";
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
 * The line places the clip and names it; blend mode, opacity, fit and z-index are the inspector's
 * (B10). Blend mode in particular is not a preference but a property of the MATERIAL - a true-alpha
 * WebM wants `normal`, glow rendered on black wants `screen` - which is why the inspector's options
 * name the material rather than the CSS keyword.
 */

const VFX_DEFAULT_FADE_MS = 600;

export const vfx = defineStoryCommand({
    id: "vfx",
    token: "vfx",
    aliases: ["ambience"],
    category: "vfx",
    icon: Wind,
    examples: ["/vfx intro", "/vfx intro name=petals opacity=0.5 d=0.8"],
    quickParams: ["d"],
    params: {
        clip: { aliases: ["src"], hint: "videoAsset", type: { kind: "asset", assetType: "video" }, positional: true, core: true },
        name: { hint: "objectName", type: { kind: "text" } },
        // The one visual knob worth typing inline: how strongly the overlay reads. Everything else
        // about how it composites is a material question the inspector asks properly.
        opacity: { hint: "opacity", type: { kind: "number", min: 0, max: 1 } },
        d: secondsParam(),
    },
    // Same auto-name rule as `/image` and `/video`: `/vfx petals.webm` lands an overlay called `petals`.
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
            ...(args.clip?.kind === "asset" ? { assetId: args.clip.assetId } : {}),
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
