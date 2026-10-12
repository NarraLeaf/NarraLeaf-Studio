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
 *   default and the overrides, in the shape the character editor writes them: an override replaces
 *   the differential's entry, and clearing it removes the entry, so Studio bakes afresh.
 *
 * Keys travel by NAME here - a pose name, or tag names joined with `+` - because ids are not what an
 * agent reads in `characters_list`, and the layered key's sort order is an implementation detail.
 *
 * Comments in English per project convention.
 */

import type { CharacterAvatarEntry } from "@shared/types/character/model";
import type { CharacterAppearanceSummary } from "@shared/types/devMode";
import { characterAvatarAxisIds, characterAvatarKey } from "@shared/utils/characterAvatar";
import type { CharacterAppearance } from "../character/CharacterAppearance";
import { refuse } from "./agentCall";

/**
 * How the tools spell a layered avatar key: tag names joined with `+`. Spelling a model key back
 * splits it the same way - tag ids are `[a-z0-9]` counters, so the separator cannot be inside one.
 */
const KEY_SEPARATOR = "+";

/**
 * The slice of an appearance the shared avatar keying (`@shared/utils/characterAvatar`) reads - the
 * one the character editor hands it - so a key an agent writes is the key the baker, the compiler
 * and the editor work out for the same differential, by the same rule rather than a copy of it.
 */
function avatarKeying(appearance: CharacterAppearance): CharacterAppearanceSummary | undefined {
    switch (appearance.getKind()) {
        case "preset":
            return {
                kind: "preset",
                poses: appearance.getPoses().map(pose => ({ id: pose.id, name: pose.name, assetId: pose.assetId })),
                defaultPoseId: appearance.getDefaultPoseId(),
            };
        case "layered":
            return {
                kind: "layered",
                canvas: null,
                layers: [],
                axes: appearance.getAxes(),
                avatarAxisIds: appearance.getAvatarAxisIds(),
            };
        default:
            return undefined;
    }
}

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
    const keying = avatarKeying(appearance);
    if (kind === "preset") {
        const pose = appearance.getPoses().find(item => item.name === spelled);
        const key = pose ? characterAvatarKey(keying, { poseId: pose.id }) : null;
        if (!key) {
            const names = appearance.getPoses().map(item => item.name);
            throw refuse(
                "invalid_args",
                `avatars["${spelled}"]: "${characterName}" has no pose "${spelled}".`,
                names.length > 0 ? `Its poses: ${names.join(", ")}.` : "Give it poses first.",
            );
        }
        return key;
    }
    if (kind !== "layered") {
        throw refuse(
            "unavailable",
            `"${characterName}" is a ${kind} character, which has no differentials to give avatars to.`,
            "Use `defaultAvatar` - it is the avatar such a character shows on every line.",
        );
    }
    const axes = appearance.getAxes();
    const avatarAxisIds = characterAvatarAxisIds(keying);
    const avatarAxes = axes.filter(axis => avatarAxisIds.includes(axis.id));
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
    const key = missing.length === 0 ? characterAvatarKey(keying, { tags: Object.fromEntries(chosen) }) : null;
    if (!key) {
        throw refuse(
            "invalid_args",
            `avatars["${spelled}"] must name one tag of every avatar axis, joined with "+"; missing: ${missing.map(axis => axis.name).join(", ") || "all"}.`,
            `Avatar axes: ${avatarAxes.map(item => item.name).join(", ")}. Narrow them with \`avatarAxes\` (e.g. just the expression) to give one avatar per expression.`,
        );
    }
    return key;
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
            // The shape the character editor writes when the author picks or clears an avatar: the
            // override alone, or nothing. Clearing hands the differential back to the baker, so the
            // bake goes with it and the next reconcile renders a fresh one; a bake kept beside a
            // cleared override would show a crop from before the author's art changed. Asked to drop
            // an override there is not, nothing is touched - least of all a bake it was not asked about.
            if (assetId) {
                appearance.setAvatar(key, { overrideAssetId: assetId });
            } else if (appearance.getAvatar(key)?.overrideAssetId) {
                appearance.setAvatar(key, null);
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
    return {
        defaultAvatar: defaultAvatarAssetId ? assetName(defaultAvatarAssetId) ?? defaultAvatarAssetId : null,
        avatars: overrides,
        bakedAvatars: baked,
        ...(appearance.getKind() === "layered"
            ? { avatarAxes: characterAvatarAxisIds(avatarKeying(appearance)).map(id => appearance.getAxis(id)?.name ?? id) }
            : {}),
    };
}
