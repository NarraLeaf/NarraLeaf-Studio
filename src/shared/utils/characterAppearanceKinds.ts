/**
 * The vocabulary of character appearance kinds, and nothing else.
 *
 * Split out of the renderer's `character/types.ts` — which still owns every appearance *shape* and
 * re-exports all of this — because the kind strings are read on both sides of the process boundary:
 * `shared/utils/characterSummaries.ts` maps a stored appearance into the Dev Mode bundle, and the
 * main process reads that bundle. A shared consumer cannot import a renderer module, and duplicating
 * the list is exactly the failure this file exists to prevent: a kind missing from one copy is
 * **deleted from the author's project**, not merely unhandled (see {@link CHARACTER_APPEARANCE_KINDS}).
 *
 * Values only, no shapes. Nothing here knows what a pose or a layer is.
 */

/**
 * The kinds an author-supplied runtime draws.
 *
 * One shape, three names. `live2d` and `spine` are not different data from `puppet` — they carry the
 * identical fields and the engine cannot tell them apart — they record *which runtime this character
 * was created for*, where the author chose it. That is what makes "your Live2D runtime is not
 * installed" answerable before a model has been picked, which one generic kind plus a free-text
 * backend name could not do.
 *
 * `puppet` stays for a runtime the author wrote themselves, and is the kind nothing else assumes.
 *
 * Deliberately *not* derived from `KnownPuppetRuntimeId`, close as the two lists are: naming a new
 * runtime in that registry must never silently mint a new appearance kind, because a kind is a
 * migration and a registry entry is a label. They are kept in step by a test, not by a type.
 */
export type PuppetAppearanceKind = "puppet" | "live2d" | "spine";

export const PUPPET_APPEARANCE_KINDS = ["puppet", "live2d", "spine"] as const satisfies readonly PuppetAppearanceKind[];

/**
 * How a character's sprite is built. Chosen when the character is created; changing it is a cold
 * switch that discards the previous kind's data, because the kinds carry nothing in common and there
 * is no conversion between them (user ruling 2026-07-26).
 *
 * - `preset` — N finished sprites, one per named pose. N = 1 is the plain single-image character.
 * - `layered` — a stack of layers composited at runtime and switched by tag.
 * - `live2d` / `spine` / `puppet` — a box on the stage whose interior an author-supplied runtime
 *   draws. See {@link PuppetAppearanceKind}.
 */
export type CharacterAppearanceKind = "preset" | "layered" | PuppetAppearanceKind;

/**
 * Every kind the current model knows, in one place.
 *
 * Enumerated rather than inferred because two loaders check it and they must agree: the appearance
 * constructor (which falls back to an empty preset) and the store migration (which reads an
 * unrecognised kind as the *pre-rework* store and rewrites it). A kind added to the union but not
 * to this list is therefore not merely unhandled — **it is deleted on the next load**.
 *
 * `satisfies` pins one half of that (nothing here is off the union) and structurally cannot pin the
 * other: a list missing a member satisfies the same constraint. The other half is
 * `characterAppearanceKinds.test.ts`, which fails when the union grows past this list.
 */
export const CHARACTER_APPEARANCE_KINDS = [
    "preset",
    "layered",
    ...PUPPET_APPEARANCE_KINDS,
] as const satisfies readonly CharacterAppearanceKind[];

export function isCharacterAppearanceKind(value: unknown): value is CharacterAppearanceKind {
    return CHARACTER_APPEARANCE_KINDS.includes(value as CharacterAppearanceKind);
}

/** Whether this kind is drawn by an author-supplied runtime — the discriminant for the puppet arm. */
export function isPuppetAppearanceKind(value: unknown): value is PuppetAppearanceKind {
    return PUPPET_APPEARANCE_KINDS.includes(value as PuppetAppearanceKind);
}
