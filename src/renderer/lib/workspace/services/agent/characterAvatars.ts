/**
 * Dialog avatars as the cast tools read and write them.
 *
 * A character's avatar is the face shown beside its lines in the dialogue box and the backlog. The
 * model keeps three things (see `CharacterAvatarEntry` in `@shared/types/character/model`):
 *
 * - the profile's `defaultAvatarAssetId`, shown wherever no differential resolves one - and the only
 *   avatar a Live2D / Spine / puppet character has;
 * - per differential, an author-drawn `overrideAssetId`, keyed by pose id (preset) or by the sorted
 *   tag ids of the avatar axes (layered);
 * - per differential, a `baked` crop Studio renders from the sprite when the author opens the
 *   Characters panel. An agent cannot bake (it is a canvas render in the panel), so it writes the
 *   default and the overrides; a bake that exists is left alone and an override wins over it.
 *
 * Keys travel by NAME here - a pose name, or tag names joined with `+` - because ids are not what an
 * agent reads in `characters_list`, and the layered key's sort order is an implementation detail.
 *
 * Comments in English per project convention.
 */

import type { CharacterAvatarEntry } from "@shared/types/character/model";
import type { CharacterAppearance } from "../character/CharacterAppearance";
import { refuse } from "./agentCall";

/** How a layered avatar key joins its tags, both in the model and in what the tools accept. */
const KEY_SEPARATOR = "+";

/** What a call asked for. `undefined` fields leave that part alone. */
export type AvatarRequest = {
    /** Asset id, null to clear, undefined to keep. */
    defaultAvatar?: string | null;
    /** Pose name / `tag+tag` -> asset id, or null to drop that override. */
    avatars?: Record<string, string | null>;
    /** Axis names; null (or empty) = every axis. Layered only. */
    avatarAxes?: string[] | null;
};

/** The raw arguments, shape-checked; asset references are still names or ids. */
export type AvatarArgs = {
    defaultAvatar?: string | null;
    avatars?: Record<string, string | null>;
    avatarAxes?: string[] | null;
};

export function readAvatarArgs(args: Record<string, unknown>): AvatarArgs {
    const out: AvatarArgs = {};
    if ("defaultAvatar" in args && args.defaultAvatar !== undefined) {
        const raw = args.defaultAvatar;
        if (raw !== null && (typeof raw !== "string" || !raw.trim())) {
            throw refuse("invalid_args", "`defaultAvatar` must be an image asset (name or id), or null to clear it.");
        }
        out.defaultAvatar = raw === null ? null : raw.trim();
    }
    if ("avatars" in args && args.avatars !== undefined) {
        const raw = args.avatars;
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
            throw refuse("invalid_args", "`avatars` must be an object: pose name (or `tag+tag` for a layered character) -> image asset, or null.");
        }
        const avatars: Record<string, string | null> = {};
        for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
            if (!key.trim()) {
                throw refuse("invalid_args", "`avatars` has an empty key.");
            }
            if (value !== null && (typeof value !== "string" || !value.trim())) {
                throw refuse("invalid_args", `avatars["${key}"] must be an image asset (name or id), or null to drop it.`);
            }
            avatars[key.trim()] = value === null ? null : (value as string).trim();
        }
        out.avatars = avatars;
    }
    if ("avatarAxes" in args && args.avatarAxes !== undefined) {
        const raw = args.avatarAxes;
        if (raw !== null && (!Array.isArray(raw) || raw.some(item => typeof item !== "string" || !item.trim()))) {
            throw refuse("invalid_args", "`avatarAxes` must be a list of axis names, or null for every axis.");
        }
        out.avatarAxes = raw === null ? null : (raw as string[]).map(item => item.trim());
    }
    return out;
}

/** True when the call touches avatars at all. */
export function asksForAvatars(request: AvatarArgs): boolean {
    return request.defaultAvatar !== undefined || request.avatars !== undefined || request.avatarAxes !== undefined;
}

/**
 * Pose name for each preset avatar entry, captured before a pose list is replaced.
 *
 * Replacing poses mints new pose ids, and the avatar table is keyed by id: without carrying entries
 * across by name, every hand-drawn avatar would silently stop applying the moment poses were restated.
 */
export function presetAvatarsByPoseName(appearance: CharacterAppearance): Map<string, CharacterAvatarEntry> {
    const byName = new Map<string, CharacterAvatarEntry>();
    if (appearance.getKind() !== "preset") {
        return byName;
    }
    for (const pose of appearance.getPoses()) {
        const entry = appearance.getAvatar(pose.id);
        if (entry) {
            byName.set(pose.name, entry);
        }
    }
    return byName;
}

/**
 * After the pose list was rebuilt: move each surviving pose's entry onto its new id and drop the
 * entries of ids that no longer exist. A bake is keyed by pose id (its PNG path carries the id), so
 * the fingerprint is not carried - Studio bakes the new id the next time the Characters panel runs.
 */
export function carryPresetAvatars(appearance: CharacterAppearance, byName: Map<string, CharacterAvatarEntry>): void {
    const liveIds = new Set(appearance.getPoses().map(pose => pose.id));
    for (const key of Object.keys(appearance.getAvatars())) {
        if (!liveIds.has(key)) {
            appearance.setAvatar(key, null);
        }
    }
    for (const pose of appearance.getPoses()) {
        const previous = byName.get(pose.name);
        if (previous) {
            const { baked: _stale, ...kept } = previous;
            appearance.setAvatar(pose.id, kept);
        }
    }
}

/**
 * The model key for one name-spelled key, or a refusal naming what exists.
 *
 * Layered: every tag must belong to an avatar axis, one tag per avatar axis, in any order.
 */
export function avatarKeyFor(appearance: CharacterAppearance, characterName: string, spelled: string): string {
    const kind = appearance.getKind();
    if (kind === "preset") {
        const pose = appearance.getPoses().find(item => item.name === spelled);
        if (!pose) {
            const names = appearance.getPoses().map(item => item.name);
            throw refuse(
                "invalid_args",
                `avatars["${spelled}"]: "${characterName}" has no pose "${spelled}".`,
                names.length > 0 ? `Its poses: ${names.join(", ")}.` : "Give it poses first.",
            );
        }
        return pose.id;
    }
    if (kind !== "layered") {
        throw refuse(
            "unavailable",
            `"${characterName}" is a ${kind} character, which has no differentials to give avatars to.`,
            "Use `defaultAvatar` - it is the avatar such a character shows on every line.",
        );
    }
    const axes = appearance.getAxes();
    const declared = appearance.getAvatarAxisIds().filter(id => axes.some(axis => axis.id === id));
    const avatarAxes = declared.length > 0 ? axes.filter(axis => declared.includes(axis.id)) : axes;
    const parts = spelled.split(KEY_SEPARATOR).map(part => part.trim()).filter(Boolean);
    const chosen = new Map<string, string>();
    for (const part of parts) {
        const axis = avatarAxes.find(candidate => candidate.tags.some(tag => tag.name === part));
        if (!axis) {
            const elsewhere = axes.find(candidate => candidate.tags.some(tag => tag.name === part));
            throw refuse(
                "invalid_args",
                elsewhere
                    ? `avatars["${spelled}"]: tag "${part}" is on axis "${elsewhere.name}", which the avatar does not vary with.`
                    : `avatars["${spelled}"]: "${characterName}" has no tag "${part}".`,
                `Avatar axes: ${avatarAxes.map(item => `${item.name} (${item.tags.map(tag => tag.name).join("/")})`).join(", ")}. Change them with \`avatarAxes\`.`,
            );
        }
        if (chosen.has(axis.id)) {
            throw refuse("invalid_args", `avatars["${spelled}"] names two tags of axis "${axis.name}".`);
        }
        chosen.set(axis.id, axis.tags.find(tag => tag.name === part)!.id);
    }
    const missing = avatarAxes.filter(axis => axis.tags.length > 0 && !chosen.has(axis.id));
    if (missing.length > 0 || chosen.size === 0) {
        throw refuse(
            "invalid_args",
            `avatars["${spelled}"] must name one tag of every avatar axis, joined with "+"; missing: ${missing.map(axis => axis.name).join(", ") || "all"}.`,
            `Avatar axes: ${avatarAxes.map(item => item.name).join(", ")}. Narrow them with \`avatarAxes\` (e.g. just the expression) to give one avatar per expression.`,
        );
    }
    return [...chosen.values()].sort().join(KEY_SEPARATOR);
}

/**
 * Write the resolved request onto a draft appearance/profile. Asset ids are already resolved.
 * Order matters: the avatar axes decide what an `avatars` key means, so they are set first.
 */
export function applyAvatarRequest(
    appearance: CharacterAppearance,
    setDefault: (assetId: string | null) => void,
    characterName: string,
    request: AvatarRequest,
): void {
    if (request.avatarAxes !== undefined) {
        if (appearance.getKind() !== "layered") {
            throw refuse("unavailable", `\`avatarAxes\` is for a layered character; "${characterName}" is ${appearance.getKind()}.`);
        }
        const axes = appearance.getAxes();
        const ids = (request.avatarAxes ?? []).map(name => {
            const axis = axes.find(item => item.name === name);
            if (!axis) {
                throw refuse("invalid_args", `avatarAxes: "${characterName}" has no axis "${name}".`, `Its axes: ${axes.map(item => item.name).join(", ")}.`);
            }
            return axis.id;
        });
        const allAxes = ids.length === 0 || ids.length === axes.length;
        appearance.setAvatarAxisIds(allAxes ? null : ids);
    }
    if (request.defaultAvatar !== undefined) {
        setDefault(request.defaultAvatar);
    }
    if (request.avatars) {
        for (const [spelled, assetId] of Object.entries(request.avatars)) {
            const key = avatarKeyFor(appearance, characterName, spelled);
            const current = appearance.getAvatar(key);
            if (assetId) {
                appearance.setAvatar(key, { ...(current ?? {}), overrideAssetId: assetId });
            } else if (current) {
                const { overrideAssetId: _dropped, ...rest } = current;
                appearance.setAvatar(key, rest);
            }
        }
    }
}

/** A model key spelled back in names; the raw key when it no longer resolves. */
function spellAvatarKey(appearance: CharacterAppearance, key: string): string {
    if (appearance.getKind() === "preset") {
        return appearance.getPose(key)?.name ?? key;
    }
    const tagNames = new Map<string, string>();
    for (const axis of appearance.getAxes()) {
        for (const tag of axis.tags) {
            tagNames.set(tag.id, tag.name);
        }
    }
    return key.split(KEY_SEPARATOR).map(id => tagNames.get(id) ?? id).join(KEY_SEPARATOR);
}

/**
 * The avatar block `characters_list` / `character_upsert` report: the default, every hand-drawn
 * override, how many crops Studio has baked, and a layered character's avatar axes.
 */
export function describeAvatars(
    appearance: CharacterAppearance,
    defaultAvatarAssetId: string | null,
    assetName: (assetId: string) => string | null,
) {
    const overrides: Record<string, string> = {};
    let baked = 0;
    for (const [key, entry] of Object.entries(appearance.getAvatars())) {
        if (entry.overrideAssetId) {
            overrides[spellAvatarKey(appearance, key)] = assetName(entry.overrideAssetId) ?? entry.overrideAssetId;
        }
        if (entry.baked) {
            baked += 1;
        }
    }
    const declared = appearance.getKind() === "layered" ? appearance.getAvatarAxisIds() : [];
    return {
        defaultAvatar: defaultAvatarAssetId ? assetName(defaultAvatarAssetId) ?? defaultAvatarAssetId : null,
        avatars: overrides,
        bakedAvatars: baked,
        ...(appearance.getKind() === "layered"
            ? {
                avatarAxes: declared.length > 0
                    ? declared.map(id => appearance.getAxis(id)?.name ?? id)
                    : appearance.getAxes().map(axis => axis.name),
            }
            : {}),
    };
}
