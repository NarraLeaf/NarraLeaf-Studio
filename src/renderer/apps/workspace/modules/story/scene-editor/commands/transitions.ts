import type { StoryTransformRef, StoryTransitionRef } from "@shared/types/story";
import type { StoryCommandEnumOption } from "../storyCommandGrammar";

/**
 * The unified transition vocabulary.
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
    // 0.16.0 Mask-vocabulary additions (whole-screen only): engine `Reveal` + `Mask.*`.
    | "barn-door"
    | "clock"
    | "fan"
    | "dots"
    | "black"
    | "darkness"
    | "zoom"
    // The transform presets the inspector offers that no word reached. They are the same field a
    // `t=` writes (`StoryTransformRef.preset`), so a look an author could pick on the right had no
    // spelling on the left — and a row showing it could not be typed back. One word each, named
    // after the preset, since there is nothing to unify: unlike `fade`, they read the same in both
    // directions.
    | "scale"
    | "rotate"
    | "opacity"
    | "darken"
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
    "barn-door": ["barndoor", "doors"],
    fan: ["windmill"],
    dots: ["polka"],
    black: ["throughcolor"],
};

const SUPPORTED: Record<StoryTransitionContext, readonly StoryTransitionWord[]> = {
    // The Mask-vocabulary additions (barn-door / clock / fan / dots) are whole-screen transitions:
    // offered on `/bg` `/jump` alongside the classics, but not on portrait swaps or stage objects.
    scene: ["fade", "slide", "circle", "wipe", "iris", "blinds", "barn-door", "clock", "fan", "dots", "blur", "black", "darkness", "none"],
    character: ["fade", "slide", "circle", "wipe", "blur", "none"],
    // Every preset the inspector's own dropdown offers, so the two surfaces reach the same set of
    // looks — `left` / `center` / `right` excepted: those are the SAME field written through `at=`,
    // which is the slot the vocabulary already gives a placement.
    reveal: ["fade", "slide-left", "slide-right", "slide-up", "slide-down", "zoom", "scale", "rotate", "opacity", "darken", "circle", "wipe", "none"],
    conceal: ["fade", "slide-left", "slide-right", "slide-up", "slide-down", "zoom", "scale", "rotate", "opacity", "darken", "circle", "wipe", "none"],
    nvl: ["fade", "none"],
};

/**
 * The word the PROPERTY INSPECTOR shows for whatever this word writes in this context.
 *
 * The two surfaces name the same setting, so they say the same thing: a `/hide` row's `t=fade` and
 * the inspector's 变换 → 预设 are one field, and reading 淡变 on the left while the right says 淡出
 * was the whole complaint. The direction the verb decides is exactly what makes one word need two
 * labels, which is why this is keyed on the context and not on the word alone.
 *
 * `null` where nothing on the right names it — the value then keeps its own `story.enumValue.*` word.
 */
function inspectorLabelKey(context: StoryTransitionContext, word: StoryTransitionWord): string | null {
    if (word === "none") {
        return "common.none";
    }
    if (context === "scene" || context === "character") {
        const kind = transitionKindFor(context, word);
        return kind ? `storyInspector.transition.${kind}` : null;
    }
    const preset = transformPresetFor(context, word);
    if (!preset) {
        return null;
    }
    // The inspector calls this preset "slide reveal"; the vocabulary calls the word `wipe`. One
    // catalog entry, spelled under the inspector's own name for it.
    return `storyInspector.transformPreset.${preset === "wipe" ? "slideReveal" : preset}`;
}

/** The enum options a `t=` param offers in a given context - unified words, canonical-first. */
export function transitionOptions(context: StoryTransitionContext): readonly StoryCommandEnumOption[] {
    return SUPPORTED[context].map(word => {
        const labelKey = inspectorLabelKey(context, word);
        return { value: word, aliases: WORD_ALIASES[word], ...(labelKey ? { labelKey } : {}) };
    });
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
    "barn-door": "barnDoor",
    clock: "clock",
    fan: "fan",
    dots: "dots",
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
    scale: "scale",
    rotate: "rotate",
    opacity: "opacity",
    darken: "darken",
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

/**
 * The word a stored value came from — the inverse of the two lookups above, for the row that has to
 * read a committed block back as the line that would produce it.
 *
 * Searched in `SUPPORTED` order rather than over the raw table, so the word a context PREFERS wins
 * when two spell the same stored value: a character `fadeIn` reads back as `fade`, the word the
 * author typed, not as whichever alias the object literal happened to list first.
 *
 * `null` when nothing in this context names the value. That is a real case — the inspector writes
 * kinds no line can express — and the caller decides what to print instead; it must not invent a word
 * the parser would reject.
 */
function wordFor<T>(context: StoryTransitionContext, stored: T | undefined, of: (word: StoryTransitionWord) => T | undefined): StoryTransitionWord | null {
    // An absent stored value is "nothing to name", never a match against a word this context does not
    // map — every unmapped word answers `undefined` too, and `undefined === undefined` would pick one.
    if (stored === undefined) {
        return null;
    }
    return SUPPORTED[context].find(word => of(word) === stored) ?? null;
}

/** The unified word behind a stored `StoryTransitionRef.kind`, or `null` when no word names it. */
export function transitionWordFor(context: "scene" | "character", kind: StoryTransitionRef["kind"]): StoryTransitionWord | null {
    return wordFor(context, kind, word => transitionKindFor(context, word));
}

/** The unified word behind a stored transform preset, or `null` when no word names it. */
export function transitionWordForPreset(context: "reveal" | "conceal" | "nvl", preset: StoryTransformRef["preset"] | undefined): StoryTransitionWord | null {
    return wordFor(context, preset, word => transformPresetFor(context, word));
}
