import type { CharacterAppearanceSummary, CharacterAvatarSummaryEntry, DevModeCharacterSummary } from "@shared/types/devMode";
import { resolveTagSelection } from "@shared/utils/characterVariant";

/**
 * The dialog avatar of the character who is currently speaking, keyed by which differential that
 * character is currently wearing.
 *
 * A layered character has no single image (`Image.getSrcURL` returns null for one), so an avatar
 * cannot be "the current sprite, cropped" — it is baked ahead of time, one PNG per differential,
 * and addressed here by a key. The preset case is the degenerate one: the key is the pose id.
 *
 * Everything in this module is pure and shared, because three very different callers need the same
 * answers: the baker (which keys exist), the story compiler (which asset a live tag set resolves
 * to), and the packager (which derived files to ship).
 */

/** Separator between the tag ids of a layered key. Tag ids are `[a-z0-9]` counters, so it is safe. */
const AVATAR_KEY_SEPARATOR = "+";

export const CHARACTER_AVATAR_ASSET_ID_PREFIX = "character-avatar:" as const;

/** Relative path (POSIX) of the baked PNG for one avatar key, inside the project. */
export function characterAvatarBakePath(characterId: string, key: string): string {
    return `resources/characters/avatars/${characterId}/${key}.png`;
}

/**
 * The synthetic asset id a baked avatar is addressed by.
 *
 * Baked avatars are deliberately *not* project-library assets: one character can bake dozens, and
 * dropping those into the author's asset browser would bury the images they actually chose. They
 * ride a parsed id instead, the way Dev Mode save previews do, and every host resolves that id
 * through its own arm.
 */
export function characterAvatarAssetId(characterId: string, key: string): string {
    return `${CHARACTER_AVATAR_ASSET_ID_PREFIX}${encodeURIComponent(characterId)}:${encodeURIComponent(key)}`;
}

export function parseCharacterAvatarAssetId(assetId: string): { characterId: string; key: string } | null {
    if (!assetId.startsWith(CHARACTER_AVATAR_ASSET_ID_PREFIX)) {
        return null;
    }
    const rest = assetId.slice(CHARACTER_AVATAR_ASSET_ID_PREFIX.length);
    const separator = rest.indexOf(":");
    if (separator <= 0) {
        return null;
    }
    try {
        const characterId = decodeURIComponent(rest.slice(0, separator));
        const key = decodeURIComponent(rest.slice(separator + 1));
        return characterId && key ? { characterId, key } : null;
    } catch {
        return null;
    }
}

/** The axes a layered character's avatar varies with. Absent/empty declaration means every axis. */
export function characterAvatarAxisIds(appearance: CharacterAppearanceSummary | undefined): string[] {
    if (appearance?.kind !== "layered") {
        return [];
    }
    const declared = (appearance.avatarAxisIds ?? []).filter(axisId =>
        appearance.axes.some(axis => axis.id === axisId));
    return declared.length > 0 ? declared : appearance.axes.map(axis => axis.id);
}

/**
 * The avatar key of one differential.
 *
 * Tag ids are **sorted** into the key. The insertion order of a tag map is an accident of which row
 * was written first, and two rows striking the same pose have to hit the same bake — the same
 * reason `spriteCompositeKey` sorts.
 *
 * Null when the character has no differential to key on (a preset with no poses, a layered
 * character whose avatar axes contribute no tags).
 */
export function characterAvatarKey(
    appearance: CharacterAppearanceSummary | undefined,
    selection: { poseId?: string | null; tags?: Record<string, string> | null },
): string | null {
    if (appearance?.kind === "preset") {
        const poseId = selection.poseId ?? appearance.defaultPoseId ?? appearance.poses[0]?.id;
        return poseId && appearance.poses.some(pose => pose.id === poseId) ? poseId : null;
    }
    if (appearance?.kind !== "layered") {
        return null;
    }
    const resolved = resolveTagSelection(appearance, selection.tags ?? undefined);
    const axisIds = new Set(characterAvatarAxisIds(appearance));
    const tagIds = Object.entries(resolved)
        .filter(([axisId]) => axisIds.has(axisId))
        .map(([, tagId]) => tagId)
        .sort();
    return tagIds.length > 0 ? tagIds.join(AVATAR_KEY_SEPARATOR) : null;
}

/**
 * The avatar key for the tag set the *engine* reports as currently displayed.
 *
 * The engine hands back a flat `string[]` of every active tag, across every group. Only the tags on
 * the avatar axes belong in the key, and a tag the appearance no longer knows is dropped rather
 * than guessed at — a stale tag would otherwise mint a key that nothing was ever baked for.
 */
export function characterAvatarKeyFromTags(
    appearance: CharacterAppearanceSummary | undefined,
    tags: readonly string[] | null | undefined,
): string | null {
    if (appearance?.kind !== "layered" || !tags?.length) {
        return null;
    }
    const axisIds = new Set(characterAvatarAxisIds(appearance));
    const active = new Set(tags);
    const selection: Record<string, string> = {};
    for (const axis of appearance.axes) {
        if (!axisIds.has(axis.id)) {
            continue;
        }
        const tag = axis.tags.find(candidate => active.has(candidate.id));
        if (tag) {
            selection[axis.id] = tag.id;
        }
    }
    return characterAvatarKey(appearance, { tags: selection });
}

/** Every avatar key a character can wear — what the baker enumerates. */
export function characterAvatarKeys(appearance: CharacterAppearanceSummary | undefined): string[] {
    if (appearance?.kind === "preset") {
        return appearance.poses.map(pose => pose.id);
    }
    if (appearance?.kind !== "layered") {
        return [];
    }
    const axisIds = new Set(characterAvatarAxisIds(appearance));
    const axes = appearance.axes.filter(axis => axisIds.has(axis.id) && axis.tags.length > 0);
    // Cartesian product of the avatar axes' tags. Sorting happens per combination, not here, so the
    // key an enumerated combination produces is byte-identical to the one a live tag set produces.
    let combinations: string[][] = [[]];
    for (const axis of axes) {
        combinations = combinations.flatMap(prefix => axis.tags.map(tag => [...prefix, tag.id]));
    }
    return combinations
        .filter(tagIds => tagIds.length > 0)
        .map(tagIds => [...tagIds].sort().join(AVATAR_KEY_SEPARATOR));
}

function avatarEntry(
    appearance: CharacterAppearanceSummary | undefined,
    key: string | null,
): CharacterAvatarSummaryEntry | undefined {
    if (!key || !appearance || !("avatars" in appearance)) {
        return undefined;
    }
    return appearance.avatars?.[key];
}

/**
 * The asset id to show for one differential: the author's override first, then the bake, then the
 * character's default, then nothing.
 *
 * "Then nothing" is a real answer. Falling back to the character's *sprite* would put a full-body
 * image in a 96px box, and for a layered character there is no sprite to fall back to at all.
 */
export function resolveCharacterAvatarAssetId(
    character: Pick<DevModeCharacterSummary, "id" | "appearance" | "defaultAvatarAssetId"> | undefined,
    key: string | null,
): string | null {
    if (!character) {
        return null;
    }
    const entry = avatarEntry(character.appearance, key);
    const override = entry?.overrideAssetId?.trim();
    if (override) {
        return override;
    }
    if (entry?.baked && key) {
        return characterAvatarAssetId(character.id, key);
    }
    return character.defaultAvatarAssetId?.trim() || null;
}
