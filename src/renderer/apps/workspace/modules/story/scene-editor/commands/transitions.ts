import type { StoryClipReveal, StoryTransformProps, StoryTransformRef, StoryTransitionRef } from "@shared/types/story";
import { legacyPresetPosition } from "@shared/story/transformLegacy";
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
    | "exposure"
    | "zoom"
    // The channels the inspector offers that no word reached. They write the same transform a `t=`
    // does, so a look an author could pick on the right had no spelling on the left — and a row
    // showing it could not be typed back. One word each, named after the channel, since there is
    // nothing to unify: unlike `fade`, they read the same in both directions.
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
    exposure: ["bleach", "overexpose"],
};

const SUPPORTED: Record<StoryTransitionContext, readonly StoryTransitionWord[]> = {
    // The Mask-vocabulary additions (barn-door / clock / fan / dots) are whole-screen transitions:
    // offered on `/bg` `/jump` alongside the classics, but not on portrait swaps or stage objects.
    scene: ["fade", "slide", "circle", "wipe", "iris", "blinds", "barn-door", "clock", "fan", "dots", "blur", "black", "darkness", "exposure", "none"],
    character: ["fade", "slide", "circle", "wipe", "blur", "exposure", "none"],
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
    // Spelled out rather than derived from what the word writes: since v18 a word writes a bag of
    // props, and several words write the same channel (`fade` and `opacity` both set an opacity), so
    // there is nothing to derive a distinct label from. The catalogue keys are unchanged - the
    // inspector still calls a wipe "slide reveal" - because the labels are what an author reads and
    // nothing about them moved.
    //
    // The two direction-sensitive words keep saying which way they go: a `/hide`'s `fade` reads 淡出,
    // not 淡入. That was free while the stored value was `fadeOut`; now the context has to say it.
    if (word === "fade") {
        return context === "conceal" ? "storyInspector.transformPreset.fadeOut" : "storyInspector.transformPreset.fadeIn";
    }
    if (word === "circle") {
        return context === "conceal" ? "storyInspector.transformPreset.circleClose" : "storyInspector.transformPreset.circleReveal";
    }
    return TRANSFORM_WORD_LABELS[word] ?? null;
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
    exposure: "exposure",
    none: "none",
};

const CHARACTER_KINDS: Partial<Record<StoryTransitionWord, StoryTransitionRef["kind"]>> = {
    ...SCENE_KINDS,
    // The portrait appears over an unchanged scene - there is no second frame to crossfade with.
    fade: "fadeIn",
};

/**
 * What a `t=` word writes on a stage object, as PROPS.
 *
 * There is no preset enum any more, so a word no longer names a look the compiler has to translate -
 * it names the channel and the value the bag will carry. Which is what these words always were: the
 * five that had no unified spelling (`scale`, `rotate`, `opacity`, `darken`, `zoom`) are exactly the
 * channels a preset gave a name to, and the slides are positions.
 *
 * The values are the DEFAULTS a bare word means. A row that already states one keeps it - see
 * {@link applyTransitionWordToTransform} - so typing `t=zoom` on a row zoomed to 1.5 does not reset it.
 */
export type StoryTransformWordEffect = {
    to?: StoryTransformProps;
    clipReveal?: StoryClipReveal;
    /**
     * Whether the word names a CHANNEL rather than a value, in which case the number the row already
     * carries survives being re-typed.
     *
     * `t=zoom` on a row zoomed to 1.5 means "keep zooming, that way" and must not reset it to 1 - which
     * is what the old model got for free by storing the preset name beside a loose props bag. `t=fade`
     * is the opposite: on a `/hide` it means opacity 0 outright, and preserving the 1 a `/show` had put
     * there would produce a conceal that reveals. Placements name values too, for the same reason.
     */
    preserve?: boolean;
};

function slide(word: string): StoryTransformProps {
    return { position: legacyPresetPosition(word, {}) };
}

const REVEAL_EFFECTS: Partial<Record<StoryTransitionWord, StoryTransformWordEffect>> = {
    fade: { to: { opacity: 1 } },
    "slide-left": { to: slide("slideLeft") },
    "slide-right": { to: slide("slideRight") },
    "slide-up": { to: slide("slideUp") },
    "slide-down": { to: slide("slideDown") },
    zoom: { to: { zoom: 1 }, preserve: true },
    scale: { to: { scaleX: 1, scaleY: 1 }, preserve: true },
    rotate: { to: { rotation: 0 }, preserve: true },
    opacity: { to: { opacity: 1 }, preserve: true },
    darken: { to: { filter: { brightness: 0.5 } }, preserve: true },
    circle: { clipReveal: { kind: "circleReveal" } },
    wipe: { clipReveal: { kind: "wipe" } },
    none: {},
};

const CONCEAL_EFFECTS: Partial<Record<StoryTransitionWord, StoryTransformWordEffect>> = {
    ...REVEAL_EFFECTS,
    fade: { to: { opacity: 0 } },
    circle: { clipReveal: { kind: "circleClose" } },
};

/** The inspector's own word for each transform word - unchanged catalogue keys. */
const TRANSFORM_WORD_LABELS: Partial<Record<StoryTransitionWord, string>> = {
    fade: "storyInspector.transformPreset.fadeIn",
    "slide-left": "storyInspector.transformPreset.slideLeft",
    "slide-right": "storyInspector.transformPreset.slideRight",
    "slide-up": "storyInspector.transformPreset.slideUp",
    "slide-down": "storyInspector.transformPreset.slideDown",
    zoom: "storyInspector.transformPreset.zoom",
    scale: "storyInspector.transformPreset.scale",
    rotate: "storyInspector.transformPreset.rotate",
    opacity: "storyInspector.transformPreset.opacity",
    darken: "storyInspector.transformPreset.darken",
    circle: "storyInspector.transformPreset.circleReveal",
    wipe: "storyInspector.transformPreset.slideReveal",
};

/**
 * The channels the `t=` / `at=` vocabulary owns.
 *
 * A word REPLACES the row's look rather than adding to it, which is what the single-preset field did
 * for free and now has to be spelled: writing `t=rotate` over a row that said `t=zoom` must leave the
 * zoom behind, or the row would say two things and the line would print only one of them.
 */
const VOCABULARY_KEYS = ["position", "zoom", "scaleX", "scaleY", "rotation", "opacity", "filter"] as const;

/** The `StoryTransitionRef.kind` a unified word means in a whole-screen or character context. */
export function transitionKindFor(context: "scene" | "character", word: string): StoryTransitionRef["kind"] | undefined {
    return (context === "scene" ? SCENE_KINDS : CHARACTER_KINDS)[word as StoryTransitionWord];
}

/** The props a unified word writes on a stage object's show/hide (or the NVL panel). */
export function transformEffectFor(context: "reveal" | "conceal" | "nvl", word: string): StoryTransformWordEffect | undefined {
    if (context === "nvl") {
        return word === "fade" ? { to: { opacity: 1 } } : word === "none" ? {} : undefined;
    }
    return (context === "reveal" ? REVEAL_EFFECTS : CONCEAL_EFFECTS)[word as StoryTransitionWord];
}

/**
 * Fold a `t=` word into a transform ref.
 *
 * A word states the WHOLE look, so everything else the vocabulary owns is dropped - a leftover from the
 * previous word would be a setting no line could print. Whether the row's existing number survives is
 * the word's own business; see `preserve`.
 */
export function applyTransitionWordToTransform(
    current: StoryTransformRef | undefined,
    context: "reveal" | "conceal" | "nvl",
    word: string,
): StoryTransformRef | undefined {
    const effect = transformEffectFor(context, word);
    if (!effect) {
        return current;
    }
    return withTransformChannels(current, effect);
}

/** The same fold for `at=`, whose vocabulary is the three placements. */
export function applyPlacementToTransform(
    current: StoryTransformRef | undefined,
    placement: string,
): StoryTransformRef | undefined {
    const position = legacyPresetPosition(placement, {});
    return position ? withTransformChannels(current, { to: { position } }) : current;
}

function withTransformChannels(
    current: StoryTransformRef | undefined,
    effect: StoryTransformWordEffect,
): StoryTransformRef {
    const previous = current?.to ?? {};
    const to: StoryTransformProps = { ...previous };
    for (const key of VOCABULARY_KEYS) {
        delete to[key];
    }
    for (const [key, value] of Object.entries(effect.to ?? {})) {
        const kept = effect.preserve ? previous[key as keyof StoryTransformProps] : undefined;
        (to as Record<string, unknown>)[key] = kept ?? value;
    }
    // `mode` is left absent rather than written as `"props"`: it is the default, and a field every
    // document would carry on every transform is a diff line that says nothing.
    const next: StoryTransformRef = { ...(current ?? {}), to };
    delete next.mode;
    delete next.animationId;
    if (effect.clipReveal) {
        next.clipReveal = { ...effect.clipReveal, ...(current?.clipReveal?.kind === effect.clipReveal.kind ? current.clipReveal : {}) };
    } else {
        delete next.clipReveal;
    }
    return next;
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

/**
 * The unified word behind a stored transform, or `null` when no word names it.
 *
 * Classified by WHICH channel the bag states, not by the values in it: `t=zoom` and a zoom of 1.5 are
 * the same word, and the word names the channel. Which also means two words that write one channel
 * collapse onto whichever the context prefers - a stored opacity reads back as `fade`, never as
 * `opacity`, since `fade` is what an author types for it.
 *
 * A placement is deliberately NOT named here, the way it was not before: `left` / `center` / `right`
 * are the `at=` slot's, and a bag carrying one of those three positions belongs to that reader.
 */
export function transitionWordForTransform(
    context: "reveal" | "conceal" | "nvl",
    transform: StoryTransformRef | undefined,
): StoryTransitionWord | null {
    if (!transform || transform.mode === "animation") {
        return null;
    }
    if (transform.clipReveal) {
        return supports(context, transform.clipReveal.kind === "wipe" ? "wipe" : "circle");
    }
    const to = transform.to;
    if (!to) {
        return null;
    }
    if (to.position !== undefined) {
        return placementWordFor(to.position) ? null : supports(context, slideWordFor(to.position));
    }
    if (to.zoom !== undefined) return supports(context, "zoom");
    if (to.scaleX !== undefined || to.scaleY !== undefined) return supports(context, "scale");
    if (to.rotation !== undefined) return supports(context, "rotate");
    if (to.filter && to.filter.brightness !== undefined) return supports(context, "darken");
    if (to.opacity !== undefined) return supports(context, "fade");
    return null;
}

function supports(context: StoryTransitionContext, word: StoryTransitionWord | null): StoryTransitionWord | null {
    return word && SUPPORTED[context].includes(word) ? word : null;
}

/**
 * The `at=` word a stored position spells, or `null` when it is not one of the three.
 *
 * The three placements are the only positions the vocabulary names, so anything else - an offset, a
 * hand-typed align - has no word and prints nothing rather than being rounded to the nearest one.
 */
export function placementWordFor(position: StoryTransformProps["position"]): "left" | "center" | "right" | null {
    if (!position || position.xoffset !== undefined || position.yoffset !== undefined || position.yalign !== 0.5) {
        return null;
    }
    for (const word of ["left", "center", "right"] as const) {
        if (legacyPresetPosition(word, {})?.xalign === position.xalign) {
            return word;
        }
    }
    return null;
}

function slideWordFor(position: StoryTransformProps["position"]): StoryTransitionWord | null {
    for (const word of ["slide-left", "slide-right", "slide-up", "slide-down"] as const) {
        const target = REVEAL_EFFECTS[word]?.to?.position;
        if (target && target.xalign === position?.xalign && target.yalign === position?.yalign) {
            return word;
        }
    }
    return null;
}
