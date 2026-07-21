import type { StoryTransformRef, StoryTransitionRef } from "@shared/types/story";
import type { StoryCommandEnumOption } from "../storyCommandGrammar";

/**
 * The unified transition vocabulary (bible §1.3).
 *
 * The author has ONE word list; `t=fade` means "appear/disappear/change softly" everywhere. Which
 * payload field and which engine value that becomes is this module's job, decided per command
 * *context* - a `/bg` fade is a crossfade (dissolve), a `/show` fade is a fade-in, a `/hide` fade a
 * fade-out. The writer never chooses between fadeIn/fadeOut/dissolve, because the command already
 * said which direction the change goes.
 *
 * Each context supports a subset; an unsupported word is an `unsupportedOption` issue naming the
 * allowed list, not a silent drop.
 */

export type StoryTransitionWord =
    | "fade"
    | "slide"
    | "slide-left"
    | "slide-right"
    | "slide-up"
    | "slide-down"
    | "circle"
    | "wipe"
    | "iris"
    | "blur"
    | "blinds"
    | "black"
    | "darkness"
    | "zoom"
    | "none";

/**
 * Where a transition word is being used, which decides both the supported subset and the mapping:
 *  - `scene`: `/bg` / `/jump` - a whole-screen change, maps to `StoryTransitionRef.kind`.
 *  - `character`: `/show` / `/hide` of a character - maps to `StoryTransitionRef.kind`, but `fade`
 *    is a fade-in (the portrait appears over the scene; a crossfade needs two frames of the same
 *    object, which is what `/face` does implicitly).
 *  - `reveal` / `conceal`: `/show` / `/hide` of a stage object - maps to a transform preset, since
 *    images and texts animate through their transform, and the direction comes from the verb.
 *  - `nvl`: the NVL panel's enter/exit, a short preset list.
 */
export type StoryTransitionContext = "scene" | "character" | "reveal" | "conceal" | "nvl";

const WORD_ALIASES: Partial<Record<StoryTransitionWord, readonly string[]>> = {
    fade: ["dissolve", "fadein", "fadeout"],
    "slide-left": ["slideleft", "slidel"],
    "slide-right": ["slideright", "slider"],
    "slide-up": ["slideup"],
    "slide-down": ["slidedown"],
    circle: ["maskcircle"],
    wipe: ["softwipe", "maskwipe"],
    iris: ["softiris"],
    blur: ["blurdissolve"],
    black: ["throughcolor"],
};

const SUPPORTED: Record<StoryTransitionContext, readonly StoryTransitionWord[]> = {
    scene: ["fade", "slide", "circle", "wipe", "iris", "blur", "blinds", "black", "darkness", "none"],
    character: ["fade", "slide", "circle", "wipe", "blur", "none"],
    reveal: ["fade", "slide-left", "slide-right", "slide-up", "slide-down", "zoom", "circle", "wipe", "none"],
    conceal: ["fade", "slide-left", "slide-right", "slide-up", "slide-down", "zoom", "circle", "wipe", "none"],
    nvl: ["fade", "none"],
};

/** The enum options a `t=` param offers in a given context - unified words, canonical-first. */
export function transitionOptions(context: StoryTransitionContext): readonly StoryCommandEnumOption[] {
    return SUPPORTED[context].map(word => ({ value: word, aliases: WORD_ALIASES[word] }));
}

/** Every word a context supports - what an `unsupportedOption` issue lists as allowed. */
export function supportedTransitionWords(context: StoryTransitionContext): readonly string[] {
    return SUPPORTED[context];
}

/**
 * The union of several contexts' options, deduped - what a generic verb's `t=` offers before its
 * target has resolved. The parser accepts the union; the spec's validate rejects a word the actual
 * target's context does not support, with the supported list in hand.
 */
export function mergedTransitionOptions(...contexts: readonly StoryTransitionContext[]): readonly StoryCommandEnumOption[] {
    const seen = new Set<string>();
    const merged: StoryCommandEnumOption[] = [];
    for (const context of contexts) {
        for (const option of transitionOptions(context)) {
            if (!seen.has(option.value)) {
                seen.add(option.value);
                merged.push(option);
            }
        }
    }
    return merged;
}

const SCENE_KINDS: Partial<Record<StoryTransitionWord, StoryTransitionRef["kind"]>> = {
    fade: "dissolve",
    slide: "slide",
    circle: "maskCircle",
    wipe: "softWipe",
    iris: "softIris",
    blur: "blurDissolve",
    blinds: "blinds",
    black: "throughColor",
    darkness: "darkness",
    none: "none",
};

const CHARACTER_KINDS: Partial<Record<StoryTransitionWord, StoryTransitionRef["kind"]>> = {
    ...SCENE_KINDS,
    // The portrait appears over an unchanged scene - there is no second frame to crossfade with.
    fade: "fadeIn",
};

const REVEAL_PRESETS: Partial<Record<StoryTransitionWord, NonNullable<StoryTransformRef["preset"]>>> = {
    fade: "fadeIn",
    "slide-left": "slideLeft",
    "slide-right": "slideRight",
    "slide-up": "slideUp",
    "slide-down": "slideDown",
    zoom: "zoom",
    circle: "circleReveal",
    wipe: "wipe",
    none: "none",
};

const CONCEAL_PRESETS: Partial<Record<StoryTransitionWord, NonNullable<StoryTransformRef["preset"]>>> = {
    ...REVEAL_PRESETS,
    fade: "fadeOut",
    circle: "circleClose",
};

/** The `StoryTransitionRef.kind` a unified word means in a whole-screen or character context. */
export function transitionKindFor(context: "scene" | "character", word: string): StoryTransitionRef["kind"] | undefined {
    return (context === "scene" ? SCENE_KINDS : CHARACTER_KINDS)[word as StoryTransitionWord];
}

/** The transform preset a unified word means on a stage object's show/hide (or the NVL panel). */
export function transformPresetFor(context: "reveal" | "conceal" | "nvl", word: string): StoryTransformRef["preset"] | undefined {
    if (context === "nvl") {
        return word === "fade" ? "fadeIn" : word === "none" ? "none" : undefined;
    }
    return (context === "reveal" ? REVEAL_PRESETS : CONCEAL_PRESETS)[word as StoryTransitionWord];
}
